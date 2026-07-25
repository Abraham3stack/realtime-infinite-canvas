import React, { useRef, useCallback } from 'react';
import { Rect } from 'react-konva';
import Konva from 'konva';
import { CanvasObject } from '../../store/objects.js';

interface ShapeProps {
  object: CanvasObject;
  onMove: (x: number, y: number) => void;
  onDelete: () => void;
}

export const RectangleShape: React.FC<ShapeProps> = ({ object, onMove, onDelete }) => {
  const rectRef = useRef<Konva.Rect>(null);
  const isDragging = useRef(false);

  const handleDragStart = useCallback(() => {
    isDragging.current = true;
  }, []);

  const handleDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    isDragging.current = false;
    onMove(e.target.x(), e.target.y());
  }, [onMove]);

  const handleDoubleClick = useCallback(() => {
    onDelete();
  }, [onDelete]);

  return (
    <Rect
      ref={rectRef}
      x={object.x}
      y={object.y}
      width={object.width}
      height={object.height}
      fill={object.color}
      stroke="#333"
      strokeWidth={2}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDblClick={handleDoubleClick}
      onMouseEnter={(e) => {
        e.target.to({ fill: '#2980b9' });
      }}
      onMouseLeave={(e) => {
        e.target.to({ fill: object.color });
      }}
      cornerRadius={4}
    />
  );
};
