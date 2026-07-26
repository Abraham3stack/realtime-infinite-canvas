import { Prisma, type RoomEvent as PrismaRoomEvent } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import type { RoomEvent, RoomEventType, RoomEventsListRequest, RoomEventsListResponse } from '@realtime-canvas/shared';

export const ROOM_EVENT_SCHEMA_VERSION = 1;

export interface RoomEventJournalEntry {
  roomId: string;
  operationId: string;
  actorSessionId: string;
  actorDisplayName: string;
  eventType: RoomEventType;
  payload: Record<string, unknown>;
  schemaVersion?: number;
}

type RoomEventCreateInput = Prisma.RoomEventUncheckedCreateInput;

function toRoomEventPayload(value: Prisma.JsonValue): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

export function toClientRoomEvent(row: PrismaRoomEvent): RoomEvent {
  return {
    id: row.id,
    roomId: row.roomId,
    sequenceNumber: row.sequenceNumber,
    operationId: row.operationId,
    actorSessionId: row.actorSessionId,
    actorDisplayName: row.actorDisplayName,
    eventType: row.eventType as RoomEventType,
    payload: toRoomEventPayload(row.payload),
    schemaVersion: row.schemaVersion,
    createdAt: row.createdAt,
  };
}

async function allocateRoomEventSequence(tx: Prisma.TransactionClient, roomId: string): Promise<number> {
  const room = await tx.room.update({
    where: { id: roomId },
    data: {
      eventSequenceNumber: {
        increment: 1,
      },
    },
    select: {
      eventSequenceNumber: true,
    },
  });

  return room.eventSequenceNumber;
}

function buildRoomEventData(sequenceNumber: number, entry: RoomEventJournalEntry): RoomEventCreateInput {
  return {
    roomId: entry.roomId,
    sequenceNumber,
    operationId: entry.operationId,
    actorSessionId: entry.actorSessionId,
    actorDisplayName: entry.actorDisplayName,
    eventType: entry.eventType,
    payload: entry.payload as Prisma.InputJsonValue,
    schemaVersion: entry.schemaVersion ?? ROOM_EVENT_SCHEMA_VERSION,
  };
}

export async function appendRoomEvent(
  tx: Prisma.TransactionClient,
  entry: RoomEventJournalEntry
): Promise<RoomEvent> {
  const sequenceNumber = await allocateRoomEventSequence(tx, entry.roomId);
  const created = await tx.roomEvent.create({
    data: buildRoomEventData(sequenceNumber, entry),
  });

  return toClientRoomEvent(created);
}

export async function listRoomEvents(
  roomId: string,
  options: RoomEventsListRequest
): Promise<RoomEventsListResponse> {
  const events = await prisma.roomEvent.findMany({
    where: {
      roomId,
      sequenceNumber: {
        gt: options.afterSequenceNumber ?? -1,
      },
    },
    orderBy: { sequenceNumber: 'asc' },
  });

  return {
    roomId,
    events: events.map((row) => toClientRoomEvent(row)),
  };
}
