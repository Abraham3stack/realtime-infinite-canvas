import React, { useRef, useCallback, useEffect, useState } from 'react';
import { Stage, Layer } from 'react-konva';
import Konva from 'konva';
import { useViewportStore } from '../store/viewport.js';
import { useCanvasObjectsStore, type CanvasObject } from '../store/objects.js';
import { useRoomStore } from '../store/room.js';
import { ObjectRenderer } from './ObjectRenderer.js';
import { LoadingOverlay } from './ui/LoadingOverlay.js';
import { socket } from '../socket.js';
import type { CanvasObjectType } from '../store/objects.js';
import { uploadMediaFiles, type MediaUploadType, type UploadedMedia } from '../hooks/useMediaUpload.js';

// Type definitions for socket payloads
interface ObjectCreatedPayload {
  operationId: string;
  object: CanvasObject;
  serverTs: Date;
}

interface ObjectUpdatedPayload {
  operationId: string;
  objectId: string;
  updates: Record<string, unknown>;
  serverTs: Date;
}

interface ObjectDeletedPayload {
  operationId: string;
  objectId: string;
  serverTs: Date;
}

interface CanvasProps {
  participantCount: number;
  loadingPhase?: 'connecting' | 'hydrating' | 'syncing' | null;
  loadingCopy?: { title: string; sub: string } | null;
  onObjectDeleted?: () => void;
  onNotify?: (message: string) => void;
  sessionToken?: string;
  sessionId?: string;
}

const TOOLBAR_ITEMS: Array<{ type: CanvasObjectType; label: string; hotkey: string; icon: string }> = [
  { type: 'rectangle', label: 'Rectangle', hotkey: 'R', icon: '[]' },
  { type: 'circle', label: 'Circle', hotkey: 'C', icon: '()' },
  { type: 'text', label: 'Text', hotkey: 'T', icon: 'T' },
  { type: 'sticky-note', label: 'Sticky Note', hotkey: 'S', icon: 'SN' },
];

export const Canvas: React.FC<CanvasProps> = ({
  participantCount,
  loadingPhase = null,
  loadingCopy = null,
  onObjectDeleted,
  onNotify,
  sessionToken,
  sessionId,
}) => {
  const stageRef = useRef<Konva.Stage>(null);
  const imageUploadInputRef = useRef<HTMLInputElement>(null);
  const audioUploadInputRef = useRef<HTMLInputElement>(null);
  const videoUploadInputRef = useRef<HTMLInputElement>(null);
  const [stageSize, setStageSize] = useState({ width: 1024, height: 768 });
  const [activeTool, setActiveTool] = useState<CanvasObjectType | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [uploadInProgress, setUploadInProgress] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLabel, setUploadLabel] = useState<string | null>(null);
  const [failedUpload, setFailedUpload] = useState<{ files: File[]; mediaType: MediaUploadType; message: string } | null>(null);
  
  // Viewport state: pan and zoom transforms
  const { offsetX, offsetY, scale, panBy, zoomBy } = useViewportStore((s) => ({
    offsetX: s.offsetX,
    offsetY: s.offsetY,
    scale: s.scale,
    panBy: s.panBy,
    zoomBy: s.zoomBy,
  }));

  // Canvas objects: local CRUD state
  const { objects, addObject, addMediaObject, updateObject, deleteObject } = useCanvasObjectsStore((s) => ({
    objects: s.objects,
    addObject: s.addObject,
    addMediaObject: s.addMediaObject,
    updateObject: s.updateObject,
    deleteObject: s.deleteObject,
  }));
  const { room } = useRoomStore();

  // Track pending operations for deduplication (operationId -> true means local)
  const pendingOperations = useRef<Set<string>>(new Set());

  // Generate unique operation ID for deduplication
  const generateOperationId = useCallback(() => {
    return `op_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }, []);

  const emitCreate = useCallback((object: CanvasObject) => {
    if (!room) return;
    const operationId = generateOperationId();
    pendingOperations.current.add(operationId);
    socket.emit('object:create', {
      operationId,
      roomId: room.id,
      object,
    });
  }, [generateOperationId, room]);

  const emitUpdate = useCallback((objectId: string, updates: Record<string, unknown>) => {
    if (!room) return;
    const operationId = generateOperationId();
    pendingOperations.current.add(operationId);
    socket.emit('object:update', {
      operationId,
      roomId: room.id,
      objectId,
      updates,
    });
  }, [generateOperationId, room]);

  const emitDelete = useCallback((objectId: string) => {
    if (!room) return;
    const operationId = generateOperationId();
    pendingOperations.current.add(operationId);
    socket.emit('object:delete', {
      operationId,
      roomId: room.id,
      objectId,
    });
  }, [generateOperationId, room]);

  const createObjectAndSync = useCallback((type: CanvasObjectType) => {
    if (!room) return;

    const centerX = (stageSize.width / 2 - offsetX) / scale;
    const centerY = (stageSize.height / 2 - offsetY) / scale;

    const id = addObject(type, centerX, centerY);
    const object = useCanvasObjectsStore.getState().getObject(id);
    if (!object) return;

    setActiveTool(type);
    setSelectedObjectId(id);
    emitCreate(object);
  }, [addObject, emitCreate, offsetX, offsetY, room, scale, stageSize]);

  const createMediaObjectsAndSync = useCallback((uploads: UploadedMedia[]) => {
    if (!room) return;

    const centerX = (stageSize.width / 2 - offsetX) / scale;
    const centerY = (stageSize.height / 2 - offsetY) / scale;

    const createdIds: string[] = [];

    uploads.forEach((upload, index) => {
      const type = upload.resourceType;
      const id = addMediaObject({
        type,
        x: centerX + index * 28,
        y: centerY + index * 22,
        mediaUrl: upload.secureUrl,
        mediaPublicId: upload.publicId,
        mediaResourceType: upload.resourceType,
        mediaFormat: upload.format,
        mediaWidth: upload.width,
        mediaHeight: upload.height,
        mimeType: upload.mimeType,
        sizeBytes: upload.bytes,
        durationMs: upload.duration,
        mediaCreatedAt: upload.createdAt,
        text: type === 'audio' || type === 'video' ? upload.originalFilename : undefined,
        createdBySessionId: sessionId,
      });

      const object = useCanvasObjectsStore.getState().getObject(id);
      if (!object) return;

      createdIds.push(id);
      emitCreate(object);
    });

    if (createdIds.length > 0) {
      setSelectedObjectId(createdIds[createdIds.length - 1]);
    }
  }, [addMediaObject, emitCreate, offsetX, offsetY, room, scale, sessionId, stageSize]);

  const runMediaUpload = useCallback(async (mediaType: MediaUploadType, files: File[]) => {
    if (!room) {
      onNotify?.('Join a room before uploading media');
      return;
    }

    if (!sessionToken) {
      onNotify?.('Session token missing. Recreate your guest session and try again.');
      return;
    }

    if (uploadInProgress) {
      onNotify?.('Upload already in progress');
      return;
    }

    if (files.length === 0) {
      return;
    }

    setUploadInProgress(true);
    setUploadProgress(0);
    setUploadLabel(`Uploading ${files.length} ${mediaType} file${files.length > 1 ? 's' : ''}...`);
    setFailedUpload(null);

    try {
      const uploads = await uploadMediaFiles({
        files,
        expectedType: mediaType,
        sessionToken,
        onProgress: (progress) => setUploadProgress(progress),
      });

      createMediaObjectsAndSync(uploads);
      onNotify?.(`✓ Uploaded ${uploads.length} ${mediaType} file${uploads.length > 1 ? 's' : ''}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Media upload failed';
      setFailedUpload({ files, mediaType, message });
      onNotify?.(`Upload failed: ${message}`);
    } finally {
      setUploadInProgress(false);
      setUploadLabel(null);
      setUploadProgress(0);
    }
  }, [createMediaObjectsAndSync, onNotify, room, sessionToken, uploadInProgress]);

  const openUploadPicker = useCallback((mediaType: MediaUploadType) => {
    if (uploadInProgress) return;
    if (mediaType === 'image') imageUploadInputRef.current?.click();
    if (mediaType === 'audio') audioUploadInputRef.current?.click();
    if (mediaType === 'video') videoUploadInputRef.current?.click();
  }, [uploadInProgress]);

  const handlePickerChanged = useCallback(async (mediaType: MediaUploadType, files: FileList | null) => {
    const nextFiles = files ? Array.from(files) : [];
    await runMediaUpload(mediaType, nextFiles);

    if (mediaType === 'image' && imageUploadInputRef.current) imageUploadInputRef.current.value = '';
    if (mediaType === 'audio' && audioUploadInputRef.current) audioUploadInputRef.current.value = '';
    if (mediaType === 'video' && videoUploadInputRef.current) videoUploadInputRef.current.value = '';
  }, [runMediaUpload]);

  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, []);

  const handleExportPng = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const dataUrl = stage.toDataURL({ pixelRatio: 2 });
    const anchor = document.createElement('a');
    anchor.href = dataUrl;
    anchor.download = `canvas-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    onNotify?.('✓ PNG exported');
  }, [onNotify]);

  const handleExportJson = useCallback(() => {
    const payload = {
      roomId: room?.id ?? null,
      exportedAt: new Date().toISOString(),
      objects: objects.map((obj) => {
        const normalizedMediaWidth = typeof obj.mediaWidth === 'number' && obj.mediaWidth > 0 ? obj.mediaWidth : null;
        const normalizedMediaHeight = typeof obj.mediaHeight === 'number' && obj.mediaHeight > 0 ? obj.mediaHeight : null;

        return {
          id: obj.id,
          type: obj.type,
          x: obj.x,
          y: obj.y,
          width: obj.width,
          height: obj.height,
          zIndex: obj.zIndex,
          rotation: obj.rotation,
          color: obj.color,
          text: obj.text,
          fontSize: obj.fontSize,
          createdBySessionId: obj.createdBySessionId ?? null,
          createdAt: obj.createdAt ?? null,
          updatedAt: obj.updatedAt ?? null,
          mediaUrl: obj.mediaUrl ?? null,
          mediaPublicId: obj.mediaPublicId ?? null,
          mediaResourceType: obj.mediaResourceType ?? null,
          mediaFormat: obj.mediaFormat ?? null,
          mimeType: obj.mimeType ?? null,
          sizeBytes: obj.sizeBytes ?? null,
          mediaWidth: normalizedMediaWidth,
          mediaHeight: normalizedMediaHeight,
          durationMs: obj.durationMs ?? null,
          mediaCreatedAt: obj.mediaCreatedAt ?? null,
          ownership: {
            createdBySessionId: obj.createdBySessionId ?? null,
          },
          timestamps: {
            createdAt: obj.createdAt ?? null,
            updatedAt: obj.updatedAt ?? null,
            mediaCreatedAt: obj.mediaCreatedAt ?? null,
          },
          media: obj.mediaUrl
            ? {
                publicId: obj.mediaPublicId ?? null,
                secureUrl: obj.mediaUrl,
                resourceType: obj.mediaResourceType ?? null,
                width: normalizedMediaWidth,
                height: normalizedMediaHeight,
                duration: obj.durationMs ?? null,
                format: obj.mediaFormat ?? null,
                bytes: obj.sizeBytes ?? null,
                mimeType: obj.mimeType ?? null,
              }
            : null,
        };
      }),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `canvas-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    onNotify?.('✓ JSON exported');
  }, [downloadBlob, objects, onNotify, room?.id]);

  const deleteObjectAndSync = useCallback((objectId: string) => {
    deleteObject(objectId);
    if (selectedObjectId === objectId) {
      setSelectedObjectId(null);
    }
    emitDelete(objectId);
    onObjectDeleted?.();
  }, [deleteObject, emitDelete, onObjectDeleted, selectedObjectId]);

  useEffect(() => {
    if (!activeTool) return;
    const timer = window.setTimeout(() => setActiveTool(null), 350);
    return () => window.clearTimeout(timer);
  }, [activeTool]);

  // Track mouse state for panning
  const isPanning = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });

  // Keyboard shortcuts for object creation
  useEffect(() => {
    if (!room) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement as HTMLElement | null;
      if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
        return;
      }

      // Use keyboard shortcuts: R=Rectangle, C=Circle, T=Text, S=Sticky Note.
      switch (e.key.toLowerCase()) {
        case 'r': {
          e.preventDefault();
          createObjectAndSync('rectangle');
          break;
        }
        case 'c': {
          e.preventDefault();
          createObjectAndSync('circle');
          break;
        }
        case 't': {
          e.preventDefault();
          createObjectAndSync('text');
          break;
        }
        case 's': {
          e.preventDefault();
          createObjectAndSync('sticky-note');
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [createObjectAndSync, room]);

  // Socket event listeners for object synchronization
  useEffect(() => {
    if (!room) return;

    // Listen for object creation from other clients
    const handleObjectCreated = (payload: ObjectCreatedPayload) => {
      const { operationId, object } = payload;

      // Skip if this is our own operation (echo)
      if (pendingOperations.current.has(operationId)) {
        pendingOperations.current.delete(operationId);
        // Reconcile optimistic local object with server-canonical fields
        // (timestamps/media normalization) so export matches persisted state.
        updateObject(object.id, object);
        return;
      }

      // Use addObjectFromSync (functional update) to avoid snapshot races
      // when multiple object:created events arrive in rapid succession.
      useCanvasObjectsStore.getState().addObjectFromSync(object);
    };

    // Listen for object updates from other clients
    const handleObjectUpdated = (payload: ObjectUpdatedPayload) => {
      const { operationId, objectId, updates } = payload;

      // Skip if this is our own operation (echo)
      if (pendingOperations.current.has(operationId)) {
        pendingOperations.current.delete(operationId);
        return;
      }

      updateObject(objectId, updates);
    };

    // Listen for object deletion from other clients
    const handleObjectDeleted = (payload: ObjectDeletedPayload) => {
      const { operationId, objectId } = payload;

      // Skip if this is our own operation (echo)
      if (pendingOperations.current.has(operationId)) {
        pendingOperations.current.delete(operationId);
        return;
      }

      deleteObject(objectId);
      setSelectedObjectId((current) => (current === objectId ? null : current));
    };

    socket.on('object:created', handleObjectCreated);
    socket.on('object:updated', handleObjectUpdated);
    socket.on('object:deleted', handleObjectDeleted);

    return () => {
      socket.off('object:created', handleObjectCreated);
      socket.off('object:updated', handleObjectUpdated);
      socket.off('object:deleted', handleObjectDeleted);
    };
  }, [room, updateObject, deleteObject]);

  // Update stage size on mount and resize
  useEffect(() => {
    const updateSize = () => {
      if (stageRef.current) {
        const stageContainer = stageRef.current.container() as HTMLDivElement;
        const surface = stageContainer.parentElement as HTMLDivElement | null;
        const measuredElement = surface ?? stageContainer;
        const rect = measuredElement.getBoundingClientRect();

        setStageSize({
          width: Math.max(320, Math.floor(rect.width)),
          height: Math.max(280, Math.floor(rect.height)),
        });
      }
    };

    updateSize();
    const stageContainer = stageRef.current?.container() as HTMLDivElement | undefined;
    const surface = stageContainer?.parentElement as HTMLDivElement | null;
    const resizeObserver = surface ? new ResizeObserver(updateSize) : null;
    if (surface && resizeObserver) {
      resizeObserver.observe(surface);
    }

    window.addEventListener('resize', updateSize);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  // Mouse down: start panning (but not if clicking on an object)
  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    // Only pan on left mouse button (button 0) and only on Stage (not on objects)
    if (e.evt.button !== 0) return;
    
    const clickedStage = e.target === e.target.getStage();

    if (clickedStage) {
      setSelectedObjectId(null);
      isPanning.current = true;
      lastMousePos.current = { x: e.evt.clientX, y: e.evt.clientY };
      return;
    }

    const parentGroup = e.target.findAncestor('Group');
    const objectId = parentGroup?.id();
    if (objectId) {
      setSelectedObjectId(objectId);
    }
  }, []);

  // Mouse move: pan if dragging
  const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!isPanning.current) return;

    const deltaX = e.evt.clientX - lastMousePos.current.x;
    const deltaY = e.evt.clientY - lastMousePos.current.y;

    panBy(deltaX, deltaY);
    lastMousePos.current = { x: e.evt.clientX, y: e.evt.clientY };
  }, [panBy]);

  // Mouse up: stop panning
  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  // Wheel: zoom toward/away from mouse position
  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();

    // Determine zoom direction: wheel up (negative deltaY) = zoom in (>1), down = zoom out (<1)
    const zoomFactor = e.evt.deltaY < 0 ? 1.1 : 0.9;
    
    // Get mouse position in screen space
    const mouseX = e.evt.clientX;
    const mouseY = e.evt.clientY;
    
    zoomBy(zoomFactor, mouseX, mouseY);
  }, [zoomBy]);

  return (
    <div className="canvas-surface" role="region" aria-label="Infinite canvas workspace" aria-busy={loadingPhase !== null}>
      <div className="canvas-toolbar" role="toolbar" aria-label="Object creation toolbar">
        <div className="tool-actions" aria-label="Shape tools">
          {TOOLBAR_ITEMS.map((tool) => (
            <button
              key={tool.type}
              type="button"
              className={activeTool === tool.type ? 'tool-btn active' : 'tool-btn'}
              onClick={() => createObjectAndSync(tool.type)}
              title={`${tool.label} (${tool.hotkey})`}
              aria-label={`${tool.label} (${tool.hotkey})`}
            >
              <span aria-hidden="true">{tool.icon}</span>
            </button>
          ))}
          <button
            type="button"
            className="tool-btn"
            onClick={() => openUploadPicker('image')}
            disabled={uploadInProgress}
            title="Upload Image"
            aria-label="Upload image"
          >
            <span aria-hidden="true">IMG+</span>
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={() => openUploadPicker('audio')}
            disabled={uploadInProgress}
            title="Upload Audio"
            aria-label="Upload audio"
          >
            <span aria-hidden="true">AUD+</span>
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={() => openUploadPicker('video')}
            disabled={uploadInProgress}
            title="Upload Video"
            aria-label="Upload video"
          >
            <span aria-hidden="true">VID+</span>
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={handleExportPng}
            title="Export PNG"
            aria-label="Export PNG"
          >
            <span aria-hidden="true">PNG</span>
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={handleExportJson}
            title="Export JSON"
            aria-label="Export JSON"
          >
            <span aria-hidden="true">JSON</span>
          </button>
        </div>
        <div className="toolbar-meta">
          <span className={loadingPhase ? 'users-chip users-chip--loading' : 'users-chip'} aria-label={`Users in room: ${participantCount}`}>
            {loadingPhase ? 'Syncing...' : `${participantCount} users`}
          </span>
          {uploadInProgress && uploadLabel ? (
            <span className="users-chip users-chip--loading" aria-label="Upload in progress">
              {uploadLabel} {uploadProgress}%
            </span>
          ) : null}
          {failedUpload ? (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                void runMediaUpload(failedUpload.mediaType, failedUpload.files);
              }}
              aria-label="Retry failed upload"
              title={failedUpload.message}
            >
              Retry Upload
            </button>
          ) : null}
          {selectedObjectId && (
            <button
              type="button"
              className="delete-btn"
              onClick={() => deleteObjectAndSync(selectedObjectId)}
              aria-label="Delete selected object"
              title="Delete selected object"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {loadingPhase && loadingCopy ? <LoadingOverlay message={loadingCopy.title} subMessage={loadingCopy.sub} /> : null}

      <Stage
        ref={stageRef}
        width={stageSize.width}
        height={stageSize.height}
        x={offsetX}
        y={offsetY}
        scaleX={scale}
        scaleY={scale}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        style={{
          cursor: isPanning.current ? 'grabbing' : 'grab',
          touchAction: 'none',
          borderRadius: '14px',
          boxShadow: 'inset 0 0 0 1px rgba(148, 163, 184, 0.35)',
          background: 'linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)',
        }}
      >
        <Layer>
          {objects.map((obj) => (
            <ObjectRenderer
              key={obj.id}
              object={obj}
              selected={selectedObjectId === obj.id}
              onMove={(x, y) => {
                updateObject(obj.id, { x, y });
                emitUpdate(obj.id, { x, y });
              }}
              onDelete={() => deleteObjectAndSync(obj.id)}
              onResize={(width, height) => {
                updateObject(obj.id, { width, height });
                emitUpdate(obj.id, { width, height });
              }}
            />
          ))}
        </Layer>
      </Stage>

      <input
        ref={imageUploadInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(event) => {
          void handlePickerChanged('image', event.target.files);
        }}
      />
      <input
        ref={audioUploadInputRef}
        type="file"
        accept="audio/mpeg,audio/wav,audio/x-wav,audio/ogg,audio/mp4,audio/webm"
        multiple
        hidden
        onChange={(event) => {
          void handlePickerChanged('audio', event.target.files);
        }}
      />
      <input
        ref={videoUploadInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/ogg"
        multiple
        hidden
        onChange={(event) => {
          void handlePickerChanged('video', event.target.files);
        }}
      />
    </div>
  );
};
