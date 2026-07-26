import type { Server, Socket } from 'socket.io';
import type { AuthenticatedSocket } from '../types.js';
import { RoomEventsListRequestSchema, type RoomEventsListResponse } from '@realtime-canvas/shared';
import { listRoomEvents } from '../../journal/roomEvents.js';

interface RoomEventsListPayload {
  roomId?: string;
  afterSequenceNumber?: number;
}

interface RoomEventsListCallbackResponse extends RoomEventsListResponse {
  code?: string;
  message?: string;
}

export function registerRoomEventHandlers(
  io: Server,
  listEvents = listRoomEvents
): void {
  io.on('connection', (socket: Socket) => {
    const authSocket = socket as AuthenticatedSocket;

    socket.on('room:events:list', async (payload: RoomEventsListPayload, callback: (response: RoomEventsListCallbackResponse) => void) => {
      if (typeof callback !== 'function') {
        console.error('[room:events:list] callback is not a function');
        return;
      }

      if (!authSocket.roomId || !authSocket.sessionId) {
        callback({ code: 'SESSION_INVALID', message: 'Not authenticated', roomId: '', events: [] });
        return;
      }

      const normalizedPayload = RoomEventsListRequestSchema.safeParse({
        roomId: payload?.roomId ?? authSocket.roomId,
        afterSequenceNumber: payload?.afterSequenceNumber,
      });

      if (!normalizedPayload.success) {
        callback({ code: 'INVALID_PAYLOAD', message: 'Invalid room events request', roomId: authSocket.roomId, events: [] });
        return;
      }

      const { roomId, afterSequenceNumber } = normalizedPayload.data;
      if (authSocket.roomId !== roomId) {
        callback({ code: 'UNAUTHORIZED', message: 'Not a member of this room', roomId, events: [] });
        return;
      }

      try {
        const response = await listEvents(roomId, { roomId, afterSequenceNumber });
        callback(response);
      } catch (err) {
        console.error('[room:events:list] error:', err);
        callback({ code: 'ROOM_EVENTS_FAILED', message: 'Failed to load room events', roomId, events: [] });
      }
    });
  });
}
