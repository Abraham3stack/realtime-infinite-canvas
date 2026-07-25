// Canvas object validation schemas

import { z } from 'zod';

export const ObjectTypeSchema = z.enum(['rectangle', 'circle', 'text', 'sticky-note', 'image', 'audio', 'video']);

const MediaMetadataSchema = z.object({
  mediaUrl: z.string().url().optional(),
  mediaPublicId: z.string().min(1).optional(),
  mediaResourceType: z.enum(['image', 'audio', 'video']).optional(),
  mediaFormat: z.string().optional(),
  mediaWidth: z.number().int().positive().optional(),
  mediaHeight: z.number().int().positive().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  mediaCreatedAt: z.string().datetime().optional(),
});

const BaseCanvasObjectSchema = z.object({
  id: z.string().min(1),
  type: ObjectTypeSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive().finite(),
  height: z.number().positive().finite(),
  zIndex: z.number().int(),
  rotation: z.number().finite(),
  createdBySessionId: z.string().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export const TextObjectSchema = BaseCanvasObjectSchema.extend({
  type: z.literal('text'),
  text: z.string().optional(),
  fontSize: z.number().positive().finite().optional(),
  color: z.string().optional(),
});

export const RectangleObjectSchema = BaseCanvasObjectSchema.extend({
  type: z.literal('rectangle'),
  color: z.string().optional(),
});

export const CircleObjectSchema = BaseCanvasObjectSchema.extend({
  type: z.literal('circle'),
  color: z.string().optional(),
});

export const StickyObjectSchema = BaseCanvasObjectSchema.extend({
  type: z.literal('sticky-note'),
  text: z.string().optional(),
  color: z.string().optional(),
  fontSize: z.number().positive().finite().optional(),
});

export const ImageObjectSchema = BaseCanvasObjectSchema.extend({
  type: z.literal('image'),
}).extend(MediaMetadataSchema.shape);

export const AudioObjectSchema = BaseCanvasObjectSchema.extend({
  type: z.literal('audio'),
  text: z.string().optional(),
}).extend(MediaMetadataSchema.shape);

export const VideoObjectSchema = BaseCanvasObjectSchema.extend({
  type: z.literal('video'),
  text: z.string().optional(),
}).extend(MediaMetadataSchema.shape);

export const CanvasObjectSchema = z.discriminatedUnion('type', [
  TextObjectSchema,
  RectangleObjectSchema,
  CircleObjectSchema,
  StickyObjectSchema,
  ImageObjectSchema,
  AudioObjectSchema,
  VideoObjectSchema,
]);

export const CanvasObjectPatchSchema = z.object({
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  zIndex: z.number().int().optional(),
  rotation: z.number().finite().optional(),
  width: z.number().positive().finite().optional(),
  height: z.number().positive().finite().optional(),
  color: z.string().optional(),
  text: z.string().optional(),
  fontSize: z.number().optional(),
  mediaUrl: z.string().optional(),
  mediaPublicId: z.string().optional(),
  mediaResourceType: z.enum(['image', 'audio', 'video']).optional(),
  mediaFormat: z.string().optional(),
  mediaWidth: z.number().int().positive().optional(),
  mediaHeight: z.number().int().positive().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  mediaCreatedAt: z.string().datetime().optional(),
  createdBySessionId: z.string().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export const CanvasSnapshotSchema = z.object({
  objects: z.array(CanvasObjectSchema),
});

export type ObjectType = z.infer<typeof ObjectTypeSchema>;
export type TextObject = z.infer<typeof TextObjectSchema>;
export type RectangleObject = z.infer<typeof RectangleObjectSchema>;
export type CircleObject = z.infer<typeof CircleObjectSchema>;
export type StickyObject = z.infer<typeof StickyObjectSchema>;
export type ImageObject = z.infer<typeof ImageObjectSchema>;
export type AudioObject = z.infer<typeof AudioObjectSchema>;
export type VideoObject = z.infer<typeof VideoObjectSchema>;
export type CanvasObject = z.infer<typeof CanvasObjectSchema>;
export type CanvasObjectPatch = z.infer<typeof CanvasObjectPatchSchema>;
export type CanvasSnapshot = z.infer<typeof CanvasSnapshotSchema>;
