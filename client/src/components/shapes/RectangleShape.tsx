import React, { useRef, useCallback } from 'react';
import { Group, Rect } from 'react-konva';
import Konva from 'konva';
import { CanvasObject } from '../../store/objects.js';

interface ShapeProps {
  object: CanvasObject;
  selected: boolean;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  onDelete: () => void;
  onDragStart?: () => void;
  onDragMove?: (x: number, y: number) => void;
  draggable?: boolean;
}

const HANDLE_SIZE = 10;
const MIN_SIZE = 32;

export const RectangleShape: React.FC<ShapeProps> = ({ object, selected, onMove, onResize, onDelete, onDragStart, onDragMove, draggable = true }) => {
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
      <Rect
        width={object.width}
        height={object.height}
        fill={object.color}
        stroke={selected ? '#0f172a' : '#333'}
        strokeWidth={selected ? 3 : 2}
        shadowColor={selected ? '#0f172a' : '#000'}
        shadowBlur={selected ? 14 : 0}
        shadowOpacity={selected ? 0.15 : 0}
        onMouseEnter={(e) => {
          e.target.to({ fill: '#2980b9' });
        }}
        onMouseLeave={(e) => {
          e.target.to({ fill: object.color });
        }}
        cornerRadius={4}
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
