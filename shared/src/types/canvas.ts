// Canvas object types (current realtime runtime contract)

export type CanvasObjectType = 'rectangle' | 'circle' | 'text' | 'sticky-note' | 'image' | 'audio' | 'video';

export interface CanvasObject {
  id: string;
  type: CanvasObjectType;
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

export interface CanvasObjectPatch {
  x?: number;
  y?: number;
  zIndex?: number;
  rotation?: number;
  width?: number;
  height?: number;
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
  [key: string]: unknown;
}

export interface CanvasSnapshot {
  objects: CanvasObject[];
}
