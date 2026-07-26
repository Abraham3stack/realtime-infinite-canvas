import type { Server, Socket } from 'socket.io';
import { prisma } from '../../db/prisma.js';
import type { AuthenticatedSocket } from '../types.js';

interface PresenceViewport {
  x: number;
  y: number;
  zoom: number;
  width?: number;
  height?: number;
}

interface PresenceUpdatePayload {
  roomId: string;
  viewport: PresenceViewport;
  status: 'active' | 'idle';
}

interface PresenceSnapshot {
  participantId: string;
  sessionId: string;
  displayName: string;
  roomId: string;
  viewport: PresenceViewport;
  status: 'active' | 'idle' | 'disconnected';
  serverTs: string;
}

const roomPresenceState = new Map<string, Map<string, PresenceSnapshot>>();
const participantWriteThrottleMs = 1200;
const participantLastPersistTs = new Map<string, number>();

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function ensurePresenceMap(roomId: string): Map<string, PresenceSnapshot> {
  const existing = roomPresenceState.get(roomId);
  if (existing) return existing;
  const created = new Map<string, PresenceSnapshot>();
  roomPresenceState.set(roomId, created);
  return created;
}

function getParticipantMap(roomId: string): Map<string, PresenceSnapshot> {
  return roomPresenceState.get(roomId) ?? new Map<string, PresenceSnapshot>();
}

function isAuthorized(socket: AuthenticatedSocket, roomId: string): boolean {
  return Boolean(socket.roomId && socket.roomId === roomId && socket.sessionId);
}

async function resolveParticipantId(socket: AuthenticatedSocket, roomId: string): Promise<string | null> {
  if (socket.participantId) return socket.participantId;
  if (!socket.sessionId) return null;

  const participant = await prisma.roomParticipant.findFirst({
    where: {
      roomId,
      sessionId: socket.sessionId,
    },
    select: { id: true },
  });

  if (!participant) return null;
  socket.participantId = participant.id;
  return participant.id;
}

async function persistViewport(participantId: string, viewport: PresenceViewport): Promise<void> {
  const now = Date.now();
  const lastPersist = participantLastPersistTs.get(participantId) ?? 0;
  if (now - lastPersist < participantWriteThrottleMs) {
    return;
  }

  participantLastPersistTs.set(participantId, now);
  await prisma.roomParticipant.update({
    where: { id: participantId },
    data: {
      lastSeenAt: new Date(),
      lastViewportX: viewport.x,
      lastViewportY: viewport.y,
      lastViewportZoom: viewport.zoom,
    },
  });
}

export function getRoomPresenceSnapshot(roomId: string): PresenceSnapshot[] {
  return Array.from(getParticipantMap(roomId).values());
}

export function clearRoomPresenceState(roomId: string): void {
  roomPresenceState.delete(roomId);
}

export function removeParticipantPresence(roomId: string, participantId?: string): void {
  if (!participantId) return;
  const roomMap = roomPresenceState.get(roomId);
  if (!roomMap) return;
  roomMap.delete(participantId);
  if (roomMap.size === 0) {
    roomPresenceState.delete(roomId);
  }
}

export function registerPresenceHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    const authSocket = socket as AuthenticatedSocket;

    socket.on('presence:update', async (payload: PresenceUpdatePayload) => {
      if (!payload || typeof payload.roomId !== 'string' || typeof payload.viewport !== 'object' || payload.viewport === null) {
        return;
      }

      if (!isAuthorized(authSocket, payload.roomId)) {
        return;
      }

      const viewport = payload.viewport;
      if (!isFiniteNumber(viewport.x) || !isFiniteNumber(viewport.y) || !isFiniteNumber(viewport.zoom) || viewport.zoom <= 0) {
        return;
      }

      if (viewport.width !== undefined && (!isFiniteNumber(viewport.width) || viewport.width <= 0)) {
        return;
      }

      if (viewport.height !== undefined && (!isFiniteNumber(viewport.height) || viewport.height <= 0)) {
        return;
      }

      const status = payload.status === 'idle' ? 'idle' : 'active';
      const participantId = await resolveParticipantId(authSocket, payload.roomId);
      if (!participantId || !authSocket.sessionId || !authSocket.displayName) {
        return;
      }

      const snapshot: PresenceSnapshot = {
        participantId,
        sessionId: authSocket.sessionId,
        displayName: authSocket.displayName,
        roomId: payload.roomId,
        viewport: {
          x: viewport.x,
          y: viewport.y,
          zoom: viewport.zoom,
          width: viewport.width,
          height: viewport.height,
        },
        status,
        serverTs: new Date().toISOString(),
      };

      ensurePresenceMap(payload.roomId).set(participantId, snapshot);
      io.to(payload.roomId).emit('presence:updated', snapshot);

      try {
        await persistViewport(participantId, snapshot.viewport);
      } catch {
        // Persistence is best-effort for radar continuity and should not block live updates.
      }
    });
  });
}
