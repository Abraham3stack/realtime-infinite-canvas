import React, { useRef, useCallback } from 'react';
import { Group, Line, Rect } from 'react-konva';
import Konva from 'konva';
import { CanvasObject } from '../../store/objects.js';

interface ShapeProps {
  object: CanvasObject;
  selected: boolean;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  onDelete: () => void;
  onEditText?: (objectId: string) => void;
  onDragStart?: () => void;
  onDragMove?: (x: number, y: number) => void;
  draggable?: boolean;
}

const HANDLE_SIZE = 10;
const MIN_SIZE = 32;

export const TriangleShape: React.FC<ShapeProps> = ({
  object,
  selected,
  onMove,
  onResize,
  onDelete,
  onDragStart,
  onDragMove,
  draggable = true,
}) => {
  const groupRef = useRef<Konva.Group>(null);

  const handleDragStart = useCallback(() => {
    onDragStart?.();
  }, [onDragStart]);

  const handleDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    onDragMove?.(e.target.x(), e.target.y());
  }, [onDragMove]);

  const handleDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    onMove(e.target.x(), e.target.y());
  }, [onMove]);

  const handleResizeEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const nextWidth = Math.max(MIN_SIZE, e.target.x() + HANDLE_SIZE);
    const nextHeight = Math.max(MIN_SIZE, e.target.y() + HANDLE_SIZE);
    onResize(nextWidth, nextHeight);
  }, [onResize]);

  const handleDoubleClick = useCallback(() => {
    onDelete();
  }, [onDelete]);

  const points = [
    object.width / 2,
    0,
    object.width,
    object.height,
    0,
    object.height,
  ];

  return (
    <Group
      ref={groupRef}
      id={object.id}
      x={object.x}
      y={object.y}
      draggable={draggable}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDblClick={handleDoubleClick}
    >
      <Line
        points={points}
        closed
        fill={object.color}
        stroke={selected ? '#0f172a' : '#333'}
        strokeWidth={selected ? 3 : 2}
        shadowColor={selected ? '#0f172a' : '#000'}
        shadowBlur={selected ? 14 : 0}
        shadowOpacity={selected ? 0.15 : 0}
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
