import React, { useRef, useCallback } from 'react';
import { Group, Rect } from 'react-konva';
import Konva from 'konva';
import { CanvasObject } from '../../store/objects.js';

interface ShapeProps {
  object: CanvasObject;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  onDelete: () => void;
}

const HANDLE_SIZE = 10;
const MIN_SIZE = 32;

export const RectangleShape: React.FC<ShapeProps> = ({ object, onMove, onResize, onDelete }) => {
  const groupRef = useRef<Konva.Group>(null);

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
      draggable
      onDragEnd={handleDragEnd}
      onDblClick={handleDoubleClick}
    >
      <Rect
        width={object.width}
        height={object.height}
        fill={object.color}
        stroke="#333"
        strokeWidth={2}
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
        fill="#0f172a"
        cornerRadius={2}
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
