import type { Server, Socket } from 'socket.io';
import type { CanvasObject as PrismaCanvasObject, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
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

type ClientCanvasObjectType = 'rectangle' | 'circle' | 'text' | 'sticky-note' | 'image' | 'audio' | 'video';

interface ClientCanvasObject {
  [key: string]: unknown;
  id: string;
  type: ClientCanvasObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  color?: string;
  text?: string;
  fontSize?: number;
  mediaUrl?: string;
  mediaPublicId?: string;
  mediaResourceType?: 'image' | 'audio' | 'video';
  mediaFormat?: string;
  mediaWidth?: number;
  mediaHeight?: number;
  mimeType?: string;
  sizeBytes?: number;
  durationMs?: number;
  mediaCreatedAt?: string;
  createdBySessionId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Lightweight runtime guard for socket payloads.
 *
 * This intentionally checks only synchronization-critical fields; deeper schema
 * validation is handled elsewhere in the stack and would add avoidable latency
 * on high-frequency realtime paths.
 */
function isClientCanvasObject(value: Record<string, unknown>): value is ClientCanvasObject {
  return (
    typeof value.id === 'string' &&
    typeof value.type === 'string' &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.width === 'number' &&
    typeof value.height === 'number' &&
    typeof value.zIndex === 'number' &&
    typeof value.rotation === 'number'
  );
}

export interface ObjectRepository {
  createObject: (data: Prisma.CanvasObjectUncheckedCreateInput) => Promise<PrismaCanvasObject>;
  findObject: (roomId: string, objectId: string) => Promise<PrismaCanvasObject | null>;
  updateObject: (objectId: string, data: Prisma.CanvasObjectUpdateInput) => Promise<PrismaCanvasObject>;
  deleteObject: (roomId: string, objectId: string) => Promise<number>;
  getRoomObjects: (roomId: string) => Promise<PrismaCanvasObject[]>;
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

function toClientObject(row: PrismaCanvasObject): ClientCanvasObject | null {
  const base = {
    id: row.id,
    x: row.x,
    y: row.y,
    width: row.width ?? 100,
    height: row.height ?? 100,
    rotation: row.rotation ?? 0,
    zIndex: row.zIndex,
    createdBySessionId: row.createdBySessionId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };

  switch (row.type) {
    case 'shape': {
      if (row.shapeType === 'circle') {
        return {
          ...base,
          type: 'circle',
          color: row.fillColor ?? '#e74c3c',
        };
      }
      return {
        ...base,
        type: 'rectangle',
        color: row.fillColor ?? '#3498db',
      };
    }
    case 'text': {
      return {
        ...base,
        type: 'text',
        color: row.color ?? '#2c3e50',
        text: row.content ?? 'Text',
        fontSize: row.fontSize ?? 14,
      };
    }
    case 'sticky': {
      return {
        ...base,
        type: 'sticky-note',
        color: row.backgroundColor ?? '#f1c40f',
        text: row.content ?? 'Note',
        fontSize: row.fontSize ?? 12,
      };
    }
    case 'image': {
      return {
        ...base,
        type: 'image',
        mediaUrl: row.mediaUrl ?? '',
        mediaPublicId: row.mediaPublicId ?? '',
        mediaResourceType: 'image',
        mediaFormat: row.mediaFormat ?? undefined,
        mediaWidth: row.mediaWidth ?? undefined,
        mediaHeight: row.mediaHeight ?? undefined,
        mediaCreatedAt: row.mediaCreatedAt?.toISOString(),
        mimeType: row.mimeType ?? 'image/png',
        sizeBytes: row.sizeBytes ?? 0,
      };
    }
    case 'audio': {
      return {
        ...base,
        type: 'audio',
        text: row.content ?? 'Audio Placeholder',
        mediaUrl: row.mediaUrl ?? '',
        mediaPublicId: row.mediaPublicId ?? '',
        mediaResourceType: 'audio',
        mediaFormat: row.mediaFormat ?? undefined,
        mediaCreatedAt: row.mediaCreatedAt?.toISOString(),
        mimeType: row.mimeType ?? 'audio/wav',
        sizeBytes: row.sizeBytes ?? 0,
        durationMs: row.durationMs ?? 0,
      };
    }
    case 'video': {
      return {
        ...base,
        type: 'video',
        text: row.content ?? 'Video',
        mediaUrl: row.mediaUrl ?? '',
        mediaPublicId: row.mediaPublicId ?? '',
        mediaResourceType: 'video',
        mediaFormat: row.mediaFormat ?? undefined,
        mediaWidth: row.mediaWidth ?? undefined,
        mediaHeight: row.mediaHeight ?? undefined,
        mediaCreatedAt: row.mediaCreatedAt?.toISOString(),
        mimeType: row.mimeType ?? 'video/mp4',
        sizeBytes: row.sizeBytes ?? 0,
        durationMs: row.durationMs ?? 0,
      };
    }
    case 'rectangle': {
      return {
        ...base,
        type: 'rectangle',
        color: row.fillColor ?? row.color ?? '#3498db',
      };
    }
    case 'circle': {
      return {
        ...base,
        type: 'circle',
        color: row.fillColor ?? row.color ?? '#e74c3c',
      };
    }
    case 'sticky-note': {
      return {
        ...base,
        type: 'sticky-note',
        color: row.backgroundColor ?? row.color ?? '#f1c40f',
        text: row.content ?? 'Note',
        fontSize: row.fontSize ?? 12,
      };
    }
    default:
      return null;
  }
}

/**
 * Maps client object representation into Prisma create input.
 *
 * The mapping keeps a compatibility bridge between UI-facing object types
 * (`rectangle`, `sticky-note`) and historical DB discriminators (`shape`, `sticky`).
 */
function toCreateData(roomId: string, sessionId: string, object: ClientCanvasObject): Prisma.CanvasObjectUncheckedCreateInput {
  const common = {
    id: object.id,
    roomId,
    x: object.x,
    y: object.y,
    zIndex: object.zIndex,
    rotation: object.rotation,
    width: object.width,
    height: object.height,
    createdBySessionId: sessionId,
  };

  switch (object.type) {
    case 'rectangle':
      return {
        ...common,
        type: 'shape',
        shapeType: 'rectangle',
        fillColor: object.color ?? '#3498db',
      };
    case 'circle':
      return {
        ...common,
        type: 'shape',
        shapeType: 'circle',
        fillColor: object.color ?? '#e74c3c',
      };
    case 'text':
      return {
        ...common,
        type: 'text',
        content: object.text ?? 'Text',
        color: object.color ?? '#2c3e50',
        fontSize: object.fontSize ?? 14,
      };
    case 'sticky-note':
      return {
        ...common,
        type: 'sticky',
        content: object.text ?? 'Note',
        backgroundColor: object.color ?? '#f1c40f',
        fontSize: object.fontSize ?? 12,
      };
    case 'image':
      return {
        ...common,
        type: 'image',
        mediaUrl: object.mediaUrl ?? '',
        mediaPublicId: object.mediaPublicId,
        mediaResourceType: object.mediaResourceType ?? 'image',
        mediaFormat: object.mediaFormat,
        mediaWidth: object.mediaWidth,
        mediaHeight: object.mediaHeight,
        mediaCreatedAt: object.mediaCreatedAt ? new Date(object.mediaCreatedAt) : undefined,
        mimeType: object.mimeType ?? 'image/png',
        sizeBytes: object.sizeBytes,
      };
    case 'audio':
      return {
        ...common,
        type: 'audio',
        content: object.text ?? 'Audio Placeholder',
        mediaUrl: object.mediaUrl ?? '',
        mediaPublicId: object.mediaPublicId,
        mediaResourceType: object.mediaResourceType ?? 'audio',
        mediaFormat: object.mediaFormat,
        mediaCreatedAt: object.mediaCreatedAt ? new Date(object.mediaCreatedAt) : undefined,
        mimeType: object.mimeType ?? 'audio/wav',
        sizeBytes: object.sizeBytes,
        durationMs: object.durationMs,
      };
    case 'video':
      return {
        ...common,
        type: 'video',
        content: object.text ?? 'Video',
        mediaUrl: object.mediaUrl ?? '',
        mediaPublicId: object.mediaPublicId,
        mediaResourceType: object.mediaResourceType ?? 'video',
        mediaFormat: object.mediaFormat,
        mediaWidth: object.mediaWidth,
        mediaHeight: object.mediaHeight,
        mediaCreatedAt: object.mediaCreatedAt ? new Date(object.mediaCreatedAt) : undefined,
        mimeType: object.mimeType ?? 'video/mp4',
        sizeBytes: object.sizeBytes,
        durationMs: object.durationMs,
      };
  }
}

function buildUpdateData(existing: PrismaCanvasObject, updates: Record<string, unknown>): Prisma.CanvasObjectUpdateInput {
  const data: Prisma.CanvasObjectUpdateInput = {};

  if (typeof updates.x === 'number') data.x = updates.x;
  if (typeof updates.y === 'number') data.y = updates.y;
  if (typeof updates.rotation === 'number') data.rotation = updates.rotation;
  if (typeof updates.zIndex === 'number') data.zIndex = Math.trunc(updates.zIndex);
  if (typeof updates.width === 'number') data.width = updates.width;
  if (typeof updates.height === 'number') data.height = updates.height;
  if (typeof updates.fontSize === 'number') data.fontSize = Math.trunc(updates.fontSize);

  if (existing.type === 'shape' || existing.type === 'rectangle' || existing.type === 'circle') {
    if (typeof updates.color === 'string') data.fillColor = updates.color;
  }

  if (existing.type === 'text') {
    if (typeof updates.text === 'string') data.content = updates.text;
    if (typeof updates.color === 'string') data.color = updates.color;
  }

  if (existing.type === 'sticky' || existing.type === 'sticky-note') {
    if (typeof updates.text === 'string') data.content = updates.text;
    if (typeof updates.color === 'string') data.backgroundColor = updates.color;
  }

  if (existing.type === 'image' || existing.type === 'audio' || existing.type === 'video') {
    if (typeof updates.mediaUrl === 'string') data.mediaUrl = updates.mediaUrl;
    if (typeof updates.mediaPublicId === 'string') data.mediaPublicId = updates.mediaPublicId;
    if (typeof updates.mediaResourceType === 'string') data.mediaResourceType = updates.mediaResourceType;
    if (typeof updates.mediaFormat === 'string') data.mediaFormat = updates.mediaFormat;
    if (typeof updates.mediaWidth === 'number') data.mediaWidth = Math.trunc(updates.mediaWidth);
    if (typeof updates.mediaHeight === 'number') data.mediaHeight = Math.trunc(updates.mediaHeight);
    if (typeof updates.mediaCreatedAt === 'string') data.mediaCreatedAt = new Date(updates.mediaCreatedAt);
    if (typeof updates.mimeType === 'string') data.mimeType = updates.mimeType;
    if (typeof updates.sizeBytes === 'number') data.sizeBytes = Math.trunc(updates.sizeBytes);
  }

  if (existing.type === 'audio' && typeof updates.text === 'string') {
    data.content = updates.text;
  }

  if ((existing.type === 'audio' || existing.type === 'video') && typeof updates.durationMs === 'number') {
    data.durationMs = Math.trunc(updates.durationMs);
  }

  if (existing.type === 'video' && typeof updates.text === 'string') {
    data.content = updates.text;
  }

  return data;
}

/**
 * Detects whether an update would materially change persisted state.
 *
 * This prevents no-op writes under noisy drag/resize streams where duplicate
 * positions are common, reducing DB contention and unnecessary room broadcasts.
 */
function hasEffectiveUpdate(
  existing: PrismaCanvasObject,
  data: Prisma.CanvasObjectUpdateInput
): boolean {
  const currentByKey: Record<string, unknown> = {
    x: existing.x,
    y: existing.y,
    rotation: existing.rotation,
    zIndex: existing.zIndex,
    width: existing.width,
    height: existing.height,
    fontSize: existing.fontSize,
    fillColor: existing.fillColor,
    color: existing.color,
    content: existing.content,
    backgroundColor: existing.backgroundColor,
    mediaUrl: existing.mediaUrl,
    mediaPublicId: existing.mediaPublicId,
    mediaResourceType: existing.mediaResourceType,
    mediaFormat: existing.mediaFormat,
    mediaWidth: existing.mediaWidth,
    mediaHeight: existing.mediaHeight,
    mediaCreatedAt: existing.mediaCreatedAt,
    mimeType: existing.mimeType,
    sizeBytes: existing.sizeBytes,
    durationMs: existing.durationMs,
  };

  for (const [key, nextValue] of Object.entries(data)) {
    const currentValue = currentByKey[key];
    if (nextValue instanceof Date && currentValue instanceof Date) {
      if (nextValue.getTime() !== currentValue.getTime()) return true;
      continue;
    }

    if (!Object.is(currentValue, nextValue)) {
      return true;
    }
  }

  return false;
}

const prismaObjectRepository: ObjectRepository = {
  async createObject(data) {
    return prisma.canvasObject.create({ data });
  },
  async findObject(roomId, objectId) {
    return prisma.canvasObject.findFirst({
      where: { id: objectId, roomId, deletedAt: null },
    });
  },
  async updateObject(objectId, data) {
    return prisma.canvasObject.update({
      where: { id: objectId },
      data,
    });
  },
  async deleteObject(roomId, objectId) {
    const deleted = await prisma.canvasObject.deleteMany({
      where: { id: objectId, roomId },
    });
    return deleted.count;
  },
  async getRoomObjects(roomId) {
    return prisma.canvasObject.findMany({
      where: { roomId, deletedAt: null },
      orderBy: [{ zIndex: 'asc' }, { createdAt: 'asc' }],
    });
  },
};

/**
 * In-memory repository used by tests and isolated harness scenarios.
 *
 * Behavior mirrors ordering and field updates from the Prisma repository so
 * synchronization semantics can be validated without a live database.
 */
export function createInMemoryObjectRepository(): ObjectRepository {
  const roomMap = new Map<string, Map<string, PrismaCanvasObject>>();

  const getRoom = (roomId: string) => {
    if (!roomMap.has(roomId)) {
      roomMap.set(roomId, new Map());
    }
    return roomMap.get(roomId) as Map<string, PrismaCanvasObject>;
  };

  return {
    async createObject(data) {
      const now = new Date();
      const id = data.id ?? `obj_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const row: PrismaCanvasObject = {
        id,
        roomId: data.roomId,
        type: data.type,
        x: data.x,
        y: data.y,
        zIndex: data.zIndex,
        rotation: data.rotation ?? null,
        createdBySessionId: data.createdBySessionId,
        version: data.version ?? 1,
        lastServerSeq: data.lastServerSeq ?? 0,
        content: data.content ?? null,
        fontSize: data.fontSize ?? null,
        fontFamily: data.fontFamily ?? null,
        color: data.color ?? null,
        shapeType: data.shapeType ?? null,
        width: data.width ?? null,
        height: data.height ?? null,
        fillColor: data.fillColor ?? null,
        strokeColor: data.strokeColor ?? null,
        backgroundColor: data.backgroundColor ?? null,
        textColor: data.textColor ?? null,
        mediaUrl: data.mediaUrl ?? null,
        mediaPublicId: data.mediaPublicId ?? null,
        mediaResourceType: data.mediaResourceType ?? null,
        mediaFormat: data.mediaFormat ?? null,
        mediaWidth: data.mediaWidth ?? null,
        mediaHeight: data.mediaHeight ?? null,
        mimeType: data.mimeType ?? null,
        sizeBytes: data.sizeBytes ?? null,
        durationMs: data.durationMs ?? null,
        mediaCreatedAt:
          data.mediaCreatedAt instanceof Date
            ? data.mediaCreatedAt
            : typeof data.mediaCreatedAt === 'string'
              ? new Date(data.mediaCreatedAt)
              : null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };

      const room = getRoom(data.roomId);
      room.set(row.id, row);
      return row;
    },
    async findObject(roomId, objectId) {
      const room = roomMap.get(roomId);
      return room?.get(objectId) ?? null;
    },
    async updateObject(objectId, data) {
      for (const room of roomMap.values()) {
        const existing = room.get(objectId);
        if (!existing) continue;

        const next: PrismaCanvasObject = {
          ...existing,
          x: typeof data.x === 'number' ? data.x : existing.x,
          y: typeof data.y === 'number' ? data.y : existing.y,
          zIndex: typeof data.zIndex === 'number' ? data.zIndex : existing.zIndex,
          rotation: typeof data.rotation === 'number' ? data.rotation : existing.rotation,
          width: typeof data.width === 'number' ? data.width : existing.width,
          height: typeof data.height === 'number' ? data.height : existing.height,
          fontSize: typeof data.fontSize === 'number' ? data.fontSize : existing.fontSize,
          content: typeof data.content === 'string' ? data.content : existing.content,
          color: typeof data.color === 'string' ? data.color : existing.color,
          fillColor: typeof data.fillColor === 'string' ? data.fillColor : existing.fillColor,
          backgroundColor:
            typeof data.backgroundColor === 'string' ? data.backgroundColor : existing.backgroundColor,
          mediaUrl: typeof data.mediaUrl === 'string' ? data.mediaUrl : existing.mediaUrl,
          mediaPublicId:
            typeof data.mediaPublicId === 'string' ? data.mediaPublicId : existing.mediaPublicId,
          mediaResourceType:
            typeof data.mediaResourceType === 'string' ? data.mediaResourceType : existing.mediaResourceType,
          mediaFormat: typeof data.mediaFormat === 'string' ? data.mediaFormat : existing.mediaFormat,
          mediaWidth: typeof data.mediaWidth === 'number' ? data.mediaWidth : existing.mediaWidth,
          mediaHeight: typeof data.mediaHeight === 'number' ? data.mediaHeight : existing.mediaHeight,
          mimeType: typeof data.mimeType === 'string' ? data.mimeType : existing.mimeType,
          sizeBytes: typeof data.sizeBytes === 'number' ? data.sizeBytes : existing.sizeBytes,
          durationMs: typeof data.durationMs === 'number' ? data.durationMs : existing.durationMs,
          mediaCreatedAt: data.mediaCreatedAt instanceof Date ? data.mediaCreatedAt : existing.mediaCreatedAt,
          updatedAt: new Date(),
        };

        room.set(objectId, next);
        return next;
      }

      throw new Error('Object not found');
    },
    async deleteObject(roomId, objectId) {
      const room = roomMap.get(roomId);
      if (!room) return 0;
      return room.delete(objectId) ? 1 : 0;
    },
    async getRoomObjects(roomId) {
      const room = roomMap.get(roomId);
      if (!room) return [];
      return Array.from(room.values()).sort((a, b) => {
        if (a.zIndex === b.zIndex) {
          return a.createdAt.getTime() - b.createdAt.getTime();
        }
        return a.zIndex - b.zIndex;
      });
    },
  };
}

export async function getRoomObjects(roomId: string): Promise<Record<string, unknown>[]> {
  return getRoomObjectsFromRepository(prismaObjectRepository, roomId);
}

/**
 * Returns room objects transformed into client payload shape.
 * Nulls from unsupported legacy DB variants are dropped to keep wire payloads
 * canonical for current clients.
 */
export async function getRoomObjectsFromRepository(
  repository: ObjectRepository,
  roomId: string
): Promise<Record<string, unknown>[]> {
  const objects = await repository.getRoomObjects(roomId);

  return objects
    .map((row) => toClientObject(row))
    .filter((obj): obj is ClientCanvasObject => obj !== null);
}

export function registerObjectHandlers(io: Server): void {
  registerObjectHandlersWithRepository(io, prismaObjectRepository);
}

/**
 * Registers object lifecycle socket handlers for a repository implementation.
 *
 * The injected repository keeps transport logic decoupled from storage concerns,
 * which makes behavior testing deterministic and allows backend evolution without
 * touching event contracts.
 */
export function registerObjectHandlersWithRepository(io: Server, repository: ObjectRepository): void {
  io.on('connection', (socket: Socket) => {
    const authSocket = socket as AuthenticatedSocket;

    // object:create — Client creates a new object
    socket.on('object:create', async (payload: ObjectCreatePayload) => {
      const { operationId, roomId, object } = payload;

      // Validate that the socket is in this room
      if (!authSocket.roomId || authSocket.roomId !== roomId) {
        socket.emit('error', {
          code: 'UNAUTHORIZED',
          message: 'Not a member of this room',
        });
        return;
      }

      if (!isClientCanvasObject(object)) {
        socket.emit('error', {
          code: 'INVALID_PAYLOAD',
          message: 'Invalid object payload',
        });
        return;
      }

      if (!authSocket.sessionId) {
        socket.emit('error', {
          code: 'SESSION_INVALID',
          message: 'Missing authenticated session',
        });
        return;
      }

      try {
        const created = await repository.createObject(
          toCreateData(roomId, authSocket.sessionId as string, object)
        );

        const clientObject = toClientObject(created);
        if (!clientObject) {
          socket.emit('error', {
            code: 'INVALID_PAYLOAD',
            message: 'Unsupported object type',
          });
          return;
        }

        io.to(roomId).emit('object:created', {
          operationId,
          object: clientObject,
          serverTs: new Date(),
        });
      } catch (err) {
        console.error('[object:create] error:', err);
        socket.emit('error', {
          code: 'OBJECT_CREATE_FAILED',
          message: 'Failed to create object',
        });
      }
    });

    // object:update — Client moves or modifies an object.
    // Persist only effective changes and broadcast only when state transitions.
    socket.on('object:update', async (payload: ObjectUpdatePayload) => {
      const { operationId, roomId, objectId, updates } = payload;

      // Validate room membership
      if (!authSocket.roomId || authSocket.roomId !== roomId) {
        socket.emit('error', {
          code: 'UNAUTHORIZED',
          message: 'Not a member of this room',
        });
        return;
      }

      try {
        const existing = await repository.findObject(roomId, objectId);

        if (!existing) {
          socket.emit('error', {
            code: 'NOT_FOUND',
            message: 'Object not found',
          });
          return;
        }

        const updateData = buildUpdateData(existing, updates);

        if (Object.keys(updateData).length === 0) {
          return;
        }

        if (!hasEffectiveUpdate(existing, updateData)) {
          return;
        }

        await repository.updateObject(existing.id, updateData);

        io.to(roomId).emit('object:updated', {
          operationId,
          objectId,
          updates,
          serverTs: new Date(),
        });
      } catch (err) {
        console.error('[object:update] error:', err);
        socket.emit('error', {
          code: 'OBJECT_UPDATE_FAILED',
          message: 'Failed to update object',
        });
      }
    });

    // object:delete — Client deletes an object
    socket.on('object:delete', async (payload: ObjectDeletePayload) => {
      const { operationId, roomId, objectId } = payload;

      // Validate room membership
      if (!authSocket.roomId || authSocket.roomId !== roomId) {
        socket.emit('error', {
          code: 'UNAUTHORIZED',
          message: 'Not a member of this room',
        });
        return;
      }

      try {
        const deletedCount = await repository.deleteObject(roomId, objectId);

        if (deletedCount === 0) {
          socket.emit('error', {
            code: 'NOT_FOUND',
            message: 'Object not found',
          });
          return;
        }

        io.to(roomId).emit('object:deleted', {
          operationId,
          objectId,
          serverTs: new Date(),
        });
      } catch (err) {
        console.error('[object:delete] error:', err);
        socket.emit('error', {
          code: 'OBJECT_DELETE_FAILED',
          message: 'Failed to delete object',
        });
      }
    });
  });
}
