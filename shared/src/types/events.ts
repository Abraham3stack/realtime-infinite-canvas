// Socket.IO event types shared by client/server.
//
// Realtime contract notes:
// - `operationId` correlates optimistic client actions with server echoes for
//   deduplication/reconciliation.
// - `serverTs` represents server-observed timing and should not be treated as a
//   strict total ordering across distributed clients.

import { CanvasObject, CanvasObjectPatch } from './canvas.js';
import { RoomState, Presence, Viewport, RoomParticipant } from './room.js';

// Error response
export interface ErrorResponse {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

// Acknowledgment response
export interface AckResponse {
  operationId?: string;
  event?: string;
  success: boolean;
  serverSeq?: number;
  serverTs?: Date;
}

// Client -> Server: room:create
export interface RoomCreatePayload {
  displayName: string;
}

// Server -> Client: room:created
export interface RoomCreatedPayload {
  roomId: string;
  shareCode: string;
  session: {
    id: string;
    token: string;
  };
  participant: RoomParticipant;
  initialState: RoomState;
}

// Client -> Server: room:join
export interface RoomJoinPayload {
  roomId?: string;
  shareCode?: string;
  displayName?: string;
  sessionToken?: string;
}

// Server -> Client: room:stateSnapshot
export interface RoomStateSnapshotPayload extends RoomState {
  canvasObjects: CanvasObject[];
}

// Client -> Server: room:leave
export interface RoomLeavePayload {
  roomId: string;
}

// Server -> Room: room:userJoined
export interface RoomUserJoinedPayload {
  participant: RoomParticipant;
  serverTs: Date;
}

// Server -> Room: room:userLeft
export interface RoomUserLeftPayload {
  participantId: string;
  roomId: string;
  serverTs: Date;
}

// Client -> Server: presence:update
export interface PresenceUpdatePayload {
  roomId: string;
  viewport: Viewport;
  status: 'active' | 'idle';
}

// Server -> Room: presence:updated
export interface PresenceUpdatedPayload extends Presence {
  participantId: string;
  sessionId: string;
  roomId: string;
  displayName: string;
}

// Client -> Server: cursor:update
export interface CursorUpdatePayload {
  roomId: string;
  cursor: {
    x: number;
    y: number;
  };
}

// Server -> Room: cursor:updated
export interface CursorUpdatedPayload {
  participantId: string;
  cursor: {
    x: number;
    y: number;
  };
  serverTs: Date;
}

// Client -> Server: object:create
export interface ObjectCreatePayload {
  operationId: string;
  roomId: string;
  object: CanvasObject;
}

// Server -> Room: object:created
export interface ObjectCreatedPayload {
  operationId: string;
  object: CanvasObject;
  serverTs: Date;
}

// Client -> Server: object:update
export interface ObjectUpdatePayload {
  operationId: string;
  roomId: string;
  objectId: string;
  updates: CanvasObjectPatch;
}

// Server -> Room: object:updated
export interface ObjectUpdatedPayload {
  operationId: string;
  objectId: string;
  updates: CanvasObjectPatch;
  serverTs: Date;
}

// Client -> Server: object:delete
export interface ObjectDeletePayload {
  operationId: string;
  roomId: string;
  objectId: string;
}

// Server -> Room: object:deleted
export interface ObjectDeletedPayload {
  operationId: string;
  objectId: string;
  serverTs: Date;
}

// Client -> Server: objects:bulkSyncRequest
export interface BulkSyncRequestPayload {
  roomId: string;
  lastKnownServerSeq: number;
}

// Server -> Client: sync:deltaBatch
export interface SyncDeltaBatchPayload {
  deltas: Array<ObjectCreatedPayload | ObjectUpdatedPayload | ObjectDeletedPayload>;
  serverSeq: number;
}

// Client -> Server: media:register
export interface MediaRegisterPayload {
  operationId: string;
  roomId: string;
  clientTs: Date;
  objectId: string;
  mediaType: 'image' | 'audio' | 'video';
  mediaUrl: string;
  mediaPublicId: string;
  mimeType: string;
  sizeBytes: number;
  durationMs?: number;
}

// Server -> Client: sync:error
export interface SyncErrorPayload {
  operationId?: string;
  error: ErrorResponse;
  recoverable: boolean;
}
