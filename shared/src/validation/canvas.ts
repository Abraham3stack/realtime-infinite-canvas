// Canvas object validation schemas

import { z } from 'zod';

export const ObjectTypeSchema = z.enum(['text', 'shape', 'sticky', 'image', 'audio']);

const BaseCanvasObjectSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  type: ObjectTypeSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  zIndex: z.number().int(),
  rotation: z.number().finite().optional(),
  version: z.number().int().positive(),
  createdBySessionId: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
  deletedAt: z.date().optional(),
});

export const TextObjectSchema = BaseCanvasObjectSchema.extend({
  type: z.literal('text'),
  width: z.number().positive().finite(),
  height: z.number().positive().finite(),
  content: z.string(),
  fontSize: z.number().positive().finite().optional(),
  fontFamily: z.string().optional(),
  color: z.string().regex(/^#[0-9A-F]{6}$/i).optional(),
});

export const ShapeObjectSchema = BaseCanvasObjectSchema.extend({
  type: z.literal('shape'),
  width: z.number().positive().finite(),
  height: z.number().positive().finite(),
  shapeType: z.enum(['rectangle', 'circle', 'triangle']),
  fillColor: z.string().regex(/^#[0-9A-F]{6}$/i).optional(),
  strokeColor: z.string().regex(/^#[0-9A-F]{6}$/i).optional(),
  strokeWidth: z.number().positive().finite().optional(),
});

export const StickyObjectSchema = BaseCanvasObjectSchema.extend({
  type: z.literal('sticky'),
  width: z.number().positive().finite(),
  height: z.number().positive().finite(),
  content: z.string(),
  backgroundColor: z.string().regex(/^#[0-9A-F]{6}$/i).optional(),
  textColor: z.string().regex(/^#[0-9A-F]{6}$/i).optional(),
});

export const ImageObjectSchema = BaseCanvasObjectSchema.extend({
  type: z.literal('image'),
  width: z.number().positive().finite(),
  height: z.number().positive().finite(),
  mediaUrl: z.string().url(),
  mediaPublicId: z.string().min(1),
  mimeType: z.string().regex(/^image\//),
  sizeBytes: z.number().int().positive(),
});

export const AudioObjectSchema = BaseCanvasObjectSchema.extend({
  type: z.literal('audio'),
  width: z.number().positive().finite(),
  height: z.number().positive().finite(),
  mediaUrl: z.string().url(),
  mediaPublicId: z.string().min(1),
  mimeType: z.string().regex(/^audio\//),
  sizeBytes: z.number().int().positive(),
  durationMs: z.number().int().positive(),
});

export const CanvasObjectSchema = z.discriminatedUnion('type', [
  TextObjectSchema,
  ShapeObjectSchema,
  StickyObjectSchema,
  ImageObjectSchema,
  AudioObjectSchema,
]);

export const CanvasObjectPatchSchema = z.object({
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  zIndex: z.number().int().optional(),
  rotation: z.number().finite().optional(),
  width: z.number().positive().finite().optional(),
  height: z.number().positive().finite().optional(),
  content: z.string().optional(),
  shapeType: z.enum(['rectangle', 'circle', 'triangle']).optional(),
  fillColor: z.string().optional(),
  strokeColor: z.string().optional(),
  fontFamily: z.string().optional(),
  fontSize: z.number().optional(),
});

export const CanvasSnapshotSchema = z.object({
  objects: z.array(CanvasObjectSchema),
  lastServerSeq: z.number().int().nonnegative(),
});

export type ObjectType = z.infer<typeof ObjectTypeSchema>;
export type TextObject = z.infer<typeof TextObjectSchema>;
export type ShapeObject = z.infer<typeof ShapeObjectSchema>;
export type StickyObject = z.infer<typeof StickyObjectSchema>;
export type ImageObject = z.infer<typeof ImageObjectSchema>;
export type AudioObject = z.infer<typeof AudioObjectSchema>;
export type CanvasObject = z.infer<typeof CanvasObjectSchema>;
export type CanvasObjectPatch = z.infer<typeof CanvasObjectPatchSchema>;
export type CanvasSnapshot = z.infer<typeof CanvasSnapshotSchema>;
