import React, { useRef, useCallback } from 'react';
import { Text as KonvaText, Group, Rect } from 'react-konva';
import Konva from 'konva';
import { CanvasObject } from '../../store/objects.js';

interface ShapeProps {
  object: CanvasObject;
  selected: boolean;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  onDelete: () => void;
}

const HANDLE_SIZE = 10;
const MIN_WIDTH = 80;
const MIN_HEIGHT = 32;

export const TextShape: React.FC<ShapeProps> = ({ object, selected, onMove, onResize, onDelete }) => {
  const textRef = useRef<Konva.Text>(null);
  const groupRef = useRef<Konva.Group>(null);

  const handleDragStart = useCallback(() => {
    // Visual feedback
  }, []);

  const handleDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    onMove(e.target.x(), e.target.y());
  }, [onMove]);

  const handleResizeEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const nextWidth = Math.max(MIN_WIDTH, e.target.x() + HANDLE_SIZE);
    const nextHeight = Math.max(MIN_HEIGHT, e.target.y() + HANDLE_SIZE);
    onResize(nextWidth, nextHeight);
  }, [onResize]);

  const handleDoubleClick = useCallback(() => {
    onDelete();
  }, [onDelete]);

  return (
    <Group
      ref={groupRef}
      id={object.id}
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
        width={object.width}
        height={object.height}
        stroke={selected ? '#0f172a' : undefined}
        strokeWidth={selected ? 0.4 : 0}
        shadowColor={selected ? '#0f172a' : undefined}
        shadowBlur={selected ? 8 : 0}
        shadowOpacity={selected ? 0.15 : 0}
        onMouseEnter={(e) => {
          (e.target.getStage()?.container() as HTMLElement).style.cursor = 'pointer';
        }}
        onMouseLeave={(e) => {
          (e.target.getStage()?.container() as HTMLElement).style.cursor = 'grab';
        }}
      />
      <Rect
        x={Math.max(0, object.width - HANDLE_SIZE)}
        y={Math.max(0, object.height - HANDLE_SIZE)}
        width={HANDLE_SIZE}
        height={HANDLE_SIZE}
        fill={selected ? '#0f172a' : '#64748b'}
        cornerRadius={2}
        visible={selected}
        draggable
        onMouseDown={(e) => {
          e.cancelBubble = true;
        }}
        onTouchStart={(e) => {
          e.cancelBubble = true;
        }}
        onDragEnd={handleResizeEnd}
      />
    </Group>
  );
};
