import type { Server, Socket } from 'socket.io';
import type { AuthenticatedSocket } from '../types.js';

// Type definitions for object event payloads
interface ObjectCreatePayload {
  operationId: string;
  roomId: string;
  object: Record<string, unknown>;
}

interface ObjectUpdatePayload {
  operationId: string;
  roomId: string;
  objectId: string;
  updates: Record<string, unknown>;
}

interface ObjectDeletePayload {
  operationId: string;
  roomId: string;
  objectId: string;
}

/**
 * Object Synchronization Handlers
 *
 * Manages realtime synchronization of canvas object operations (create, update, delete)
 * across all participants in a room. Uses simple last-write-wins semantics for now.
 *
 * Architecture:
 * - Client sends object operations with operationId for deduplication
 * - Server broadcasts to room (excluding sender to avoid duplicate handling)
 * - New joiners receive full object snapshot in room:stateSnapshot
 * - Each operation includes serverTs for ordering
 */

// In-memory object storage per room (in production, this would be database)
// Structure: roomId -> objectId -> objectData
const roomObjects = new Map<string, Map<string, Record<string, unknown>>>();

/**
 * Initialize objects for a room when it's created
 */
export function initializeRoomObjects(roomId: string): void {
  if (!roomObjects.has(roomId)) {
    roomObjects.set(roomId, new Map());
  }
}

/**
 * Get all objects for a room (for state snapshot on join)
 */
export function getRoomObjects(roomId: string): Record<string, unknown>[] {
  const objects = roomObjects.get(roomId);
  return objects ? Array.from(objects.values()) : [];
}

/**
 * Clear objects when room is deleted
 */
export function clearRoomObjects(roomId: string): void {
  roomObjects.delete(roomId);
}

export function registerObjectHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    const authSocket = socket as AuthenticatedSocket;

    // object:create — Client creates a new object
    socket.on('object:create', (payload: ObjectCreatePayload) => {
      const { operationId, roomId, object } = payload;

      console.log(`[object:create] operationId=${operationId}, roomId=${roomId}, objectId=${object.id}`);

      // Validate that the socket is in this room
      if (!authSocket.roomId || authSocket.roomId !== roomId) {
        console.log(`[object:create] AUTH FAILED: socket.roomId=${authSocket.roomId}, requested=${roomId}`);
        socket.emit('error', {
          code: 'UNAUTHORIZED',
          message: 'Not a member of this room',
        });
        return;
      }

      // Store object in room
      const objects = roomObjects.get(roomId) || new Map();
      objects.set(object.id as string, object);
      roomObjects.set(roomId, objects);

      console.log(`[object:create] stored, broadcasting to room ${roomId}`);

      // Broadcast creation to all participants in room (including sender).
      // Sender uses operationId to match the echo and skip re-applying.
      io.to(roomId).emit('object:created', {
        operationId,
        object,
        serverTs: new Date(),
      });
    });

    // object:update — Client moves or modifies an object
    socket.on('object:update', (payload: ObjectUpdatePayload) => {
      const { operationId, roomId, objectId, updates } = payload;

      console.log(`[object:update] operationId=${operationId}, roomId=${roomId}, objectId=${objectId}`);

      // Validate room membership
      if (!authSocket.roomId || authSocket.roomId !== roomId) {
        console.log(`[object:update] AUTH FAILED: socket.roomId=${authSocket.roomId}, requested=${roomId}`);
        socket.emit('error', {
          code: 'UNAUTHORIZED',
          message: 'Not a member of this room',
        });
        return;
      }

      // Update object in room storage
      const objects = roomObjects.get(roomId);
      if (!objects || !objects.has(objectId)) {
        console.log(`[object:update] NOT_FOUND: objectId=${objectId}`);
        socket.emit('error', {
          code: 'NOT_FOUND',
          message: 'Object not found',
        });
        return;
      }

      const object = objects.get(objectId);
      const updatedObject = { ...object, ...updates };
      objects.set(objectId, updatedObject);

      console.log(`[object:update] stored, broadcasting to room ${roomId}`);

      // Broadcast update to all participants in room
      io.to(roomId).emit('object:updated', {
        operationId,
        objectId,
        updates,
        serverTs: new Date(),
      });
    });

    // object:delete — Client deletes an object
    socket.on('object:delete', (payload: ObjectDeletePayload) => {
      const { operationId, roomId, objectId } = payload;

      // Validate room membership
      if (!authSocket.roomId || authSocket.roomId !== roomId) {
        socket.emit('error', {
          code: 'UNAUTHORIZED',
          message: 'Not a member of this room',
        });
        return;
      }

      // Delete object from room storage
      const objects = roomObjects.get(roomId);
      if (!objects || !objects.has(objectId)) {
        socket.emit('error', {
          code: 'NOT_FOUND',
          message: 'Object not found',
        });
        return;
      }

      objects.delete(objectId);

      // Broadcast deletion to all participants in room
      io.to(roomId).emit('object:deleted', {
        operationId,
        objectId,
        serverTs: new Date(),
      });
    });
  });
}
