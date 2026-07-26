import type { CanvasObject, CanvasObjectPatch } from '../types/canvas.js';
import type { RoomEvent } from '../types/events.js';

export interface ReplayPhysicsState {
  enabled: boolean;
  simulationRunning: boolean;
  gravityY: number;
  restitution: number;
  frictionAir: number;
  staticObjectIds: string[];
  resetNonce: number;
  revision: number;
}

export const DEFAULT_REPLAY_PHYSICS_STATE: ReplayPhysicsState = {
  enabled: false,
  simulationRunning: false,
  gravityY: 1,
  restitution: 0.75,
  frictionAir: 0.02,
  staticObjectIds: [],
  resetNonce: 0,
  revision: 1,
};

export interface ReplayState {
  roomId: string;
  objects: CanvasObject[];
  physics: ReplayPhysicsState;
  appliedEventCount: number;
  lastSequenceNumber: number | null;
}

export interface ReplayStore {
  initialize(events: RoomEvent[]): void;
  stepForward(): ReplayState;
  stepBackward(): ReplayState;
  reset(): ReplayState;
  getCurrentState(): ReplayState;
}

const OBJECT_TYPES = new Set<CanvasObject['type']>([
  'rectangle',
  'circle',
  'text',
  'sticky-note',
  'image',
  'audio',
  'video',
]);

const CLAMP_BOUNDS = {
  gravityY: { min: 0, max: 10 },
  restitution: { min: 0, max: 1.2 },
  frictionAir: { min: 0, max: 0.2 },
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cloneObject(object: CanvasObject): CanvasObject {
  return { ...object };
}

function cloneState(state: ReplayState): ReplayState {
  return {
    roomId: state.roomId,
    objects: state.objects.map(cloneObject),
    physics: {
      ...state.physics,
      staticObjectIds: [...state.physics.staticObjectIds],
    },
    appliedEventCount: state.appliedEventCount,
    lastSequenceNumber: state.lastSequenceNumber,
  };
}

function normalizeEvents(events: RoomEvent[]): RoomEvent[] {
  const ordered = [...events].sort((left, right) => left.sequenceNumber - right.sequenceNumber);

  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index];
    if (!current) continue;

    if (!Number.isInteger(current.sequenceNumber) || current.sequenceNumber <= 0) {
      throw new Error(`Invalid sequenceNumber: ${current.sequenceNumber}`);
    }

    const previous = ordered[index - 1];
    if (previous && previous.sequenceNumber === current.sequenceNumber) {
      throw new Error(`Duplicate sequenceNumber detected: ${current.sequenceNumber}`);
    }
  }

  return ordered;
}

function isReplayObjectCandidate(payload: unknown): payload is CanvasObject {
  if (typeof payload !== 'object' || payload === null) return false;

  const candidate = payload as Partial<CanvasObject>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.type === 'string' &&
    OBJECT_TYPES.has(candidate.type as CanvasObject['type']) &&
    isFiniteNumber(candidate.x) &&
    isFiniteNumber(candidate.y) &&
    isFiniteNumber(candidate.width) &&
    candidate.width > 0 &&
    isFiniteNumber(candidate.height) &&
    candidate.height > 0 &&
    isFiniteNumber(candidate.rotation) &&
    Number.isInteger(candidate.zIndex)
  );
}

function sortObjects(objects: CanvasObject[]): CanvasObject[] {
  return [...objects].sort((left, right) => {
    if (left.zIndex !== right.zIndex) {
      return left.zIndex - right.zIndex;
    }

    if (left.createdAt && right.createdAt && left.createdAt !== right.createdAt) {
      return left.createdAt.localeCompare(right.createdAt);
    }

    return left.id.localeCompare(right.id);
  });
}

function applyObjectUpdatePatch(target: CanvasObject, patch: CanvasObjectPatch): CanvasObject {
  const next = { ...target };

  if (isFiniteNumber(patch.x)) next.x = patch.x;
  if (isFiniteNumber(patch.y)) next.y = patch.y;
  if (isFiniteNumber(patch.rotation)) next.rotation = patch.rotation;
  if (isFiniteNumber(patch.width) && patch.width > 0) next.width = patch.width;
  if (isFiniteNumber(patch.height) && patch.height > 0) next.height = patch.height;
  if (isFiniteNumber(patch.zIndex) && Number.isInteger(patch.zIndex)) next.zIndex = patch.zIndex;

  if (typeof patch.color === 'string') next.color = patch.color;
  if (typeof patch.text === 'string') next.text = patch.text;
  if (isFiniteNumber(patch.fontSize) && patch.fontSize > 0) next.fontSize = patch.fontSize;

  if (typeof patch.mediaUrl === 'string') next.mediaUrl = patch.mediaUrl;
  if (typeof patch.mediaPublicId === 'string') next.mediaPublicId = patch.mediaPublicId;
  if (
    patch.mediaResourceType === 'image' ||
    patch.mediaResourceType === 'audio' ||
    patch.mediaResourceType === 'video'
  ) {
    next.mediaResourceType = patch.mediaResourceType;
  }
  if (typeof patch.mediaFormat === 'string') next.mediaFormat = patch.mediaFormat;
  if (isFiniteNumber(patch.mediaWidth) && patch.mediaWidth > 0) next.mediaWidth = patch.mediaWidth;
  if (isFiniteNumber(patch.mediaHeight) && patch.mediaHeight > 0) next.mediaHeight = patch.mediaHeight;
  if (typeof patch.mimeType === 'string') next.mimeType = patch.mimeType;
  if (isFiniteNumber(patch.sizeBytes) && patch.sizeBytes >= 0) next.sizeBytes = patch.sizeBytes;
  if (isFiniteNumber(patch.durationMs) && patch.durationMs >= 0) next.durationMs = patch.durationMs;
  if (typeof patch.mediaCreatedAt === 'string') next.mediaCreatedAt = patch.mediaCreatedAt;

  if (typeof patch.createdBySessionId === 'string') next.createdBySessionId = patch.createdBySessionId;
  if (typeof patch.createdAt === 'string') next.createdAt = patch.createdAt;
  if (typeof patch.updatedAt === 'string') next.updatedAt = patch.updatedAt;

  return next;
}

function applyReplayEvent(state: ReplayState, event: RoomEvent): ReplayState {
  const objectsById = new Map(state.objects.map((object) => [object.id, cloneObject(object)]));
  let physics: ReplayPhysicsState = {
    ...state.physics,
    staticObjectIds: [...state.physics.staticObjectIds],
  };

  if (event.eventType === 'object:create') {
    const candidate = (event.payload as { object?: unknown })?.object;
    if (isReplayObjectCandidate(candidate)) {
      objectsById.set(candidate.id, cloneObject(candidate));
    }
  }

  if (event.eventType === 'object:update') {
    const objectId = (event.payload as { objectId?: unknown })?.objectId;
    const updates = (event.payload as { updates?: unknown })?.updates;

    if (typeof objectId === 'string' && typeof updates === 'object' && updates !== null) {
      const existing = objectsById.get(objectId);
      if (existing) {
        const updated = applyObjectUpdatePatch(existing, updates as CanvasObjectPatch);
        objectsById.set(objectId, updated);
      }
    }
  }

  if (event.eventType === 'object:delete') {
    const objectId = (event.payload as { objectId?: unknown })?.objectId;
    if (typeof objectId === 'string') {
      objectsById.delete(objectId);
    }
  }

  if (event.eventType === 'physics:update-state') {
    const patch = (event.payload as { patch?: unknown })?.patch;

    if (typeof patch === 'object' && patch !== null) {
      const value = patch as Partial<ReplayPhysicsState>;
      const next: ReplayPhysicsState = {
        ...physics,
        enabled: typeof value.enabled === 'boolean' ? value.enabled : physics.enabled,
        simulationRunning:
          typeof value.simulationRunning === 'boolean' ? value.simulationRunning : physics.simulationRunning,
        gravityY: isFiniteNumber(value.gravityY)
          ? clamp(value.gravityY, CLAMP_BOUNDS.gravityY.min, CLAMP_BOUNDS.gravityY.max)
          : physics.gravityY,
        restitution: isFiniteNumber(value.restitution)
          ? clamp(value.restitution, CLAMP_BOUNDS.restitution.min, CLAMP_BOUNDS.restitution.max)
          : physics.restitution,
        frictionAir: isFiniteNumber(value.frictionAir)
          ? clamp(value.frictionAir, CLAMP_BOUNDS.frictionAir.min, CLAMP_BOUNDS.frictionAir.max)
          : physics.frictionAir,
        staticObjectIds: [...physics.staticObjectIds],
        resetNonce: physics.resetNonce,
        revision: physics.revision + 1,
      };

      if (!next.enabled) {
        next.simulationRunning = false;
      }

      physics = next;
    }
  }

  if (event.eventType === 'physics:set-static') {
    const objectId = (event.payload as { objectId?: unknown })?.objectId;
    const isStatic = (event.payload as { isStatic?: unknown })?.isStatic;

    if (typeof objectId === 'string' && typeof isStatic === 'boolean') {
      const nextSet = new Set(physics.staticObjectIds);
      if (isStatic) {
        nextSet.add(objectId);
      } else {
        nextSet.delete(objectId);
      }

      physics = {
        ...physics,
        staticObjectIds: [...nextSet],
        revision: physics.revision + 1,
      };
    }
  }

  if (event.eventType === 'physics:reset') {
    physics = {
      ...physics,
      resetNonce: physics.resetNonce + 1,
      revision: physics.revision + 1,
    };
  }

  return {
    roomId: state.roomId || event.roomId,
    objects: sortObjects(Array.from(objectsById.values())),
    physics,
    appliedEventCount: state.appliedEventCount + 1,
    lastSequenceNumber: event.sequenceNumber,
  };
}

function createInitialReplayState(roomId = ''): ReplayState {
  return {
    roomId,
    objects: [],
    physics: {
      ...DEFAULT_REPLAY_PHYSICS_STATE,
      staticObjectIds: [],
    },
    appliedEventCount: 0,
    lastSequenceNumber: null,
  };
}

class InMemoryReplayStore implements ReplayStore {
  private orderedEvents: RoomEvent[] = [];
  private checkpoints: ReplayState[] = [createInitialReplayState('')];
  private cursor = 0;

  initialize(events: RoomEvent[]): void {
    this.orderedEvents = normalizeEvents(events);
    const roomId = this.orderedEvents[0]?.roomId ?? '';
    this.checkpoints = [createInitialReplayState(roomId)];

    for (const event of this.orderedEvents) {
      const previous = this.checkpoints[this.checkpoints.length - 1] ?? createInitialReplayState(roomId);
      this.checkpoints.push(applyReplayEvent(previous, event));
    }

    this.cursor = 0;
  }

  stepForward(): ReplayState {
    if (this.cursor < this.orderedEvents.length) {
      this.cursor += 1;
    }

    return this.getCurrentState();
  }

  stepBackward(): ReplayState {
    if (this.cursor > 0) {
      this.cursor -= 1;
    }

    return this.getCurrentState();
  }

  reset(): ReplayState {
    this.cursor = 0;
    return this.getCurrentState();
  }

  getCurrentState(): ReplayState {
    const state = this.checkpoints[this.cursor] ?? this.checkpoints[this.checkpoints.length - 1] ?? createInitialReplayState('');
    return cloneState(state);
  }
}

export function createReplayStore(): ReplayStore {
  return new InMemoryReplayStore();
}

export function reconstructReplayState(events: RoomEvent[]): ReplayState {
  const store = createReplayStore();
  store.initialize(events);

  for (let index = 0; index < events.length; index += 1) {
    store.stepForward();
  }

  return store.getCurrentState();
}
