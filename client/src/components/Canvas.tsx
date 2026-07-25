import React, { useRef, useCallback, useEffect, useState } from 'react';
import { Stage, Layer } from 'react-konva';
import Konva from 'konva';
import { useViewportStore } from '../store/viewport.js';
import { useCanvasObjectsStore } from '../store/objects.js';
import { ObjectRenderer } from './ObjectRenderer.js';

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

  // Canvas objects: local CRUD state
  const { objects, addObject, updateObject, deleteObject } = useCanvasObjectsStore((s) => ({
    objects: s.objects,
    addObject: s.addObject,
    updateObject: s.updateObject,
    deleteObject: s.deleteObject,
  }));

  // Track mouse state for panning
  const isPanning = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });

  // Keyboard shortcuts for object creation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Use keyboard shortcuts: R=Rectangle, C=Circle, T=Text, S=Sticky Note
      // Create object at center of current viewport
      const centerX = (stageSize.width / 2 - offsetX) / scale;
      const centerY = (stageSize.height / 2 - offsetY) / scale;

      switch (e.key.toLowerCase()) {
        case 'r':
          e.preventDefault();
          addObject('rectangle', centerX, centerY);
          break;
        case 'c':
          e.preventDefault();
          addObject('circle', centerX, centerY);
          break;
        case 't':
          e.preventDefault();
          addObject('text', centerX, centerY);
          break;
        case 's':
          e.preventDefault();
          addObject('sticky-note', centerX, centerY);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addObject, stageSize, offsetX, offsetY, scale]);

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

  // Mouse down: start panning (but not if clicking on an object)
  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    // Only pan on left mouse button (button 0) and only on Stage (not on objects)
    if (e.evt.button !== 0) return;
    
    // Check if clicked on an object (descendants include shapes)
    const clickedObject = e.target === e.target.getStage();
    if (!clickedObject) return;
    
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
        {/* Render all canvas objects */}
        {objects.map((obj) => (
          <ObjectRenderer
            key={obj.id}
            object={obj}
            onMove={(x, y) => updateObject(obj.id, { x, y })}
            onDelete={() => deleteObject(obj.id)}
          />
        ))}
      </Layer>
    </Stage>
  );
};
