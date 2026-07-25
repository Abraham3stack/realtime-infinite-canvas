import React, { useRef, useCallback } from 'react';
import { Text as KonvaText, Group } from 'react-konva';
import Konva from 'konva';
import { CanvasObject } from '../../store/objects.js';

interface ShapeProps {
  object: CanvasObject;
  onMove: (x: number, y: number) => void;
  onDelete: () => void;
}

export const TextShape: React.FC<ShapeProps> = ({ object, onMove, onDelete }) => {
  const textRef = useRef<Konva.Text>(null);
  const groupRef = useRef<Konva.Group>(null);

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
    <Group
      ref={groupRef}
      x={object.x}
      y={object.y}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDblClick={handleDoubleClick}
    >
      <KonvaText
        ref={textRef}
        text={object.text || 'Text'}
        fontSize={object.fontSize || 14}
        fill={object.color}
        fontFamily="Arial, sans-serif"
        onMouseEnter={(e) => {
          (e.target.getStage()?.container() as HTMLElement).style.cursor = 'pointer';
        }}
        onMouseLeave={(e) => {
          (e.target.getStage()?.container() as HTMLElement).style.cursor = 'grab';
        }}
      />
    </Group>
  );
};
