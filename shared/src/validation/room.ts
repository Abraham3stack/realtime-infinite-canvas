// Room validation schemas

import { z } from 'zod';

export const ViewportSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  zoom: z.number().finite().positive(),
});

export const RoomParticipantStatusSchema = z.enum(['active', 'idle', 'disconnected']);

export const RoomSchema = z.object({
  id: z.string().uuid(),
  shareCode: z.string().length(6).regex(/^[A-Z0-9]+$/),
  createdBySessionId: z.string().uuid(),
  title: z.string().max(255).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const RoomParticipantSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  sessionId: z.string().uuid(),
  joinedAt: z.date(),
  lastSeenAt: z.date(),
  isActive: z.boolean(),
  status: RoomParticipantStatusSchema,
  lastViewportX: z.number().finite().optional(),
  lastViewportY: z.number().finite().optional(),
  lastViewportZoom: z.number().finite().positive().optional(),
});

export const PresenceSchema = z.object({
  participantId: z.string().uuid(),
  viewport: ViewportSchema.optional(),
  status: RoomParticipantStatusSchema,
  serverTs: z.date(),
});

export const RoomStateSchema = z.object({
  room: RoomSchema,
  participants: z.array(RoomParticipantSchema),
  latestServerSeq: z.number().int().nonnegative(),
});

export type Viewport = z.infer<typeof ViewportSchema>;
export type RoomParticipantStatus = z.infer<typeof RoomParticipantStatusSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type RoomParticipant = z.infer<typeof RoomParticipantSchema>;
export type Presence = z.infer<typeof PresenceSchema>;
export type RoomState = z.infer<typeof RoomStateSchema>;
