import { create } from 'zustand';

// Viewport state for infinite canvas: pan (offset) and zoom (scale)
// Centralized here to keep all transform logic in one place and enable
// future features like viewport export, minimap, and cursor positioning.
export interface ViewportState {
  // Pan: offset from origin in world coordinates (negative = panned right/down)
  offsetX: number;
  offsetY: number;
  
  // Zoom: scale factor; 1 = 100%, 0.5 = 50%, 2 = 200%
  scale: number;
  
  // Actions
  setPan: (offsetX: number, offsetY: number) => void;
  setZoom: (scale: number) => void;
  
  // Pan by delta (for smooth dragging)
  panBy: (deltaX: number, deltaY: number) => void;
  
  // Zoom by factor around a point (for wheel zoom centered on mouse)
  zoomBy: (factor: number, centerX: number, centerY: number) => void;
  
  // Reset to origin with 1x zoom
  reset: () => void;
}

// Min/max zoom levels to prevent extreme scales
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5.0;

/**
 * Viewport transform store shared by all canvas interactions.
 *
 * `offsetX/offsetY/scale` are applied directly to Konva Stage transforms and
 * therefore must remain internally consistent: zoom operations update both scale
 * and offsets together to keep the zoom anchor stable.
 */
export const useViewportStore = create<ViewportState>((set) => ({
  offsetX: 0,
  offsetY: 0,
  scale: 1,

  setPan: (offsetX, offsetY) => {
    set({ offsetX, offsetY });
  },

  setZoom: (scale) => {
    // Clamp zoom to reasonable limits
    const clampedScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
    set({ scale: clampedScale });
  },

  panBy: (deltaX, deltaY) => {
    set((state) => ({
      offsetX: state.offsetX + deltaX,
      offsetY: state.offsetY + deltaY,
    }));
  },

  // Zoom around a point: translate point to origin, scale, translate back.
  // This keeps the mouse position stable during zoom.
  zoomBy: (factor, centerX, centerY) => {
    set((state) => {
      const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.scale * factor));
      
      // Translate center point to world coordinates
      const worldX = (centerX - state.offsetX) / state.scale;
      const worldY = (centerY - state.offsetY) / state.scale;
      
      // New offset keeps world point at screen position during zoom
      const newOffsetX = centerX - worldX * newScale;
      const newOffsetY = centerY - worldY * newScale;
      
      return {
        scale: newScale,
        offsetX: newOffsetX,
        offsetY: newOffsetY,
      };
    });
  },

  reset: () => {
    set({ offsetX: 0, offsetY: 0, scale: 1 });
  },
}));
