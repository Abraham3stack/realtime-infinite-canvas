import { create } from 'zustand';

// Canvas object type definitions
export type CanvasObjectType = 'rectangle' | 'circle' | 'text' | 'sticky-note';

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
  zIndex: number;
}

export interface CanvasObjectsState {
  objects: CanvasObject[];
  nextZIndex: number;

  // CRUD operations
  addObject: (type: CanvasObjectType, x: number, y: number) => string;
  updateObject: (id: string, updates: Partial<CanvasObject>) => void;
  deleteObject: (id: string) => void;
  getObject: (id: string) => CanvasObject | undefined;
  
  // Set all objects (for sync from server — bulk hydration on join)
  setObjects: (objects: CanvasObject[]) => void;

  // Add a single object received from a remote peer.
  // Uses a functional Zustand update to avoid snapshot races when multiple
  // object:created events arrive in rapid succession.
  addObjectFromSync: (object: CanvasObject) => void;

  // Clear all objects (for testing/reset)
  clear: () => void;
}

// Factory for default object properties by type
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
      zIndex: state.nextZIndex,
    };

    set((state) => ({
      objects: [...state.objects, newObject],
      nextZIndex: state.nextZIndex + 1,
    }));

    return id;
  },

  updateObject: (id, updates) => {
    set((state) => ({
      objects: state.objects.map((obj) =>
        obj.id === id ? { ...obj, ...updates } : obj
      ),
    }));
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
    // When receiving objects from server, calculate the highest z-index
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
