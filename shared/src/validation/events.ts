// Socket.IO event validation schemas

import { z } from 'zod';
import { RoomParticipantSchema, ViewportSchema, RoomStateSchema } from './room.js';
import { CanvasObjectSchema, CanvasObjectPatchSchema } from './canvas.js';

export const ErrorResponseSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string().optional(),
});

export const AckResponseSchema = z.object({
  operationId: z.string().optional(),
  event: z.string().optional(),
  success: z.boolean(),
  serverSeq: z.number().int().nonnegative().optional(),
  serverTs: z.date().optional(),
});

// room:create
export const RoomCreatePayloadSchema = z.object({
  displayName: z.string().min(1).max(50),
});

// room:created
export const RoomCreatedPayloadSchema = z.object({
  roomId: z.string().uuid(),
  shareCode: z.string(),
  session: z.object({
    id: z.string().uuid(),
    token: z.string(),
  }),
  participant: RoomParticipantSchema,
  initialState: RoomStateSchema,
});

// room:join
export const RoomJoinPayloadSchema = z.object({
  roomId: z.string().uuid().optional(),
  shareCode: z.string().optional(),
  displayName: z.string().min(1).max(50).optional(),
  sessionToken: z.string().optional(),
});

// room:stateSnapshot
export const RoomStateSnapshotPayloadSchema = RoomStateSchema.extend({
  canvasObjects: z.array(CanvasObjectSchema),
});

// room:leave
export const RoomLeavePayloadSchema = z.object({
  roomId: z.string().uuid(),
});

// room:userJoined
export const RoomUserJoinedPayloadSchema = z.object({
  participant: RoomParticipantSchema,
  serverTs: z.date(),
});

// room:userLeft
export const RoomUserLeftPayloadSchema = z.object({
  participantId: z.string().uuid(),
  roomId: z.string().uuid(),
  serverTs: z.date(),
});

// presence:update
export const PresenceUpdatePayloadSchema = z.object({
  roomId: z.string().uuid(),
  viewport: ViewportSchema,
  status: z.enum(['active', 'idle']),
});

// presence:updated
export const PresenceUpdatedPayloadSchema = z.object({
  participantId: z.string().uuid(),
  viewport: ViewportSchema.optional(),
  status: z.enum(['active', 'idle', 'disconnected']),
  serverTs: z.date(),
});

// cursor:update
export const CursorUpdatePayloadSchema = z.object({
  roomId: z.string().uuid(),
  cursor: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
  }),
});

// cursor:updated
export const CursorUpdatedPayloadSchema = z.object({
  participantId: z.string().uuid(),
  cursor: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
  }),
  serverTs: z.date(),
});

// object:create
export const ObjectCreatePayloadSchema = z.object({
  operationId: z.string().uuid(),
  roomId: z.string().uuid(),
  clientTs: z.date(),
  object: z.object({
    id: z.string().uuid(),
    roomId: z.string().uuid(),
    type: z.enum(['text', 'shape', 'sticky', 'image', 'audio']),
    x: z.number().finite(),
    y: z.number().finite(),
    zIndex: z.number().int(),
    rotation: z.number().finite().optional(),
    createdBySessionId: z.string().uuid(),
    width: z.number().positive().finite().optional(),
    height: z.number().positive().finite().optional(),
    content: z.string().optional(),
    shapeType: z.enum(['rectangle', 'circle', 'triangle']).optional(),
    fillColor: z.string().optional(),
    strokeColor: z.string().optional(),
    fontSize: z.number().optional(),
    fontFamily: z.string().optional(),
    color: z.string().optional(),
    mediaUrl: z.string().optional(),
    mediaPublicId: z.string().optional(),
    mimeType: z.string().optional(),
    sizeBytes: z.number().optional(),
    durationMs: z.number().optional(),
    backgroundColor: z.string().optional(),
    textColor: z.string().optional(),
  }),
});

// object:created
export const ObjectCreatedPayloadSchema = z.object({
  operationId: z.string().uuid(),
  object: CanvasObjectSchema,
  version: z.number().int().positive(),
  serverSeq: z.number().int().nonnegative(),
  serverTs: z.date(),
});

// object:update
export const ObjectUpdatePayloadSchema = z.object({
  operationId: z.string().uuid(),
  roomId: z.string().uuid(),
  clientTs: z.date(),
  objectId: z.string().uuid(),
  patch: CanvasObjectPatchSchema,
  baseVersion: z.number().int().positive().optional(),
});

// object:updated
export const ObjectUpdatedPayloadSchema = z.object({
  operationId: z.string().uuid(),
  objectId: z.string().uuid(),
  patchApplied: CanvasObjectPatchSchema,
  newVersion: z.number().int().positive(),
  serverSeq: z.number().int().nonnegative(),
  serverTs: z.date(),
});

// object:delete
export const ObjectDeletePayloadSchema = z.object({
  operationId: z.string().uuid(),
  roomId: z.string().uuid(),
  clientTs: z.date(),
  objectId: z.string().uuid(),
});

// object:deleted
export const ObjectDeletedPayloadSchema = z.object({
  operationId: z.string().uuid(),
  objectId: z.string().uuid(),
  serverSeq: z.number().int().nonnegative(),
  serverTs: z.date(),
});

// objects:bulkSyncRequest
export const BulkSyncRequestPayloadSchema = z.object({
  roomId: z.string().uuid(),
  lastKnownServerSeq: z.number().int().nonnegative(),
});

// sync:deltaBatch
export const SyncDeltaBatchPayloadSchema = z.object({
  deltas: z.array(
    z.union([
      ObjectCreatedPayloadSchema,
      ObjectUpdatedPayloadSchema,
      ObjectDeletedPayloadSchema,
    ])
  ),
  serverSeq: z.number().int().nonnegative(),
});

// media:register
export const MediaRegisterPayloadSchema = z.object({
  operationId: z.string().uuid(),
  roomId: z.string().uuid(),
  clientTs: z.date(),
  objectId: z.string().uuid(),
  mediaType: z.enum(['image', 'audio']),
  mediaUrl: z.string().url(),
  mediaPublicId: z.string().min(1),
  mimeType: z.string(),
  sizeBytes: z.number().int().positive(),
  durationMs: z.number().int().positive().optional(),
});

// sync:error
export const SyncErrorPayloadSchema = z.object({
  operationId: z.string().optional(),
  error: ErrorResponseSchema,
  recoverable: z.boolean(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type AckResponse = z.infer<typeof AckResponseSchema>;
export type RoomCreatePayload = z.infer<typeof RoomCreatePayloadSchema>;
export type RoomCreatedPayload = z.infer<typeof RoomCreatedPayloadSchema>;
export type RoomJoinPayload = z.infer<typeof RoomJoinPayloadSchema>;
export type RoomStateSnapshotPayload = z.infer<typeof RoomStateSnapshotPayloadSchema>;
export type RoomLeavePayload = z.infer<typeof RoomLeavePayloadSchema>;
export type RoomUserJoinedPayload = z.infer<typeof RoomUserJoinedPayloadSchema>;
export type RoomUserLeftPayload = z.infer<typeof RoomUserLeftPayloadSchema>;
export type PresenceUpdatePayload = z.infer<typeof PresenceUpdatePayloadSchema>;
export type PresenceUpdatedPayload = z.infer<typeof PresenceUpdatedPayloadSchema>;
export type CursorUpdatePayload = z.infer<typeof CursorUpdatePayloadSchema>;
export type CursorUpdatedPayload = z.infer<typeof CursorUpdatedPayloadSchema>;
export type ObjectCreatePayload = z.infer<typeof ObjectCreatePayloadSchema>;
export type ObjectCreatedPayload = z.infer<typeof ObjectCreatedPayloadSchema>;
export type ObjectUpdatePayload = z.infer<typeof ObjectUpdatePayloadSchema>;
export type ObjectUpdatedPayload = z.infer<typeof ObjectUpdatedPayloadSchema>;
export type ObjectDeletePayload = z.infer<typeof ObjectDeletePayloadSchema>;
export type ObjectDeletedPayload = z.infer<typeof ObjectDeletedPayloadSchema>;
export type BulkSyncRequestPayload = z.infer<typeof BulkSyncRequestPayloadSchema>;
export type SyncDeltaBatchPayload = z.infer<typeof SyncDeltaBatchPayloadSchema>;
export type MediaRegisterPayload = z.infer<typeof MediaRegisterPayloadSchema>;
export type SyncErrorPayload = z.infer<typeof SyncErrorPayloadSchema>;
