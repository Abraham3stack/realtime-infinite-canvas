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

const SESSION_STORAGE_KEY = 'ric:guest-session:v1';
const ROOM_STORAGE_KEY = 'ric:active-room:v1';

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

export function clearPersistedCollaborationState(): void {
  clearPersistedGuestSession();
  clearPersistedRoom();
}
