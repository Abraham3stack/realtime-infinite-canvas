import { create } from 'zustand';

// Canvas object type definitions
export type CanvasObjectType = 'rectangle' | 'circle' | 'text' | 'sticky-note' | 'image' | 'audio' | 'video';

export interface CanvasObject {
  id: string;
  type: CanvasObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  color: string;
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
  zIndex: number;
}

export interface MediaObjectInput {
  type: 'image' | 'audio' | 'video';
  x: number;
  y: number;
  mediaUrl: string;
  mediaPublicId: string;
  mediaResourceType: 'image' | 'audio' | 'video';
  mediaFormat: string;
  mediaWidth?: number;
  mediaHeight?: number;
  mimeType: string;
  sizeBytes: number;
  durationMs?: number;
  mediaCreatedAt: string;
  text?: string;
  createdBySessionId?: string;
}

/**
 * Canonical client-side canvas object store.
 *
 * Invariants:
 * - `objects` is the render source of truth.
 * - `nextZIndex` is monotonic within a client session to preserve stacking order
 *   for newly created objects.
 * - Realtime sync paths may overwrite local values with server-canonical fields
 *   (timestamps/media metadata) during echo reconciliation.
 */
export interface CanvasObjectsState {
  objects: CanvasObject[];
  nextZIndex: number;

  // CRUD operations
  addObject: (type: CanvasObjectType, x: number, y: number) => string;
  addMediaObject: (input: MediaObjectInput) => string;
  updateObject: (id: string, updates: Partial<CanvasObject>) => void;
  deleteObject: (id: string) => void;
  getObject: (id: string) => CanvasObject | undefined;
  
  // Set all objects from a server snapshot (join/rejoin hydration boundary).
  setObjects: (objects: CanvasObject[]) => void;

  // Add a single object received from a remote peer.
  // Uses a functional Zustand update to avoid snapshot races when multiple
  // object:created events arrive in rapid succession.
  addObjectFromSync: (object: CanvasObject) => void;

  // Clear all objects (for testing/reset)
  clear: () => void;
}

/**
 * Default visual baselines for each object type.
 *
 * These defaults intentionally keep initial dimensions and colors predictable so
 * realtime demos stay legible before per-object customization is introduced.
 */
const getDefaultProperties = (type: CanvasObjectType) => {
  const baseSize = 100;
  const defaults: Record<CanvasObjectType, Partial<CanvasObject>> = {
    rectangle: {
      width: baseSize,
      height: baseSize,
      color: '#3498db',
    },
    circle: {
      width: baseSize,
      height: baseSize,
      color: '#e74c3c',
    },
    text: {
      width: baseSize * 1.5,
      height: 40,
      color: '#2c3e50',
      text: 'Text',
      fontSize: 14,
    },
    'sticky-note': {
      width: 150,
      height: 150,
      color: '#f1c40f',
      text: 'Note',
      fontSize: 12,
    },
    image: {
      width: 220,
      height: 160,
      color: '#cbd5e1',
    },
    audio: {
      width: 220,
      height: 80,
      color: '#dbeafe',
      text: 'Audio',
    },
    video: {
      width: 260,
      height: 180,
      color: '#dbeafe',
      text: 'Video',
    },
  };
  return defaults[type];
};

// Generate unique IDs using timestamp + random
const generateId = () => `obj_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

export const useCanvasObjectsStore = create<CanvasObjectsState>((set, get) => ({
  objects: [],
  nextZIndex: 1,

  addObject: (type, x, y) => {
    const id = generateId();
    const defaults = getDefaultProperties(type);
    const state = get();
    
    const newObject: CanvasObject = {
      id,
      type,
      x,
      y,
      width: defaults.width ?? 100,
      height: defaults.height ?? 100,
      rotation: 0,
      color: defaults.color ?? '#3498db',
      text: defaults.text,
      fontSize: defaults.fontSize,
      mediaUrl: defaults.mediaUrl,
      mediaPublicId: defaults.mediaPublicId,
      mimeType: defaults.mimeType,
      sizeBytes: defaults.sizeBytes,
      durationMs: defaults.durationMs,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      zIndex: state.nextZIndex,
    };

    set((state) => ({
      objects: [...state.objects, newObject],
      nextZIndex: state.nextZIndex + 1,
    }));

    return id;
  },

  addMediaObject: (input) => {
    const id = generateId();
    const state = get();
    const now = new Date().toISOString();

    const fallbackWidth = input.type === 'audio' ? 240 : input.type === 'video' ? 280 : 220;
    const fallbackHeight = input.type === 'audio' ? 90 : input.type === 'video' ? 180 : 160;

    const object: CanvasObject = {
      id,
      type: input.type,
      x: input.x,
      y: input.y,
      width: input.mediaWidth ?? fallbackWidth,
      height: input.mediaHeight ?? fallbackHeight,
      rotation: 0,
      color: input.type === 'audio' ? '#dbeafe' : '#e2e8f0',
      text: input.text,
      mediaUrl: input.mediaUrl,
      mediaPublicId: input.mediaPublicId,
      mediaResourceType: input.mediaResourceType,
      mediaFormat: input.mediaFormat,
      mediaWidth: input.mediaWidth,
      mediaHeight: input.mediaHeight,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      durationMs: input.durationMs,
      mediaCreatedAt: input.mediaCreatedAt,
      createdBySessionId: input.createdBySessionId,
      createdAt: now,
      updatedAt: now,
      zIndex: state.nextZIndex,
    };

    set((current) => ({
      objects: [...current.objects, object],
      nextZIndex: current.nextZIndex + 1,
    }));

    return id;
  },

  updateObject: (id, updates) => {
    set((state) => {
      const index = state.objects.findIndex((obj) => obj.id === id);
      if (index === -1) return state;

      const current = state.objects[index];
      const entries = Object.entries(updates) as Array<[keyof CanvasObject, unknown]>;
      const hasMeaningfulChange = entries.some(([key, value]) => !Object.is(current[key], value));

      // No-op suppression avoids unnecessary rerenders and downstream socket
      // emissions when callers submit unchanged values.
      if (!hasMeaningfulChange) {
        return state;
      }

      const next: CanvasObject = {
        ...current,
        ...updates,
        updatedAt: (updates.updatedAt as string | undefined) ?? new Date().toISOString(),
      };

      const objects = state.objects.slice();
      objects[index] = next;

      return { objects };
    });
  },

  deleteObject: (id) => {
    set((state) => ({
      objects: state.objects.filter((obj) => obj.id !== id),
    }));
  },

  getObject: (id) => {
    return get().objects.find((obj) => obj.id === id);
  },

  setObjects: (objects) => {
    // Preserve stacking semantics by advancing local allocation cursor beyond
    // the highest server-provided z-index in the snapshot.
    const maxZIndex = objects.reduce((max, obj) => Math.max(max, obj.zIndex), 0);
    set({
      objects,
      nextZIndex: maxZIndex + 1,
    });
  },

  addObjectFromSync: (object) => {
    // Functional update prevents snapshot races when multiple object:created
    // events arrive in rapid succession — each set() reads the latest committed state.
    set((state) => {
      if (state.objects.find((o) => o.id === object.id)) return state; // idempotent
      return {
        objects: [...state.objects, object],
        nextZIndex: Math.max(state.nextZIndex, object.zIndex + 1),
      };
    });
  },

  clear: () => {
    set({ objects: [], nextZIndex: 1 });
  },
}));
