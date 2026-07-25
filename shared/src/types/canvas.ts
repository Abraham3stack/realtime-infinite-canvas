// Canvas object types (current realtime runtime contract)

export type CanvasObjectType = 'rectangle' | 'circle' | 'text' | 'sticky-note' | 'image' | 'audio';

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
  mimeType?: string;
  sizeBytes?: number;
  durationMs?: number;
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
  mimeType?: string;
  sizeBytes?: number;
  durationMs?: number;
  [key: string]: unknown;
}

export interface CanvasSnapshot {
  objects: CanvasObject[];
}
