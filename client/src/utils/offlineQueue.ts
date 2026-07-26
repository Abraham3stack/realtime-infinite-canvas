import type { CanvasObject } from '../store/objects.js';
import {
  readPersistedOfflineQueue,
  writePersistedOfflineQueue,
  type PersistedOfflineOperation,
} from './persistence.js';

export type OfflineOperation = PersistedOfflineOperation;

type ObjectUpdatePatch = Partial<Pick<CanvasObject, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'zIndex' | 'color' | 'text' | 'fontSize'>>;

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(): string {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function isTransformOnlyPatch(updates: Record<string, unknown>): updates is ObjectUpdatePatch {
  const keys = Object.keys(updates);
  if (keys.length === 0) return false;

  const allowed = new Set(['x', 'y', 'width', 'height', 'rotation', 'zIndex', 'color', 'text', 'fontSize']);
  return keys.every((key) => allowed.has(key));
}

function mergeUpdatePatch(
  previous: Record<string, unknown>,
  next: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...previous,
    ...next,
  };
}

export class OfflineOperationsQueue {
  private queue: OfflineOperation[];

  constructor(initialQueue?: OfflineOperation[]) {
    this.queue = initialQueue ?? readPersistedOfflineQueue();
  }

  list(roomId?: string, sessionId?: string): OfflineOperation[] {
    return this.queue.filter((entry) => {
      if (roomId && entry.roomId !== roomId) return false;
      if (sessionId && entry.sessionId && entry.sessionId !== sessionId) return false;
      return true;
    });
  }

  size(roomId?: string, sessionId?: string): number {
    return this.list(roomId, sessionId).length;
  }

  enqueueCreate(input: {
    operationId: string;
    roomId: string;
    sessionId?: string;
    object: Record<string, unknown>;
  }): OfflineOperation {
    const entry: OfflineOperation = {
      id: makeId(),
      operationId: input.operationId,
      roomId: input.roomId,
      sessionId: input.sessionId,
      type: 'create',
      createdAt: nowIso(),
      attempts: 0,
      object: input.object,
    };

    this.queue.push(entry);
    this.persist();
    return entry;
  }

  enqueueUpdate(input: {
    operationId: string;
    roomId: string;
    sessionId?: string;
    objectId: string;
    updates: Record<string, unknown>;
  }): OfflineOperation {
    // Coalesce repeated updates for the same object while offline to limit replay noise.
    const latestMatchingUpdateIndex = [...this.queue]
      .reverse()
      .findIndex((entry) => entry.type === 'update' && entry.roomId === input.roomId && entry.objectId === input.objectId);

    if (latestMatchingUpdateIndex !== -1 && isTransformOnlyPatch(input.updates)) {
      const indexFromStart = this.queue.length - 1 - latestMatchingUpdateIndex;
      const existing = this.queue[indexFromStart];
      if (existing.type === 'update' && isTransformOnlyPatch(existing.updates)) {
        existing.updates = mergeUpdatePatch(existing.updates, input.updates);
        existing.operationId = input.operationId;
        existing.lastError = undefined;
        this.persist();
        return existing;
      }
    }

    const entry: OfflineOperation = {
      id: makeId(),
      operationId: input.operationId,
      roomId: input.roomId,
      sessionId: input.sessionId,
      type: 'update',
      createdAt: nowIso(),
      attempts: 0,
      objectId: input.objectId,
      updates: input.updates,
    };

    this.queue.push(entry);
    this.persist();
    return entry;
  }

  enqueueDelete(input: {
    operationId: string;
    roomId: string;
    sessionId?: string;
    objectId: string;
  }): OfflineOperation {
    // Deleting an object makes pending updates for it irrelevant.
    this.queue = this.queue.filter(
      (entry) => !(entry.roomId === input.roomId && entry.type === 'update' && entry.objectId === input.objectId)
    );

    const entry: OfflineOperation = {
      id: makeId(),
      operationId: input.operationId,
      roomId: input.roomId,
      sessionId: input.sessionId,
      type: 'delete',
      createdAt: nowIso(),
      attempts: 0,
      objectId: input.objectId,
    };

    this.queue.push(entry);
    this.persist();
    return entry;
  }

  markAttempt(entryId: string, error?: string): void {
    const entry = this.queue.find((item) => item.id === entryId);
    if (!entry) return;
    entry.attempts += 1;
    entry.lastError = error;
    this.persist();
  }

  remove(entryId: string): void {
    this.queue = this.queue.filter((item) => item.id !== entryId);
    this.persist();
  }

  clearForRoom(roomId: string): void {
    this.queue = this.queue.filter((entry) => entry.roomId !== roomId);
    this.persist();
  }

  private persist(): void {
    writePersistedOfflineQueue(this.queue);
  }
}

let singletonQueue: OfflineOperationsQueue | null = null;

export function getOfflineOperationsQueue(): OfflineOperationsQueue {
  if (!singletonQueue) {
    singletonQueue = new OfflineOperationsQueue();
  }

  return singletonQueue;
}
