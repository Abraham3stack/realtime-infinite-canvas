import React, { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { Stage, Layer } from 'react-konva';
import Konva from 'konva';
import Matter from 'matter-js';
import { useViewportStore } from '../store/viewport.js';
import { useCanvasObjectsStore, type CanvasObject } from '../store/objects.js';
import { useRoomStore } from '../store/room.js';
import { ObjectRenderer } from './ObjectRenderer.js';
import { MiniMapRadar } from './MiniMapRadar.js';
import { LoadingOverlay } from './ui/LoadingOverlay.js';
import { socket } from '../socket.js';
import type { CanvasObjectType } from '../store/objects.js';
import { uploadMediaFiles, type MediaUploadType, type UploadedMedia } from '../hooks/useMediaUpload.js';
import { canvasCenterToWorld, clientToCanvasPoint } from '../utils/coordinates.js';
import { type RoomPhysicsState, usePhysicsStore } from '../store/physics.js';

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

interface PhysicsStatePayload {
  roomId: string;
  state: RoomPhysicsState;
  serverTs: string;
}

interface PresenceUpdatedPayload {
  participantId: string;
  sessionId: string;
  roomId: string;
  viewport?: {
    x: number;
    y: number;
    zoom: number;
    width?: number;
    height?: number;
  };
  status: 'active' | 'idle' | 'disconnected';
  serverTs: string;
}

interface DragVelocitySample {
  startX: number;
  startY: number;
  startAt: number;
  lastX: number;
  lastY: number;
  lastAt: number;
}

const PHYSICS_OBJECT_TYPES: CanvasObjectType[] = ['rectangle', 'circle'];
const PHYSICS_OBJECT_TYPE_SET = new Set<CanvasObjectType>(PHYSICS_OBJECT_TYPES);
const PHYSICS_SYNC_INTERVAL_MS = 80;
const PHYSICS_DRAG_VELOCITY_MAX = 2.5;
const PRESENCE_SYNC_INTERVAL_MS = 120;

function isPhysicsObjectType(type: CanvasObjectType): boolean {
  return PHYSICS_OBJECT_TYPE_SET.has(type);
}

function buildMatterBodyFromObject(
  object: CanvasObject,
  physics: RoomPhysicsState,
  pinned: boolean
): Matter.Body {
  const common = {
    restitution: physics.restitution,
    frictionAir: physics.frictionAir,
    friction: 0.1,
    isStatic: pinned,
    angle: object.rotation,
  };

  if (object.type === 'circle') {
    const radius = Math.max(8, object.width / 2);
    return Matter.Bodies.circle(object.x + radius, object.y + radius, radius, common);
  }

  return Matter.Bodies.rectangle(
    object.x + object.width / 2,
    object.y + object.height / 2,
    Math.max(16, object.width),
    Math.max(16, object.height),
    common
  );
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

/**
 * Toolbar order is intentionally stable so power users can build muscle memory
 * around icon positions in addition to keyboard shortcuts.
 */
const TOOLBAR_ITEMS: Array<{ type: CanvasObjectType; label: string; hotkey: string; icon: string }> = [
  { type: 'rectangle', label: 'Rectangle', hotkey: 'R', icon: '[]' },
  { type: 'circle', label: 'Circle', hotkey: 'C', icon: '()' },
  { type: 'text', label: 'Text', hotkey: 'T', icon: 'T' },
  { type: 'sticky-note', label: 'Sticky Note', hotkey: 'S', icon: 'SN' },
];

/**
 * Canvas is the collaboration surface where local optimistic edits are merged
 * with server-broadcast updates.
 *
 * Design invariants:
 * - Store coordinates are world-space values, while Konva pointer events begin in
 *   browser/client coordinates; conversion happens at interaction boundaries.
 * - Local operations emit an operationId so socket echoes can be recognized and
 *   deduplicated without suppressing remote participant updates.
 * - Pan/zoom input is batched with requestAnimationFrame to cap state writes and
 *   avoid flooding React/Konva with per-event updates under high input rates.
 */
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
  const { offsetX, offsetY, scale, panBy, zoomBy, setPan } = useViewportStore((s) => ({
    offsetX: s.offsetX,
    offsetY: s.offsetY,
    scale: s.scale,
    panBy: s.panBy,
    zoomBy: s.zoomBy,
    setPan: s.setPan,
  }));

  // Canvas objects: local CRUD state
  const { objects, addObject, addMediaObject, updateObject, deleteObject } = useCanvasObjectsStore((s) => ({
    objects: s.objects,
    addObject: s.addObject,
    addMediaObject: s.addMediaObject,
    updateObject: s.updateObject,
    deleteObject: s.deleteObject,
  }));
  const { room } = useRoomStore((s) => ({ room: s.room }));
  const participants = useRoomStore((s) => s.participants);
  const roomPhysics = usePhysicsStore((s) => s.roomPhysics);
  const setRoomPhysics = usePhysicsStore((s) => s.setRoomPhysics);

  // Tracks optimistic operations until their server echo returns.
  // This prevents duplicate application of local writes while preserving all
  // remote participant updates.
  const pendingOperations = useRef<Set<string>>(new Set());
  const panRafRef = useRef<number | null>(null);
  const pendingPanRef = useRef({ dx: 0, dy: 0 });
  const zoomRafRef = useRef<number | null>(null);
  const pendingZoomRef = useRef<{ deltaY: number; mouseX: number; mouseY: number } | null>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const runnerRef = useRef<Matter.Runner | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const bodyMapRef = useRef<Map<string, Matter.Body>>(new Map());
  const boundsRef = useRef<{ floorY: number; leftX: number; rightX: number } | null>(null);
  const resetSnapshotRef = useRef<Map<string, { x: number; y: number; rotation: number }>>(new Map());
  const lastSyncTsRef = useRef(0);
  const dragVelocityRef = useRef<Map<string, DragVelocitySample>>(new Map());
  const roomPhysicsRef = useRef(roomPhysics);
  const pinnedSetRef = useRef<Set<string>>(new Set());
  const presenceSyncRef = useRef<{ lastSentAt: number; timer: number | null }>({
    lastSentAt: 0,
    timer: null,
  });

  const isPhysicsAuthority = useMemo(() => {
    if (!room?.createdBySessionId || !sessionId) return false;
    return room.createdBySessionId === sessionId;
  }, [room?.createdBySessionId, sessionId]);

  const pinnedSet = useMemo(() => new Set(roomPhysics.staticObjectIds), [roomPhysics.staticObjectIds]);
  const physicsStructureSignature = useMemo(() => {
    return objects
      .filter((object) => isPhysicsObjectType(object.type))
      .map((object) => `${object.id}:${object.type}:${Math.round(object.width)}:${Math.round(object.height)}`)
      .sort()
      .join('|');
  }, [objects]);
  const physicsPinnedSignature = useMemo(() => roomPhysics.staticObjectIds.slice().sort().join('|'), [roomPhysics.staticObjectIds]);

  useEffect(() => {
    roomPhysicsRef.current = roomPhysics;
  }, [roomPhysics]);

  useEffect(() => {
    pinnedSetRef.current = pinnedSet;
  }, [pinnedSet]);

  /**
   * Generates a per-operation correlation id used for optimistic echo handling.
   * No global ordering guarantee is assumed from this id.
   */
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

  const emitPhysicsStatePatch = useCallback((patch: Partial<RoomPhysicsState>) => {
    if (!room) return;
    socket.emit('physics:update-state', {
      roomId: room.id,
      patch,
    });
  }, [room]);

  const emitPhysicsSetStatic = useCallback((objectId: string, isStatic: boolean) => {
    if (!room) return;
    socket.emit('physics:set-static', {
      roomId: room.id,
      objectId,
      isStatic,
    });
  }, [room]);

  const emitPhysicsReset = useCallback(() => {
    if (!room) return;
    socket.emit('physics:reset', {
      roomId: room.id,
    });
  }, [room]);

  const createObjectAndSync = useCallback((type: CanvasObjectType) => {
    if (!room) return;

    // Objects are created at viewport center in world-space so creation remains
    // predictable regardless of current pan/zoom.
    const center = canvasCenterToWorld(stageSize, { offsetX, offsetY, scale });

    const id = addObject(type, center.x, center.y);
    const object = useCanvasObjectsStore.getState().getObject(id);
    if (!object) return;

    setActiveTool(type);
    setSelectedObjectId(id);
    emitCreate(object);
  }, [addObject, emitCreate, offsetX, offsetY, room, scale, stageSize]);

  const createMediaObjectsAndSync = useCallback((uploads: UploadedMedia[]) => {
    if (!room) return;

    const center = canvasCenterToWorld(stageSize, { offsetX, offsetY, scale });

    const createdIds: string[] = [];

    uploads.forEach((upload, index) => {
      const type = upload.resourceType;
      const id = addMediaObject({
        type,
        x: center.x + index * 28,
        y: center.y + index * 22,
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
        // Normalize invalid/placeholder media dimensions to null so exported JSON
        // mirrors persisted semantics used by downstream validation tooling.
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

  const moveObjectAndSync = useCallback((objectId: string, x: number, y: number) => {
    const existing = useCanvasObjectsStore.getState().getObject(objectId);
    if (!existing) return;

    if (roomPhysics.enabled && isPhysicsObjectType(existing.type)) {
      const body = bodyMapRef.current.get(objectId);
      if (body) {
        Matter.Body.setPosition(body, {
          x: x + existing.width / 2,
          y: y + existing.height / 2,
        });
      }

      const velocity = dragVelocityRef.current.get(objectId);
      if (body && velocity) {
        const dtMs = Math.max(1, velocity.lastAt - velocity.startAt);
        const vxPerMs = (velocity.lastX - velocity.startX) / dtMs;
        const vyPerMs = (velocity.lastY - velocity.startY) / dtMs;
        const fallbackVx = (x - existing.x) * 0.01;
        const fallbackVy = (y - existing.y) * 0.01;
        const mergedVx = Math.abs(vxPerMs * 16.666) > 0.05 ? vxPerMs * 16.666 : fallbackVx;
        const mergedVy = Math.abs(vyPerMs * 16.666) > 0.05 ? vyPerMs * 16.666 : fallbackVy;
        const vx = Math.max(-PHYSICS_DRAG_VELOCITY_MAX, Math.min(PHYSICS_DRAG_VELOCITY_MAX, mergedVx));
        const vy = Math.max(-PHYSICS_DRAG_VELOCITY_MAX, Math.min(PHYSICS_DRAG_VELOCITY_MAX, mergedVy));
        Matter.Body.setVelocity(body, { x: vx, y: vy });
      }

      updateObject(objectId, { x, y });

      if (!isPhysicsAuthority) {
        emitUpdate(objectId, { x, y });
      }

      return;
    }

    // No-op suppression reduces avoidable socket traffic and DB writes during
    // drag paths that report duplicate positions.
    if (existing.x === x && existing.y === y) return;

    updateObject(objectId, { x, y });
    emitUpdate(objectId, { x, y });
  }, [emitUpdate, isPhysicsAuthority, roomPhysics.enabled, updateObject]);

  const resizeObjectAndSync = useCallback((objectId: string, width: number, height: number) => {
    const existing = useCanvasObjectsStore.getState().getObject(objectId);
    if (!existing) return;

    // No-op suppression mirrors move semantics for resize updates.
    if (existing.width === width && existing.height === height) return;

    updateObject(objectId, { width, height });
    emitUpdate(objectId, { width, height });
  }, [emitUpdate, updateObject]);

  const handleObjectDragStart = useCallback((objectId: string) => {
    const existing = useCanvasObjectsStore.getState().getObject(objectId);
    if (!existing) return;

    dragVelocityRef.current.set(objectId, {
      startX: existing.x,
      startY: existing.y,
      startAt: performance.now(),
      lastX: existing.x,
      lastY: existing.y,
      lastAt: performance.now(),
    });

    if (!roomPhysics.enabled || !isPhysicsObjectType(existing.type)) return;
    const body = bodyMapRef.current.get(objectId);
    if (!body) return;
    Matter.Body.setStatic(body, false);
    Matter.Body.setVelocity(body, { x: 0, y: 0 });
  }, [roomPhysics.enabled]);

  const handleObjectDragMove = useCallback((objectId: string, x: number, y: number) => {
    const existing = useCanvasObjectsStore.getState().getObject(objectId);
    if (!existing) return;

    const previous = dragVelocityRef.current.get(objectId);
    const now = performance.now();
    if (previous) {
      dragVelocityRef.current.set(objectId, {
        startX: previous.startX,
        startY: previous.startY,
        startAt: previous.startAt,
        lastX: x,
        lastY: y,
        lastAt: now,
      });
    } else {
      dragVelocityRef.current.set(objectId, {
        startX: x,
        startY: y,
        startAt: now,
        lastX: x,
        lastY: y,
        lastAt: now,
      });
    }

    if (!roomPhysics.enabled || !isPhysicsObjectType(existing.type)) return;

    const body = bodyMapRef.current.get(objectId);
    if (!body) return;

    Matter.Body.setPosition(body, {
      x: x + existing.width / 2,
      y: y + existing.height / 2,
    });
  }, [roomPhysics.enabled]);

  const resetPhysicsSnapshotFromCurrentObjects = useCallback(() => {
    const next = new Map<string, { x: number; y: number; rotation: number }>();
    const currentObjects = useCanvasObjectsStore.getState().objects;
    currentObjects.forEach((object) => {
      if (!isPhysicsObjectType(object.type)) return;
      next.set(object.id, {
        x: object.x,
        y: object.y,
        rotation: object.rotation,
      });
    });
    resetSnapshotRef.current = next;
  }, []);

  const ensureMatterRuntime = useCallback(() => {
    if (engineRef.current && runnerRef.current) {
      return;
    }

    const engine = Matter.Engine.create();
    engine.positionIterations = 10;
    engine.velocityIterations = 8;
    engine.gravity.scale = 0.01;
    engine.gravity.x = 0;
    engine.gravity.y = roomPhysics.gravityY;
    runnerRef.current = Matter.Runner.create();
    engineRef.current = engine;
  }, [roomPhysics.gravityY]);

  const clearMatterRuntime = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (runnerRef.current && engineRef.current) {
      Matter.Runner.stop(runnerRef.current);
      Matter.World.clear(engineRef.current.world, false);
      Matter.Engine.clear(engineRef.current);
    }

    bodyMapRef.current.clear();
    boundsRef.current = null;
    engineRef.current = null;
    runnerRef.current = null;
  }, []);

  const rebuildBodiesFromObjects = useCallback(() => {
    ensureMatterRuntime();
    const engine = engineRef.current;
    if (!engine) return;

    const currentPhysics = roomPhysicsRef.current;
    const currentPinnedSet = pinnedSetRef.current;
    const currentObjects = useCanvasObjectsStore.getState().objects;

    Matter.World.clear(engine.world, false);
    bodyMapRef.current.clear();

    const nextBodies: Matter.Body[] = [];
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    currentObjects.forEach((object) => {
      if (!isPhysicsObjectType(object.type)) return;

      const body = buildMatterBodyFromObject(object, currentPhysics, currentPinnedSet.has(object.id));
      body.label = object.id;
      bodyMapRef.current.set(object.id, body);
      nextBodies.push(body);

      minX = Math.min(minX, object.x);
      minY = Math.min(minY, object.y);
      maxX = Math.max(maxX, object.x + object.width);
      maxY = Math.max(maxY, object.y + object.height);
    });

    if (nextBodies.length > 0) {
      // Keep the arena comfortably larger than object bounds so collisions are
      // observable and stable instead of happening at near-zero drop distance.
      const wallThickness = 200;
      const horizontalPadding = 600;
      const floorGap = 420;
      const sideGap = 260;

      const centerX = (minX + maxX) / 2;
      const spanWidth = Math.max(2200, maxX - minX + horizontalPadding * 2);
      const spanHeight = Math.max(2600, maxY - minY + floorGap + sideGap);
      const floorCenterY = maxY + floorGap + wallThickness / 2;
      const sideCenterY = maxY + floorGap / 2;
      const leftWallX = minX - sideGap;
      const rightWallX = maxX + sideGap;

      boundsRef.current = {
        floorY: floorCenterY - wallThickness / 2,
        leftX: leftWallX + wallThickness / 2,
        rightX: rightWallX - wallThickness / 2,
      };

      nextBodies.push(
        Matter.Bodies.rectangle(centerX, floorCenterY, spanWidth, wallThickness, { isStatic: true }),
        Matter.Bodies.rectangle(leftWallX, sideCenterY, wallThickness, spanHeight, { isStatic: true }),
        Matter.Bodies.rectangle(rightWallX, sideCenterY, wallThickness, spanHeight, { isStatic: true })
      );
    } else {
      boundsRef.current = null;
    }

    Matter.World.add(engine.world, nextBodies);
    engine.gravity.y = currentPhysics.gravityY;
  }, [ensureMatterRuntime]);

  const syncObjectFromBody = useCallback((objectId: string, body: Matter.Body) => {
    const existing = useCanvasObjectsStore.getState().getObject(objectId);
    if (!existing) return;

    const nextX = body.position.x - existing.width / 2;
    const nextY = body.position.y - existing.height / 2;
    const nextRotation = body.angle;

    if (
      Math.abs(existing.x - nextX) < 0.25 &&
      Math.abs(existing.y - nextY) < 0.25 &&
      Math.abs(existing.rotation - nextRotation) < 0.01
    ) {
      return;
    }

    updateObject(objectId, {
      x: nextX,
      y: nextY,
      rotation: nextRotation,
    });
  }, [updateObject]);

  const applyPhysicsReset = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;

    for (const [objectId, body] of bodyMapRef.current.entries()) {
      const snapshot = resetSnapshotRef.current.get(objectId);
      const existing = useCanvasObjectsStore.getState().getObject(objectId);
      if (!snapshot || !existing) continue;

      const centerX = snapshot.x + existing.width / 2;
      const centerY = snapshot.y + existing.height / 2;

      Matter.Body.setVelocity(body, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(body, 0);
      Matter.Body.setPosition(body, { x: centerX, y: centerY });
      Matter.Body.setAngle(body, snapshot.rotation);

      updateObject(objectId, {
        x: snapshot.x,
        y: snapshot.y,
        rotation: snapshot.rotation,
      });

      if (isPhysicsAuthority) {
        emitUpdate(objectId, {
          x: snapshot.x,
          y: snapshot.y,
          rotation: snapshot.rotation,
        });
      }
    }
  }, [emitUpdate, isPhysicsAuthority, updateObject]);

  useEffect(() => {
    if (!room || !roomPhysics.enabled) {
      clearMatterRuntime();
      return;
    }

    ensureMatterRuntime();
    rebuildBodiesFromObjects();

    if (resetSnapshotRef.current.size === 0) {
      resetPhysicsSnapshotFromCurrentObjects();
    }

    return () => {
      if (!room) {
        clearMatterRuntime();
      }
    };
  }, [
    room,
    roomPhysics.enabled,
    physicsStructureSignature,
    physicsPinnedSignature,
    clearMatterRuntime,
    ensureMatterRuntime,
    rebuildBodiesFromObjects,
    resetPhysicsSnapshotFromCurrentObjects,
  ]);

  useEffect(() => {
    if (!roomPhysics.enabled) return;

    for (const body of bodyMapRef.current.values()) {
      body.restitution = roomPhysics.restitution;
      body.frictionAir = roomPhysics.frictionAir;
      body.friction = 0.1;
    }
  }, [roomPhysics.enabled, roomPhysics.frictionAir, roomPhysics.restitution]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.gravity.x = 0;
    engine.gravity.y = roomPhysics.gravityY;
  }, [roomPhysics.gravityY]);

  useEffect(() => {
    if (!roomPhysics.enabled) return;
    applyPhysicsReset();
  }, [applyPhysicsReset, roomPhysics.enabled, roomPhysics.resetNonce]);

  useEffect(() => {
    if (!roomPhysics.enabled || !roomPhysics.simulationRunning || !isPhysicsAuthority) {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    ensureMatterRuntime();
    const engine = engineRef.current;
    if (!engine) return;

    const tick = () => {
      Matter.Engine.update(engine, 1000 / 60);

      const updates: Array<{ objectId: string; x: number; y: number; rotation: number }> = [];

      for (const [objectId, body] of bodyMapRef.current.entries()) {
        const existing = useCanvasObjectsStore.getState().getObject(objectId);
        if (!existing) continue;

        const x = body.position.x - existing.width / 2;
        const y = body.position.y - existing.height / 2;
        const rotation = body.angle;

        const moved =
          Math.abs(existing.x - x) >= 0.25 ||
          Math.abs(existing.y - y) >= 0.25 ||
          Math.abs(existing.rotation - rotation) >= 0.01;

        syncObjectFromBody(objectId, body);
        if (moved) {
          updates.push({ objectId, x, y, rotation });
        }
      }

      const now = performance.now();
      if (room && now - lastSyncTsRef.current >= PHYSICS_SYNC_INTERVAL_MS) {
        for (const update of updates) {
          emitUpdate(update.objectId, {
            x: update.x,
            y: update.y,
            rotation: update.rotation,
          });
        }
        lastSyncTsRef.current = now;
      }

      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [
    emitUpdate,
    ensureMatterRuntime,
    isPhysicsAuthority,
    room,
    roomPhysics.enabled,
    roomPhysics.simulationRunning,
    syncObjectFromBody,
  ]);

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

  // Subscriptions are attached only while in-room so handlers cannot leak across
  // room transitions.
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

      // Functional add avoids stale snapshot races during bursty create broadcasts.
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

      const current = useCanvasObjectsStore.getState().getObject(objectId);
      const body = bodyMapRef.current.get(objectId);
      if (!current || !body || !isPhysicsObjectType(current.type)) return;

      const nextX = typeof updates.x === 'number' ? updates.x : current.x;
      const nextY = typeof updates.y === 'number' ? updates.y : current.y;
      const nextRotation = typeof updates.rotation === 'number' ? updates.rotation : current.rotation;
      Matter.Body.setPosition(body, {
        x: nextX + current.width / 2,
        y: nextY + current.height / 2,
      });
      Matter.Body.setAngle(body, nextRotation);
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
  }, [deleteObject, room, updateObject]);

  useEffect(() => {
    if (!room) return;

    const handlePhysicsState = (payload: PhysicsStatePayload) => {
      if (!payload || payload.roomId !== room.id || !payload.state) return;
      setRoomPhysics(payload.state);
    };

    const handlePresenceUpdated = (payload: PresenceUpdatedPayload) => {
      if (!payload || payload.roomId !== room.id || !payload.participantId) return;

      useRoomStore.getState().updateParticipantPresence(payload.participantId, {
        sessionId: payload.sessionId,
        lastViewportX: payload.viewport?.x,
        lastViewportY: payload.viewport?.y,
        lastViewportZoom: payload.viewport?.zoom,
        lastViewportWidth: payload.viewport?.width,
        lastViewportHeight: payload.viewport?.height,
        presenceStatus: payload.status,
        presenceTs: payload.serverTs,
      });
    };

    socket.on('physics:state', handlePhysicsState);
    socket.on('presence:updated', handlePresenceUpdated);
    return () => {
      socket.off('physics:state', handlePhysicsState);
      socket.off('presence:updated', handlePresenceUpdated);
    };
  }, [room, setRoomPhysics]);

  useEffect(() => {
    if (!room) return;

    const emitPresence = () => {
      socket.emit('presence:update', {
        roomId: room.id,
        status: 'active',
        viewport: {
          x: offsetX,
          y: offsetY,
          zoom: scale,
          width: stageSize.width,
          height: stageSize.height,
        },
      });
      presenceSyncRef.current.lastSentAt = Date.now();
    };

    const now = Date.now();
    const elapsed = now - presenceSyncRef.current.lastSentAt;
    const remaining = PRESENCE_SYNC_INTERVAL_MS - elapsed;

    if (remaining <= 0) {
      if (presenceSyncRef.current.timer !== null) {
        window.clearTimeout(presenceSyncRef.current.timer);
        presenceSyncRef.current.timer = null;
      }
      emitPresence();
      return;
    }

    if (presenceSyncRef.current.timer === null) {
      presenceSyncRef.current.timer = window.setTimeout(() => {
        presenceSyncRef.current.timer = null;
        emitPresence();
      }, remaining);
    }
  }, [offsetX, offsetY, room, scale, stageSize.height, stageSize.width]);

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

  // Mouse move: pan if dragging.
  // Input events can arrive much faster than paint frames; batching pan deltas in
  // rAF keeps interaction smooth under sustained pointer movement.
  const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!isPanning.current) return;

    const deltaX = e.evt.clientX - lastMousePos.current.x;
    const deltaY = e.evt.clientY - lastMousePos.current.y;

    pendingPanRef.current.dx += deltaX;
    pendingPanRef.current.dy += deltaY;
    if (panRafRef.current === null) {
      panRafRef.current = window.requestAnimationFrame(() => {
        const { dx, dy } = pendingPanRef.current;
        pendingPanRef.current = { dx: 0, dy: 0 };
        panRafRef.current = null;
        if (dx !== 0 || dy !== 0) {
          panBy(dx, dy);
        }
      });
    }

    lastMousePos.current = { x: e.evt.clientX, y: e.evt.clientY };
  }, [panBy]);

  // Mouse up: stop panning
  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
    if (panRafRef.current !== null) {
      window.cancelAnimationFrame(panRafRef.current);
      panRafRef.current = null;
      pendingPanRef.current = { dx: 0, dy: 0 };
    }
  }, []);

  // Wheel: zoom toward/away from mouse position.
  // Coalescing wheel deltas per frame prevents runaway zoom acceleration on
  // high-resolution trackpads while preserving intent.
  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();

    const stage = e.target.getStage();
    if (!stage) return;

    // Convert viewport client coordinates to canvas-local coordinates before zoom.
    // Passing raw clientX/clientY here can shift zoom focus and mimic hit-test drift.
    const pointer = clientToCanvasPoint(
      e.evt.clientX,
      e.evt.clientY,
      stage.container().getBoundingClientRect()
    );

    const pending = pendingZoomRef.current;
    if (pending) {
      pending.deltaY += e.evt.deltaY;
      pending.mouseX = pointer.x;
      pending.mouseY = pointer.y;
    } else {
      pendingZoomRef.current = {
        deltaY: e.evt.deltaY,
        mouseX: pointer.x,
        mouseY: pointer.y,
      };
    }

    if (zoomRafRef.current === null) {
      zoomRafRef.current = window.requestAnimationFrame(() => {
        const next = pendingZoomRef.current;
        pendingZoomRef.current = null;
        zoomRafRef.current = null;
        if (!next) return;

        const normalizedDelta = Math.max(-120, Math.min(120, next.deltaY));
        const zoomFactor = Math.exp(-normalizedDelta * 0.0015);
        zoomBy(zoomFactor, next.mouseX, next.mouseY);
      });
    }
  }, [zoomBy]);

  useEffect(() => {
    return () => {
      if (panRafRef.current !== null) {
        window.cancelAnimationFrame(panRafRef.current);
      }
      if (zoomRafRef.current !== null) {
        window.cancelAnimationFrame(zoomRafRef.current);
      }
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      if (presenceSyncRef.current.timer !== null) {
        window.clearTimeout(presenceSyncRef.current.timer);
      }
      clearMatterRuntime();
    };
  }, [clearMatterRuntime]);

  const selectedObject = useMemo(() => {
    if (!selectedObjectId) return null;
    return objects.find((object) => object.id === selectedObjectId) ?? null;
  }, [objects, selectedObjectId]);

  const selectedObjectSupportsPhysics = Boolean(selectedObject && isPhysicsObjectType(selectedObject.type));
  const selectedObjectIsPinned = Boolean(selectedObject && pinnedSet.has(selectedObject.id));

  const handleTogglePhysicsMode = useCallback(() => {
    const nextEnabled = !roomPhysics.enabled;
    if (nextEnabled) {
      resetPhysicsSnapshotFromCurrentObjects();
    }
    emitPhysicsStatePatch({
      enabled: nextEnabled,
      simulationRunning: nextEnabled,
    });
  }, [emitPhysicsStatePatch, resetPhysicsSnapshotFromCurrentObjects, roomPhysics.enabled]);

  const handleToggleSimulation = useCallback(() => {
    if (!roomPhysics.enabled) return;
    emitPhysicsStatePatch({
      simulationRunning: !roomPhysics.simulationRunning,
    });
  }, [emitPhysicsStatePatch, roomPhysics.enabled, roomPhysics.simulationRunning]);

  const handleAdjustGravity = useCallback((delta: number) => {
    emitPhysicsStatePatch({
      gravityY: Math.max(0, Math.min(10, roomPhysics.gravityY + delta)),
    });
  }, [emitPhysicsStatePatch, roomPhysics.gravityY]);

  const handleAdjustRestitution = useCallback((delta: number) => {
    emitPhysicsStatePatch({
      restitution: Math.max(0, Math.min(1.2, Number((roomPhysics.restitution + delta).toFixed(2)))),
    });
  }, [emitPhysicsStatePatch, roomPhysics.restitution]);

  const handleAdjustFrictionAir = useCallback((delta: number) => {
    emitPhysicsStatePatch({
      frictionAir: Math.max(0, Math.min(0.2, Number((roomPhysics.frictionAir + delta).toFixed(3)))),
    });
  }, [emitPhysicsStatePatch, roomPhysics.frictionAir]);

  const handleTogglePinned = useCallback(() => {
    if (!selectedObject || !selectedObjectSupportsPhysics) return;
    emitPhysicsSetStatic(selectedObject.id, !selectedObjectIsPinned);
  }, [emitPhysicsSetStatic, selectedObject, selectedObjectIsPinned, selectedObjectSupportsPhysics]);

  const handleResetPhysics = useCallback(() => {
    emitPhysicsReset();
  }, [emitPhysicsReset]);

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
          <button
            type="button"
            className={roomPhysics.enabled ? 'tool-btn active' : 'tool-btn'}
            onClick={handleTogglePhysicsMode}
            aria-label="Toggle physics mode"
            title="Physics mode"
          >
            <span aria-hidden="true">PHY</span>
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={handleToggleSimulation}
            disabled={!roomPhysics.enabled}
            aria-label="Toggle physics simulation"
            title={roomPhysics.simulationRunning ? 'Pause simulation' : 'Resume simulation'}
          >
            <span aria-hidden="true">{roomPhysics.simulationRunning ? 'Pause' : 'Run'}</span>
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={() => handleAdjustGravity(-0.1)}
            disabled={!roomPhysics.enabled}
            aria-label="Decrease gravity"
            title="Decrease gravity"
          >
            <span aria-hidden="true">G-</span>
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={() => handleAdjustGravity(0.1)}
            disabled={!roomPhysics.enabled}
            aria-label="Increase gravity"
            title="Increase gravity"
          >
            <span aria-hidden="true">G+</span>
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={() => handleAdjustRestitution(-0.05)}
            disabled={!roomPhysics.enabled}
            aria-label="Decrease restitution"
            title="Decrease restitution"
          >
            <span aria-hidden="true">B-</span>
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={() => handleAdjustRestitution(0.05)}
            disabled={!roomPhysics.enabled}
            aria-label="Increase restitution"
            title="Increase restitution"
          >
            <span aria-hidden="true">B+</span>
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={() => handleAdjustFrictionAir(-0.005)}
            disabled={!roomPhysics.enabled}
            aria-label="Decrease friction"
            title="Decrease friction"
          >
            <span aria-hidden="true">F-</span>
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={() => handleAdjustFrictionAir(0.005)}
            disabled={!roomPhysics.enabled}
            aria-label="Increase friction"
            title="Increase friction"
          >
            <span aria-hidden="true">F+</span>
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={handleTogglePinned}
            disabled={!roomPhysics.enabled || !selectedObjectSupportsPhysics}
            aria-label="Toggle static object"
            title={selectedObjectIsPinned ? 'Unpin selected object' : 'Pin selected object'}
          >
            <span aria-hidden="true">{selectedObjectIsPinned ? 'Unpin' : 'Pin'}</span>
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={handleResetPhysics}
            disabled={!roomPhysics.enabled}
            aria-label="Reset physics simulation"
            title="Reset physics simulation"
          >
            <span aria-hidden="true">Reset</span>
          </button>
          <span className={loadingPhase ? 'users-chip users-chip--loading' : 'users-chip'} aria-label={`Users in room: ${participantCount}`}>
            {loadingPhase ? 'Syncing...' : `${participantCount} users`}
          </span>
          {roomPhysics.enabled ? (
            <span className="users-chip" aria-label="Physics status">
              {isPhysicsAuthority ? 'Physics Host' : 'Physics Follower'} | g {roomPhysics.gravityY.toFixed(1)} | b {roomPhysics.restitution.toFixed(2)} | f {roomPhysics.frictionAir.toFixed(3)}
            </span>
          ) : null}
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
              draggable={!(roomPhysics.enabled && roomPhysics.simulationRunning && isPhysicsObjectType(obj.type) && pinnedSet.has(obj.id))}
              onDragStart={() => handleObjectDragStart(obj.id)}
              onDragMove={(x, y) => handleObjectDragMove(obj.id, x, y)}
              onMove={(x, y) => {
                moveObjectAndSync(obj.id, x, y);
              }}
              onDelete={() => deleteObjectAndSync(obj.id)}
              onResize={(width, height) => {
                resizeObjectAndSync(obj.id, width, height);
              }}
            />
          ))}
        </Layer>
      </Stage>

      <MiniMapRadar
        objects={objects}
        participants={participants}
        currentSessionId={sessionId}
        viewport={{ offsetX, offsetY, scale }}
        stageSize={stageSize}
        onSetPan={setPan}
      />

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
