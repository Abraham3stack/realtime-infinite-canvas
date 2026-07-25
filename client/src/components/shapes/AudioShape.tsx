import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Group, Rect, Text as KonvaText } from 'react-konva';
import Konva from 'konva';
import { CanvasObject } from '../../store/objects.js';

interface ShapeProps {
  object: CanvasObject;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  onDelete: () => void;
}

const HANDLE_SIZE = 10;
const MIN_WIDTH = 120;
const MIN_HEIGHT = 56;

export const AudioShape: React.FC<ShapeProps> = ({ object, onMove, onResize, onDelete }) => {
  const groupRef = useRef<Konva.Group>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (!object.mediaUrl) {
      audioRef.current = null;
      return;
    }

    const audio = new Audio(object.mediaUrl);
    audioRef.current = audio;

    const onEnded = () => setIsPlaying(false);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.pause();
      audio.currentTime = 0;
      audio.removeEventListener('ended', onEnded);
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

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      audio.play().then(() => setIsPlaying(true)).catch(() => {
        setIsPlaying(false);
      });
      return;
    }

    audio.pause();
    setIsPlaying(false);
  }, []);

  const durationLabel = object.durationMs && object.durationMs > 0
    ? `${Math.round(object.durationMs / 100) / 10}s`
    : '0.0s';

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
      <Rect width={object.width} height={object.height} fill="#dbeafe" stroke="#1d4ed8" strokeWidth={1} cornerRadius={8} />
      <Rect x={8} y={8} width={28} height={28} fill="#1d4ed8" cornerRadius={14} onClick={togglePlay} />
      <KonvaText text={isPlaying ? '||' : '>'} x={17} y={13} fontSize={14} fill="#ffffff" onClick={togglePlay} />
      <KonvaText text={object.text || 'Audio Placeholder'} x={46} y={12} fontSize={14} fill="#1e293b" width={Math.max(0, object.width - 54)} />
      <KonvaText
        text={durationLabel}
        x={46}
        y={32}
        fontSize={12}
        fill="#475569"
        width={Math.max(0, object.width - 54)}
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
