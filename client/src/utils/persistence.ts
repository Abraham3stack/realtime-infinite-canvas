export interface PersistedGuestSession {
  sessionToken: string;
  sessionId: string;
  userId: string;
  displayName: string;
  expiresAt: string;
}

export interface PersistedRoom {
  roomId: string;
  shareCode?: string;
}

export type PersistedOfflineOperation =
  | {
      id: string;
      operationId: string;
      roomId: string;
      sessionId?: string;
      type: 'create';
      createdAt: string;
      attempts: number;
      object: Record<string, unknown>;
      lastError?: string;
    }
  | {
      id: string;
      operationId: string;
      roomId: string;
      sessionId?: string;
      type: 'update';
      createdAt: string;
      attempts: number;
      objectId: string;
      updates: Record<string, unknown>;
      lastError?: string;
    }
  | {
      id: string;
      operationId: string;
      roomId: string;
      sessionId?: string;
      type: 'delete';
      createdAt: string;
      attempts: number;
      objectId: string;
      lastError?: string;
    };

const SESSION_STORAGE_KEY = 'ric:guest-session:v1';
const ROOM_STORAGE_KEY = 'ric:active-room:v1';
const OFFLINE_QUEUE_STORAGE_KEY = 'ric:offline-queue:v1';

function canUseBrowserStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function safeRead<T>(key: string): T | null {
  if (!canUseBrowserStorage()) return null;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function safeWrite<T>(key: string, value: T): void {
  if (!canUseBrowserStorage()) return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota and serialization failures; persistence is best-effort.
  }
}

function safeRemove(key: string): void {
  if (!canUseBrowserStorage()) return;

  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage errors.
  }
}

export function readPersistedGuestSession(): PersistedGuestSession | null {
  const data = safeRead<PersistedGuestSession>(SESSION_STORAGE_KEY);

  if (!data) return null;
  if (!data.sessionToken || !data.sessionId || !data.userId || !data.displayName || !data.expiresAt) {
    return null;
  }

  return data;
}

export function writePersistedGuestSession(session: PersistedGuestSession): void {
  safeWrite(SESSION_STORAGE_KEY, session);
}

export function clearPersistedGuestSession(): void {
  safeRemove(SESSION_STORAGE_KEY);
}

export function readPersistedRoom(): PersistedRoom | null {
  const data = safeRead<PersistedRoom>(ROOM_STORAGE_KEY);

  if (!data) return null;
  if (!data.roomId) {
    return null;
  }

  return {
    roomId: data.roomId,
    shareCode: data.shareCode ?? '',
  };
}

export function writePersistedRoom(room: PersistedRoom): void {
  safeWrite(ROOM_STORAGE_KEY, room);
}

export function clearPersistedRoom(): void {
  safeRemove(ROOM_STORAGE_KEY);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBaseOfflineOperation(value: unknown): value is {
  id: string;
  operationId: string;
  roomId: string;
  sessionId?: string;
  type: 'create' | 'update' | 'delete';
  createdAt: string;
  attempts: number;
  lastError?: string;
} {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string') return false;
  if (typeof value.operationId !== 'string') return false;
  if (typeof value.roomId !== 'string') return false;
  if (value.sessionId !== undefined && typeof value.sessionId !== 'string') return false;
  if (value.type !== 'create' && value.type !== 'update' && value.type !== 'delete') return false;
  if (typeof value.createdAt !== 'string') return false;
  if (typeof value.attempts !== 'number') return false;
  if (value.lastError !== undefined && typeof value.lastError !== 'string') return false;
  return true;
}

function isPersistedOfflineOperation(value: unknown): value is PersistedOfflineOperation {
  if (!isBaseOfflineOperation(value)) return false;

  if (value.type === 'create') {
    return isRecord((value as Record<string, unknown>).object);
  }

  if (value.type === 'update') {
    return (
      typeof (value as Record<string, unknown>).objectId === 'string' &&
      isRecord((value as Record<string, unknown>).updates)
    );
  }

  return typeof (value as Record<string, unknown>).objectId === 'string';
}

export function readPersistedOfflineQueue(): PersistedOfflineOperation[] {
  const data = safeRead<unknown>(OFFLINE_QUEUE_STORAGE_KEY);
  if (!Array.isArray(data)) return [];
  return data.filter((entry): entry is PersistedOfflineOperation => isPersistedOfflineOperation(entry));
}

export function writePersistedOfflineQueue(queue: PersistedOfflineOperation[]): void {
  safeWrite(OFFLINE_QUEUE_STORAGE_KEY, queue);
}

export function clearPersistedOfflineQueue(): void {
  safeRemove(OFFLINE_QUEUE_STORAGE_KEY);
}

export function clearPersistedCollaborationState(): void {
  clearPersistedGuestSession();
  clearPersistedRoom();
  clearPersistedOfflineQueue();
}
