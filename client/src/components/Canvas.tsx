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
}

const TOOLBAR_ITEMS: Array<{ type: CanvasObjectType; label: string; hotkey: string; icon: string }> = [
  { type: 'rectangle', label: 'Rectangle', hotkey: 'R', icon: '[]' },
  { type: 'circle', label: 'Circle', hotkey: 'C', icon: '()' },
  { type: 'text', label: 'Text', hotkey: 'T', icon: 'T' },
  { type: 'sticky-note', label: 'Sticky Note', hotkey: 'S', icon: 'SN' },
  { type: 'image', label: 'Image', hotkey: 'I', icon: 'IMG' },
  { type: 'audio', label: 'Audio', hotkey: 'A', icon: 'AUD' },
];

export const Canvas: React.FC<CanvasProps> = ({
  participantCount,
  loadingPhase = null,
  loadingCopy = null,
  onObjectDeleted,
}) => {
  const stageRef = useRef<Konva.Stage>(null);
  const [stageSize, setStageSize] = useState({ width: 1024, height: 768 });
  const [activeTool, setActiveTool] = useState<CanvasObjectType | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  
  // Viewport state: pan and zoom transforms
  const { offsetX, offsetY, scale, panBy, zoomBy } = useViewportStore((s) => ({
    offsetX: s.offsetX,
    offsetY: s.offsetY,
    scale: s.scale,
    panBy: s.panBy,
    zoomBy: s.zoomBy,
  }));

  // Canvas objects: local CRUD state
  const { objects, addObject, updateObject, deleteObject } = useCanvasObjectsStore((s) => ({
    objects: s.objects,
    addObject: s.addObject,
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

      // Use keyboard shortcuts: R=Rectangle, C=Circle, T=Text, S=Sticky Note, I=Image, A=Audio
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
        case 'i': {
          e.preventDefault();
          createObjectAndSync('image');
          break;
        }
        case 'a': {
          e.preventDefault();
          createObjectAndSync('audio');
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
        </div>
        <div className="toolbar-meta">
          <span className={loadingPhase ? 'users-chip users-chip--loading' : 'users-chip'} aria-label={`Users in room: ${participantCount}`}>
            {loadingPhase ? 'Syncing...' : `${participantCount} users`}
          </span>
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
    </div>
  );
};
