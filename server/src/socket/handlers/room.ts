import type { Server, Socket } from 'socket.io';
import { customAlphabet } from 'nanoid';
import { prisma } from '../../db/prisma.js';
import { withNeonColdStartRetry } from '../../db/neonRetry.js';
import { ErrorCodes } from '@realtime-canvas/shared';
import type { AuthenticatedSocket } from '../types.js';
import { initializeRoomObjects, getRoomObjects } from './objects.js';

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
}

interface RoomJoinPayload {
  roomId?: string;
  shareCode?: string;
}

export function registerRoomHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    console.log(`[socket] connected  id=${socket.id}`);

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
        const { room, participant } = await withNeonColdStartRetry(async () => {
          return prisma.$transaction(async (tx) => {
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
        });

        // Socket joins the Socket.IO room — broadcasts to this room will reach only
        // connected sockets in this room key.
        socket.join(room.id);
        authSocket.roomId = room.id;

        // Initialize object storage for this room
        initializeRoomObjects(room.id);

        callback({
          roomId: room.id,
          shareCode: room.shareCode,
          session: { id: sessionId, token: 'N/A' },
          participant: {
            id: participant.id,
            roomId: room.id,
            displayName: participant.session.user.displayName,
            joinedAt: participant.joinedAt.toISOString(),
            lastSeenAt: participant.lastSeenAt.toISOString(),
            isActive: true,
          },
          initialState: {
            roomId: room.id,
            title: room.title ?? `Room ${room.shareCode}`,
            participants: [
              {
                id: participant.id,
                roomId: room.id,
                displayName: participant.session.user.displayName,
                joinedAt: participant.joinedAt.toISOString(),
                lastSeenAt: participant.lastSeenAt.toISOString(),
                isActive: true,
              },
            ],
          },
        });

        console.log(`[room] created  id=${room.id} code=${room.shareCode} by=${sessionId}`);
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
        const room = await withNeonColdStartRetry(async () => {
          if (roomId) {
            return prisma.room.findUnique({ where: { id: roomId } });
          }
          if (shareCode) {
            return prisma.room.findUnique({ where: { shareCode } });
          }
          return null;
        });

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
        const participant = await withNeonColdStartRetry(async () => {
          return prisma.roomParticipant.upsert({
            where: { roomId_sessionId: { roomId: room.id, sessionId } },
            create: { roomId: room.id, sessionId },
            update: { isActive: true, lastSeenAt: new Date() },
            include: { session: { include: { user: true } } },
          });
        });

        // Fetch all current participants in the room for the state snapshot.
        const participants = await withNeonColdStartRetry(async () => {
          return prisma.roomParticipant.findMany({
            where: { roomId: room.id, isActive: true },
            include: { session: { include: { user: true } } },
          });
        });

        // Socket joins the Socket.IO room.
        socket.join(room.id);
        authSocket.roomId = room.id;

        const snapshotParticipants = participants.map((p) => ({
          id: p.id,
          roomId: p.roomId,
          displayName: p.session.user.displayName,
          joinedAt: p.joinedAt.toISOString(),
          lastSeenAt: p.lastSeenAt.toISOString(),
          isActive: p.isActive,
        }));

        // Send the state snapshot directly to the joining socket.
        callback({
          roomId: room.id,
          title: room.title ?? `Room ${room.shareCode}`,
          participants: snapshotParticipants,
          canvasObjects: getRoomObjects(room.id),
        });

        // Broadcast the new participant to all other sockets in the room.
        socket.to(room.id).emit('room:userJoined', {
          participant: {
            id: participant.id,
            roomId: room.id,
            displayName: participant.session.user.displayName,
            joinedAt: participant.joinedAt.toISOString(),
            lastSeenAt: participant.lastSeenAt.toISOString(),
            isActive: true,
          },
          serverTs: new Date().toISOString(),
        });

        console.log(`[room] joined  id=${room.id} participant=${sessionId}`);
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

          // Broadcast departure to remaining participants.
          socket.to(roomId).emit('room:userLeft', {
            participantId: participant.id,
            roomId,
            serverTs: new Date().toISOString(),
          });
        }

        socket.leave(roomId);
        authSocket.roomId = undefined;

        callback({ success: true });
        console.log(`[room] left  id=${roomId} participant=${sessionId}`);
      } catch (err) {
        console.error('[room:leave] error:', err);
        callback({ success: false });
      }
    });

    // Handle disconnect: clean up the participant and leave the room.
    socket.on('disconnect', async (reason: string) => {
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

      console.log(`[socket] disconnected  id=${socket.id} reason=${reason}`);
    });
  });
}
