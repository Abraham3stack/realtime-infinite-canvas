import React, { useRef, useCallback } from 'react';
import { Circle as KonvaCircle } from 'react-konva';
import Konva from 'konva';
import { CanvasObject } from '../../store/objects.js';

interface ShapeProps {
  object: CanvasObject;
  onMove: (x: number, y: number) => void;
  onDelete: () => void;
}

export const CircleShape: React.FC<ShapeProps> = ({ object, onMove, onDelete }) => {
  const circleRef = useRef<Konva.Circle>(null);

  const handleDragStart = useCallback(() => {
    // Visual feedback
  }, []);

  const handleDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    onMove(e.target.x(), e.target.y());
  }, [onMove]);

  const handleDoubleClick = useCallback(() => {
    onDelete();
  }, [onDelete]);

  return (
    <KonvaCircle
      ref={circleRef}
      x={object.x + object.width / 2}
      y={object.y + object.height / 2}
      radius={object.width / 2}
      fill={object.color}
      stroke="#333"
      strokeWidth={2}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDblClick={handleDoubleClick}
      onMouseEnter={(e) => {
        e.target.to({ fill: '#c0392b' });
      }}
      onMouseLeave={(e) => {
        e.target.to({ fill: object.color });
      }}
    />
  );
};
