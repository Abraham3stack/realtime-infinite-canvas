import type { Server, Socket } from 'socket.io';
import { customAlphabet } from 'nanoid';
import { prisma } from '../../db/prisma.js';
import { ErrorCodes } from '@realtime-canvas/shared';
import type { AuthenticatedSocket } from '../types.js';
import { getRoomObjects } from './objects.js';
import { getRoomPhysicsState, type RoomPhysicsState } from './physics.js';
import { getRoomPresenceSnapshot, removeParticipantPresence } from './presence.js';

const generateShareCode = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz', 6);

interface RoomResponse {
  code?: string;
  message?: string;
  roomId?: string;
  shareCode?: string;
  session?: { id: string; token: string };
  participant?: Record<string, unknown>;
  initialState?: Record<string, unknown>;
  success?: boolean;
  title?: string;
  participants?: Array<Record<string, unknown>>;
  canvasObjects?: Array<Record<string, unknown>>;
  physicsState?: RoomPhysicsState;
  createdBySessionId?: string;
}

interface RoomJoinPayload {
  roomId?: string;
  shareCode?: string;
}

/**
 * Registers room lifecycle handlers (create/join/leave/disconnect cleanup).
 *
 * Architectural assumptions:
 * - Room membership is application state layered on top of socket connectivity.
 * - Join responses provide full participant/object snapshots so clients can
 *   converge even after reconnects or missed transient events.
 * - Participant writes are idempotent where possible to tolerate client retries.
 */
export function registerRoomHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    socket.emit('server:hello', {
      socketId: socket.id,
      serverTs: new Date().toISOString(),
      message: 'Socket connected. Room lifecycle available.',
    });

    socket.on('ping', () => {
      socket.emit('pong', { serverTs: new Date().toISOString() });
    });

    // room:create — creates a new room and returns roomId, shareCode, and initial participant/state.
    socket.on('room:create', async (payload: unknown, callback: (response: RoomResponse) => void) => {
      if (typeof callback !== 'function') {
        console.error('[room:create] callback is not a function');
        return;
      }

      const authSocket = socket as AuthenticatedSocket;
      const { sessionId, userId, displayName } = authSocket;

      if (!sessionId || !userId || !displayName) {
        callback({ code: ErrorCodes.SESSION_INVALID, message: 'Not authenticated' });
        return;
      }

      // Validate payload shape — displayName is optional; if omitted, use the session's displayName.
      let roomTitle: string | undefined;
      if (typeof payload === 'object' && payload !== null && 'displayName' in payload) {
        roomTitle = (payload as Record<string, unknown>).displayName as string;
      }

      try {
        // Create room and participant in a single transaction. Ensures atomicity if
        // either operation fails (e.g., DB constraint violation).
        const { room, participant } = await prisma.$transaction(async (tx) => {
          const r = await tx.room.create({
            data: {
              createdBySessionId: sessionId,
              shareCode: generateShareCode(),
              title: roomTitle,
            },
          });

          const p = await tx.roomParticipant.create({
            data: {
              roomId: r.id,
              sessionId,
            },
            include: { session: { include: { user: true } } },
          });

          return { room: r, participant: p };
        });

        // Socket joins the Socket.IO room — broadcasts to this room will reach only
        // connected sockets in this room key.
        socket.join(room.id);
        authSocket.roomId = room.id;
        authSocket.participantId = participant.id;

        callback({
          roomId: room.id,
          shareCode: room.shareCode,
          createdBySessionId: room.createdBySessionId,
          physicsState: getRoomPhysicsState(room.id),
          session: { id: sessionId, token: 'N/A' },
          participant: {
            id: participant.id,
            roomId: room.id,
            sessionId,
            displayName: participant.session.user.displayName,
            joinedAt: participant.joinedAt.toISOString(),
            lastSeenAt: participant.lastSeenAt.toISOString(),
            isActive: true,
            lastViewportX: participant.lastViewportX,
            lastViewportY: participant.lastViewportY,
            lastViewportZoom: participant.lastViewportZoom,
          },
          initialState: {
            roomId: room.id,
            title: room.title ?? `Room ${room.shareCode}`,
            participants: [
              {
                id: participant.id,
                roomId: room.id,
                sessionId,
                displayName: participant.session.user.displayName,
                joinedAt: participant.joinedAt.toISOString(),
                lastSeenAt: participant.lastSeenAt.toISOString(),
                isActive: true,
                lastViewportX: participant.lastViewportX,
                lastViewportY: participant.lastViewportY,
                lastViewportZoom: participant.lastViewportZoom,
              },
            ],
          },
        });
      } catch (err) {
        console.error('[room:create] error:', err);
        callback({ code: ErrorCodes.ROOM_CREATE_FAILED, message: 'Failed to create room' });
      }
    });

    // room:join — joins an existing room and returns the full room state.
    socket.on('room:join', async (payload: unknown, callback: (response: RoomResponse) => void) => {
      if (typeof callback !== 'function') {
        console.error('[room:join] callback is not a function');
        return;
      }

      const authSocket = socket as AuthenticatedSocket;
      const { sessionId, userId, displayName } = authSocket;

      if (!sessionId || !userId || !displayName) {
        callback({ code: ErrorCodes.SESSION_INVALID, message: 'Not authenticated' });
        return;
      }

      if (typeof payload !== 'object' || payload === null) {
        callback({ code: ErrorCodes.INVALID_PAYLOAD, message: 'Payload required' });
        return;
      }

      const { roomId, shareCode } = payload as RoomJoinPayload;

      try {
        // Resolve room by ID or shareCode
        const room = await (async () => {
          if (roomId) {
            return prisma.room.findUnique({ where: { id: roomId } });
          }
          if (shareCode) {
            return prisma.room.findUnique({ where: { shareCode } });
          }
          return null;
        })();

        if (!roomId && !shareCode) {
          callback({ code: ErrorCodes.INVALID_PAYLOAD, message: 'roomId or shareCode required' });
          return;
        }

        if (!room) {
          callback({ code: ErrorCodes.ROOM_NOT_FOUND, message: 'Room not found' });
          return;
        }

        // Check if participant already exists; if not, create one.
        // Using upsert to be idempotent: if join is retried, the second call
        // succeeds without creating a duplicate row.
        const participant = await prisma.roomParticipant.upsert({
          where: { roomId_sessionId: { roomId: room.id, sessionId } },
          create: { roomId: room.id, sessionId },
          update: { isActive: true, lastSeenAt: new Date() },
          include: { session: { include: { user: true } } },
        });

        // Fetch all current participants in the room for the state snapshot.
        // Snapshot-first join avoids clients rendering partial room state based
        // only on incremental userJoined events.
        const participants = await prisma.roomParticipant.findMany({
          where: { roomId: room.id, isActive: true },
          include: { session: { include: { user: true } } },
        });

        // Socket joins the Socket.IO room.
        socket.join(room.id);
        authSocket.roomId = room.id;
        authSocket.participantId = participant.id;

        const presenceByParticipantId = new Map(
          getRoomPresenceSnapshot(room.id).map((presence) => [presence.participantId, presence])
        );

        const snapshotParticipants = participants.map((p) => ({
          id: p.id,
          roomId: p.roomId,
          sessionId: p.sessionId,
          displayName: p.session.user.displayName,
          joinedAt: p.joinedAt.toISOString(),
          lastSeenAt: p.lastSeenAt.toISOString(),
          isActive: p.isActive,
          lastViewportX: presenceByParticipantId.get(p.id)?.viewport.x ?? p.lastViewportX,
          lastViewportY: presenceByParticipantId.get(p.id)?.viewport.y ?? p.lastViewportY,
          lastViewportZoom: presenceByParticipantId.get(p.id)?.viewport.zoom ?? p.lastViewportZoom,
          lastViewportWidth: presenceByParticipantId.get(p.id)?.viewport.width,
          lastViewportHeight: presenceByParticipantId.get(p.id)?.viewport.height,
        }));

        // Send the state snapshot directly to the joining socket. This is the
        // source of truth used to repair divergence after reconnect/offline gaps.
        const canvasObjects = await getRoomObjects(room.id);

        callback({
          roomId: room.id,
          title: room.title ?? `Room ${room.shareCode}`,
          createdBySessionId: room.createdBySessionId,
          participants: snapshotParticipants,
          canvasObjects,
          physicsState: getRoomPhysicsState(room.id),
        });

        // Broadcast the new participant to all other sockets in the room.
        socket.to(room.id).emit('room:userJoined', {
          participant: {
            id: participant.id,
            roomId: room.id,
            sessionId,
            displayName: participant.session.user.displayName,
            joinedAt: participant.joinedAt.toISOString(),
            lastSeenAt: participant.lastSeenAt.toISOString(),
            isActive: true,
            lastViewportX: participant.lastViewportX,
            lastViewportY: participant.lastViewportY,
            lastViewportZoom: participant.lastViewportZoom,
          },
          serverTs: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[room:join] error:', err);
        callback({ code: ErrorCodes.ROOM_JOIN_DENIED, message: 'Failed to join room' });
      }
    });

    // room:leave — leaves the current room.
    socket.on('room:leave', async (_payload: unknown, callback: (response: RoomResponse) => void) => {
      if (typeof callback !== 'function') {
        console.error('[room:leave] callback is not a function');
        return;
      }

      const authSocket = socket as AuthenticatedSocket;
      const { roomId, sessionId } = authSocket;

      if (!roomId) {
        callback({ success: false });
        return;
      }

      try {
        const participant = await prisma.roomParticipant.findFirst({
          where: { roomId, sessionId },
        });

        if (participant) {
          await prisma.roomParticipant.update({
            where: { id: participant.id },
            data: { isActive: false },
          });
          removeParticipantPresence(roomId, participant.id);

          // Broadcast departure to remaining participants.
          socket.to(roomId).emit('room:userLeft', {
            participantId: participant.id,
            roomId,
            serverTs: new Date().toISOString(),
          });
        }

        socket.leave(roomId);
        authSocket.roomId = undefined;
        authSocket.participantId = undefined;

        callback({ success: true });
      } catch (err) {
        console.error('[room:leave] error:', err);
        callback({ success: false });
      }
    });

    // Handle disconnect: clean up the participant and leave the room.
    socket.on('disconnect', async (_reason: string) => {
      const authSocket = socket as AuthenticatedSocket;
      const { roomId, sessionId } = authSocket;

      if (roomId && sessionId) {
        try {
          const participant = await prisma.roomParticipant.findFirst({
            where: { roomId, sessionId },
          });

          if (participant) {
            await prisma.roomParticipant.update({
              where: { id: participant.id },
              data: { isActive: false },
            });
            removeParticipantPresence(roomId, participant.id);

            // Broadcast departure.
            io.to(roomId).emit('room:userLeft', {
              participantId: participant.id,
              roomId,
              serverTs: new Date().toISOString(),
            });
          }
        } catch (err) {
          console.error('[disconnect] cleanup error:', err);
        }
      }

      authSocket.participantId = undefined;
    });
  });
}
