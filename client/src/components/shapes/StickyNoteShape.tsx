import React, { useRef, useCallback } from 'react';
import { Rect, Text as KonvaText, Group } from 'react-konva';
import Konva from 'konva';
import { CanvasObject } from '../../store/objects.js';

interface ShapeProps {
  object: CanvasObject;
  onMove: (x: number, y: number) => void;
  onDelete: () => void;
}

export const StickyNoteShape: React.FC<ShapeProps> = ({
  object,
  onMove,
  onDelete,
}) => {
  const groupRef = useRef<Konva.Group>(null);
  const rectRef = useRef<Konva.Rect>(null);

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
      {/* Sticky note background */}
      <Rect
        ref={rectRef}
        width={object.width}
        height={object.height}
        fill={object.color}
        stroke="#ccc"
        strokeWidth={1}
        shadowColor="#000"
        shadowBlur={3}
        shadowOpacity={0.1}
        cornerRadius={2}
        onMouseEnter={(e) => {
          (e.target.getStage()?.container() as HTMLElement).style.cursor = 'pointer';
        }}
        onMouseLeave={(e) => {
          (e.target.getStage()?.container() as HTMLElement).style.cursor = 'grab';
        }}
      />
      {/* Text content */}
      <KonvaText
        text={object.text || 'Note'}
        fontSize={object.fontSize || 12}
        fill="#2c3e50"
        fontFamily="Arial, sans-serif"
        width={object.width - 8}
        height={object.height - 8}
        x={4}
        y={4}
        wrap="word"
        verticalAlign="top"
        pointerEvents="none"
      />
    </Group>
  );
};
