export interface ViewportTransform {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Convert the visible canvas center (screen/canvas space) into world space.
 * World space is what object x/y positions use in the store.
 */
export function canvasCenterToWorld(size: CanvasSize, viewport: ViewportTransform): Point {
  return {
    x: (size.width / 2 - viewport.offsetX) / viewport.scale,
    y: (size.height / 2 - viewport.offsetY) / viewport.scale,
  };
}

/**
 * Convert a browser client point to Stage canvas-local screen space.
 *
 * Konva zoom math expects points in canvas-local coordinates,
 * not global viewport coordinates.
 */
export function clientToCanvasPoint(clientX: number, clientY: number, containerRect: DOMRect): Point {
  return {
    x: clientX - containerRect.left,
    y: clientY - containerRect.top,
  };
}
