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
const MIN_WIDTH = 180;
const MIN_HEIGHT = 120;

export const VideoShape: React.FC<ShapeProps> = ({ object, selected, onMove, onResize, onDelete }) => {
  const groupRef = useRef<Konva.Group>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [isPlayable, setIsPlayable] = useState(false);

  useEffect(() => {
    if (!object.mediaUrl) {
      setVideoEl(null);
      setIsPlayable(false);
      return;
    }

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.preload = 'metadata';
    video.src = object.mediaUrl;

    const handleLoadedData = () => {
      setVideoEl(video);
      setIsPlayable(true);
    };

    const handleError = () => {
      setVideoEl(null);
      setIsPlayable(false);
    };

    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('error', handleError);

    return () => {
      video.pause();
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('error', handleError);
    };
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

  const durationLabel = object.durationMs && object.durationMs > 0
    ? `${Math.round(object.durationMs / 100) / 10}s`
    : '--';

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
        fill="#dbeafe"
        stroke={selected ? '#0f172a' : '#1e3a8a'}
        strokeWidth={selected ? 2 : 1}
        cornerRadius={6}
        shadowColor={selected ? '#0f172a' : '#000'}
        shadowBlur={selected ? 12 : 0}
        shadowOpacity={selected ? 0.12 : 0}
      />
      {videoEl && isPlayable ? (
        <KonvaImage image={videoEl} width={object.width} height={object.height} cornerRadius={6} />
      ) : (
        <Rect
          x={10}
          y={10}
          width={Math.max(0, object.width - 20)}
          height={Math.max(0, object.height - 20)}
          fill="#1e293b"
          cornerRadius={4}
        />
      )}
      <Rect x={12} y={12} width={34} height={24} fill="rgba(15, 23, 42, 0.75)" cornerRadius={4} />
      <KonvaText text=">" x={24} y={16} fontSize={12} fill="#ffffff" />
      <KonvaText text={object.text || 'Video'} x={52} y={15} fontSize={13} fill="#0f172a" width={Math.max(0, object.width - 64)} />
      <KonvaText
        text={`${durationLabel} • ${object.mediaFormat || 'video'}`}
        x={52}
        y={32}
        fontSize={11}
        fill="#334155"
        width={Math.max(0, object.width - 64)}
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
