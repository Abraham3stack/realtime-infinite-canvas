import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Group, Image as KonvaImage, Rect, Text as KonvaText } from 'react-konva';
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
const MIN_HEIGHT = 60;

export const ImageShape: React.FC<ShapeProps> = ({ object, selected, onMove, onResize, onDelete }) => {
  const groupRef = useRef<Konva.Group>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!object.mediaUrl) {
      setImage(null);
      return;
    }

    const img = new window.Image();
    img.onload = () => setImage(img);
    img.onerror = () => setImage(null);
    img.src = object.mediaUrl;
  }, [object.mediaUrl]);

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
      onDragEnd={handleDragEnd}
      onDblClick={handleDoubleClick}
    >
      <Rect
        width={object.width}
        height={object.height}
        fill="#e2e8f0"
        stroke={selected ? '#0f172a' : '#334155'}
        strokeWidth={selected ? 2 : 1}
        cornerRadius={4}
        shadowColor={selected ? '#0f172a' : '#000'}
        shadowBlur={selected ? 12 : 0}
        shadowOpacity={selected ? 0.15 : 0}
      />
      {image ? (
        <KonvaImage image={image} width={object.width} height={object.height} cornerRadius={4} />
      ) : (
        <KonvaText
          text="Image Placeholder"
          x={8}
          y={8}
          width={object.width - 16}
          height={object.height - 16}
          fontSize={14}
          fill="#334155"
          verticalAlign="middle"
          align="center"
        />
      )}
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
