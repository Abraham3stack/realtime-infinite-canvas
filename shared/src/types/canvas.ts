// Canvas object types

export type ObjectType = 'text' | 'shape' | 'sticky' | 'image' | 'audio';

export interface BaseCanvasObject {
  id: string;
  roomId: string;
  type: ObjectType;
  x: number;
  y: number;
  zIndex: number;
  rotation?: number;
  version: number;
  createdBySessionId: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

export interface TextObject extends BaseCanvasObject {
  type: 'text';
  width: number;
  height: number;
  content: string;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
}

export interface ShapeObject extends BaseCanvasObject {
  type: 'shape';
  width: number;
  height: number;
  shapeType: 'rectangle' | 'circle' | 'triangle';
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
}

export interface StickyObject extends BaseCanvasObject {
  type: 'sticky';
  width: number;
  height: number;
  content: string;
  backgroundColor?: string;
  textColor?: string;
}

export interface ImageObject extends BaseCanvasObject {
  type: 'image';
  width: number;
  height: number;
  mediaUrl: string;
  mediaPublicId: string;
  mimeType: string;
  sizeBytes: number;
}

export interface AudioObject extends BaseCanvasObject {
  type: 'audio';
  width: number;
  height: number;
  mediaUrl: string;
  mediaPublicId: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
}

export type CanvasObject =
  | TextObject
  | ShapeObject
  | StickyObject
  | ImageObject
  | AudioObject;

export interface CanvasObjectPatch {
  x?: number;
  y?: number;
  zIndex?: number;
  rotation?: number;
  width?: number;
  height?: number;
  content?: string;
  [key: string]: unknown;
}

export interface CanvasSnapshot {
  objects: CanvasObject[];
  lastServerSeq: number;
}
