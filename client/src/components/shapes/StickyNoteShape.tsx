import React, { useRef, useCallback } from 'react';
import { Rect, Text as KonvaText, Group } from 'react-konva';
import Konva from 'konva';
import { CanvasObject } from '../../store/objects.js';

interface ShapeProps {
  object: CanvasObject;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  onDelete: () => void;
}

export const StickyNoteShape: React.FC<ShapeProps> = ({
  object,
  onMove,
  onResize,
  onDelete,
}) => {
  const groupRef = useRef<Konva.Group>(null);
  const rectRef = useRef<Konva.Rect>(null);

  const HANDLE_SIZE = 10;
  const MIN_SIZE = 40;

  const handleDragStart = useCallback(() => {
    // Visual feedback
  }, []);

  const handleDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    onMove(e.target.x(), e.target.y());
  }, [onMove]);

  const handleDoubleClick = useCallback(() => {
    onDelete();
  }, [onDelete]);

  const handleResizeEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const nextWidth = Math.max(MIN_SIZE, e.target.x() + HANDLE_SIZE);
    const nextHeight = Math.max(MIN_SIZE, e.target.y() + HANDLE_SIZE);
    onResize(nextWidth, nextHeight);
  }, [onResize]);

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
