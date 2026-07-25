import React, { useRef, useCallback, useEffect, useState } from 'react';
import { Stage, Layer } from 'react-konva';
import Konva from 'konva';
import { useViewportStore } from '../store/viewport.js';

export const Canvas: React.FC = () => {
  const stageRef = useRef<Konva.Stage>(null);
  const [stageSize, setStageSize] = useState({ width: 1024, height: 768 });
  
  // Viewport state: pan and zoom transforms
  const { offsetX, offsetY, scale, panBy, zoomBy } = useViewportStore((s) => ({
    offsetX: s.offsetX,
    offsetY: s.offsetY,
    scale: s.scale,
    panBy: s.panBy,
    zoomBy: s.zoomBy,
  }));

  // Track mouse state for panning
  const isPanning = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });

  // Update stage size on mount and resize
  useEffect(() => {
    const updateSize = () => {
      if (stageRef.current) {
        const container = stageRef.current.container() as HTMLDivElement;
        if (container) {
          const rect = container.getBoundingClientRect();
          setStageSize({ width: rect.width, height: rect.height });
        }
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Mouse down: start panning
  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    // Only pan on left mouse button (button 0)
    if (e.evt.button !== 0) return;
    
    isPanning.current = true;
    lastMousePos.current = { x: e.evt.clientX, y: e.evt.clientY };
  }, []);

  // Mouse move: pan if dragging
  const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!isPanning.current) return;

    const deltaX = e.evt.clientX - lastMousePos.current.x;
    const deltaY = e.evt.clientY - lastMousePos.current.y;

    panBy(deltaX, deltaY);
    lastMousePos.current = { x: e.evt.clientX, y: e.evt.clientY };
  }, [panBy]);

  // Mouse up: stop panning
  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  // Wheel: zoom toward/away from mouse position
  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();

    // Determine zoom direction: wheel up (negative deltaY) = zoom in (>1), down = zoom out (<1)
    const zoomFactor = e.evt.deltaY < 0 ? 1.1 : 0.9;
    
    // Get mouse position in screen space
    const mouseX = e.evt.clientX;
    const mouseY = e.evt.clientY;
    
    zoomBy(zoomFactor, mouseX, mouseY);
  }, [zoomBy]);

  return (
    <Stage
      ref={stageRef}
      width={stageSize.width}
      height={stageSize.height}
      x={offsetX}
      y={offsetY}
      scaleX={scale}
      scaleY={scale}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      style={{
        cursor: isPanning.current ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
    >
      <Layer>
        {/* Extension point: Objects will be rendered here */}
        {/* Canvas background and grid can be added here for visual reference */}
      </Layer>
    </Stage>
  );
};
