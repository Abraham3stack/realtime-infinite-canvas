import React, { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { Stage, Layer } from 'react-konva';
import Konva from 'konva';
import Matter from 'matter-js';
import type { RoomEvent } from '@realtime-canvas/shared';
import { useViewportStore } from '../store/viewport.js';
import { useCanvasObjectsStore, type CanvasObject } from '../store/objects.js';
import { useRoomStore } from '../store/room.js';
import { useReplayStore } from '../store/replay.js';
import { ObjectRenderer } from './ObjectRenderer.js';
import { MiniMapRadar } from './MiniMapRadar.js';
import { LoadingOverlay } from './ui/LoadingOverlay.js';
import { socket } from '../socket.js';
import type { CanvasObjectType } from '../store/objects.js';
import { uploadMediaFiles, type MediaUploadType, type UploadedMedia } from '../hooks/useMediaUpload.js';
import { canvasCenterToWorld, clientToCanvasPoint } from '../utils/coordinates.js';
import { type RoomPhysicsState, usePhysicsStore } from '../store/physics.js';
import { getOfflineOperationsQueue, type OfflineOperation } from '../utils/offlineQueue.js';

// Type definitions for socket payloads
interface ObjectCreatedPayload {
  operationId: string;
  object: CanvasObject;
  serverTs: Date;
}

interface ObjectUpdatedPayload {
  operationId: string;
  objectId: string;
  updates: Record<string, unknown>;
  serverTs: Date;
}

interface ObjectDeletedPayload {
  operationId: string;
  objectId: string;
  serverTs: Date;
}

interface PhysicsStatePayload {
  roomId: string;
  state: RoomPhysicsState;
  serverTs: string;
}

interface PresenceUpdatedPayload {
  participantId: string;
  sessionId: string;
  roomId: string;
  viewport?: {
    x: number;
    y: number;
    zoom: number;
    width?: number;
    height?: number;
  };
  status: 'active' | 'idle' | 'disconnected';
  serverTs: string;
}

interface RoomEventsListResponsePayload {
  code?: string;
  message?: string;
  roomId: string;
  events: RoomEvent[];
}

type PresenceStatus = 'active' | 'idle';
type FieldMode = 'attract' | 'repel' | null;

interface DragPointerSample {
  x: number;
  y: number;
  at: number;
}

interface DragMomentumState {
  samples: DragPointerSample[];
}

type OperationResult = 'ack' | 'timeout';
type ShapeMenuOption = 'rectangle' | 'square' | 'circle' | 'triangle';
type CreationTool = Extract<CanvasObjectType, 'rectangle' | 'circle' | 'triangle' | 'text'>;

const PHYSICS_OBJECT_TYPES: CanvasObjectType[] = ['rectangle', 'circle', 'text'];
const PHYSICS_OBJECT_TYPE_SET = new Set<CanvasObjectType>(PHYSICS_OBJECT_TYPES);
const DEFAULT_COLOR_BY_TYPE: Record<CanvasObjectType, string> = {
  rectangle: '#3498db',
  circle: '#e74c3c',
  triangle: '#8b5cf6',
  text: '#2c3e50',
  'sticky-note': '#f1c40f',
  image: '#cbd5e1',
  audio: '#dbeafe',
  video: '#dbeafe',
};
const PHYSICS_SYNC_INTERVAL_MS = 80;
const PHYSICS_DRAG_VELOCITY_MAX = 2.5;
const PHYSICS_THROW_SAMPLE_LIMIT = 8;
const PHYSICS_THROW_SAMPLE_WINDOW_MS = 160;
const PHYSICS_THROW_MIN_MOVEMENT_PX = 4;
const PHYSICS_THROW_MIN_SPEED = 0.05;
const PHYSICS_FIELD_RADIUS_PX = 340;
const PHYSICS_FIELD_MAX_FORCE = 0.00045;
const PHYSICS_FIELD_MIN_DISTANCE_PX = 14;
const PRESENCE_SYNC_INTERVAL_MS = 120;
const REPLAY_BASE_STEP_INTERVAL_MS = 250;

function isPhysicsObjectType(type: CanvasObjectType): boolean {
  return PHYSICS_OBJECT_TYPE_SET.has(type);
}

function appendDragSample(samples: DragPointerSample[], sample: DragPointerSample): DragPointerSample[] {
  const next = [...samples, sample];
  if (next.length <= PHYSICS_THROW_SAMPLE_LIMIT) return next;
  return next.slice(next.length - PHYSICS_THROW_SAMPLE_LIMIT);
}

function computeReleaseVelocity(samples: DragPointerSample[]): { x: number; y: number } | null {
  if (samples.length < 2) return null;

  const last = samples[samples.length - 1];
  if (!last) return null;

  const recent = samples.filter((sample) => last.at - sample.at <= PHYSICS_THROW_SAMPLE_WINDOW_MS);
  const windowSamples = recent.length >= 2 ? recent : samples.slice(-2);
  if (windowSamples.length < 2) return null;

  let totalDx = 0;
  let totalDy = 0;
  let totalDt = 0;
  let totalDistance = 0;

  for (let index = 1; index < windowSamples.length; index += 1) {
    const prev = windowSamples[index - 1];
    const curr = windowSamples[index];
    if (!prev || !curr) continue;

    const dt = curr.at - prev.at;
    if (dt <= 0) continue;

    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    totalDx += dx;
    totalDy += dy;
    totalDt += dt;
    totalDistance += Math.hypot(dx, dy);
  }

  if (totalDt <= 0 || totalDistance < PHYSICS_THROW_MIN_MOVEMENT_PX) return null;

  const vx = (totalDx / totalDt) * 16.666;
  const vy = (totalDy / totalDt) * 16.666;
  const speed = Math.hypot(vx, vy);
  if (speed < PHYSICS_THROW_MIN_SPEED) return null;

  if (speed > PHYSICS_DRAG_VELOCITY_MAX) {
    const scale = PHYSICS_DRAG_VELOCITY_MAX / speed;
    return {
      x: vx * scale,
      y: vy * scale,
    };
  }

  return { x: vx, y: vy };
}

const SVG_BACKGROUND_GRADIENT_ID = 'canvas-export-background-gradient';

const XML_ESCAPE_LOOKUP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPE_LOOKUP[char] ?? char);
}

function formatSvgNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Number.parseFloat(value.toFixed(3));
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function wrapTextLines(text: string, width: number, fontSize: number, maxLines = 8): string[] {
  const normalized = text.trim();
  if (!normalized) return [''];

  const explicitLines = normalized.split(/\r?\n/);
  const approxCharsPerLine = Math.max(8, Math.floor(width / Math.max(1, fontSize * 0.62)));
  const wrapped: string[] = [];

  for (const line of explicitLines) {
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      wrapped.push('');
      continue;
    }

    let currentLine = words[0] ?? '';
    for (let index = 1; index < words.length; index += 1) {
      const word = words[index] ?? '';
      const candidate = `${currentLine} ${word}`.trim();
      if (candidate.length <= approxCharsPerLine) {
        currentLine = candidate;
      } else {
        wrapped.push(currentLine);
        currentLine = word;
      }
    }

    if (currentLine) wrapped.push(currentLine);
    if (wrapped.length >= maxLines) break;
  }

  return wrapped.slice(0, maxLines);
}

function renderTextBlock(options: {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  fill: string;
  align?: 'start' | 'middle' | 'end';
  lineHeight?: number;
  maxLines?: number;
}): string {
  const {
    text,
    x,
    y,
    width,
    height,
    fontSize,
    fontFamily,
    fill,
    align = 'start',
    lineHeight = 1.2,
    maxLines = 8,
  } = options;

  const lines = wrapTextLines(text, width, fontSize, maxLines);
  const safeWidth = Math.max(0, width);
  const safeHeight = Math.max(0, height);
  const textAnchor = align;
  const anchorX = align === 'middle' ? safeWidth / 2 : align === 'end' ? safeWidth : 0;
  const startY = y + fontSize;

  const tspans = lines.map((line, index) => {
    const dy = index === 0 ? 0 : fontSize * lineHeight;
    return `<tspan x="${formatSvgNumber(anchorX)}" dy="${formatSvgNumber(dy)}">${escapeXml(line)}</tspan>`;
  }).join('');

  return `<text x="${formatSvgNumber(x)}" y="${formatSvgNumber(startY)}" width="${formatSvgNumber(safeWidth)}" height="${formatSvgNumber(safeHeight)}" font-family="${escapeXml(fontFamily)}" font-size="${formatSvgNumber(fontSize)}" fill="${escapeXml(fill)}" text-anchor="${textAnchor}" dominant-baseline="hanging">${tspans}</text>`;
}

function renderObjectSvg(object: CanvasObject): string {
  const rotation = Number.isFinite(object.rotation) ? object.rotation : 0;
  const translate = `translate(${formatSvgNumber(object.x)} ${formatSvgNumber(object.y)})`;
  const rotate = rotation !== 0
    ? ` rotate(${formatSvgNumber(rotation)} ${formatSvgNumber(object.width / 2)} ${formatSvgNumber(object.height / 2)})`
    : '';
  const transform = `${translate}${rotate}`;
  const strokeColor = object.type === 'sticky-note' ? '#ccc' : '#334155';

  switch (object.type) {
    case 'rectangle':
      return `
        <g transform="${transform}">
          <rect x="0" y="0" width="${formatSvgNumber(object.width)}" height="${formatSvgNumber(object.height)}" rx="4" ry="4" fill="${escapeXml(object.color)}" stroke="${strokeColor}" stroke-width="2" />
        </g>
      `;
    case 'circle': {
      const radius = Math.max(0, Math.min(object.width, object.height) / 2);
      return `
        <g transform="${transform}">
          <circle cx="${formatSvgNumber(object.width / 2)}" cy="${formatSvgNumber(object.height / 2)}" r="${formatSvgNumber(radius)}" fill="${escapeXml(object.color)}" stroke="${strokeColor}" stroke-width="2" />
        </g>
      `;
    }
    case 'triangle':
      return `
        <g transform="${transform}">
          <polygon points="${formatSvgNumber(object.width / 2)},0 ${formatSvgNumber(object.width)},${formatSvgNumber(object.height)} 0,${formatSvgNumber(object.height)}" fill="${escapeXml(object.color)}" stroke="${strokeColor}" stroke-width="2" />
        </g>
      `;
    case 'text':
      return `
        <g transform="${transform}">
          ${renderTextBlock({
            text: object.text || 'Text',
            x: 0,
            y: 0,
            width: object.width,
            height: object.height,
            fontSize: object.fontSize || 14,
            fontFamily: 'Arial, sans-serif',
            fill: object.color,
            align: 'start',
            maxLines: 6,
          })}
        </g>
      `;
    case 'sticky-note':
      return `
        <g transform="${transform}">
          <rect x="0" y="0" width="${formatSvgNumber(object.width)}" height="${formatSvgNumber(object.height)}" rx="2" ry="2" fill="${escapeXml(object.color)}" stroke="${strokeColor}" stroke-width="1" />
          ${renderTextBlock({
            text: object.text || 'Note',
            x: 4,
            y: 4,
            width: Math.max(0, object.width - 8),
            height: Math.max(0, object.height - 8),
            fontSize: object.fontSize || 12,
            fontFamily: 'Arial, sans-serif',
            fill: '#2c3e50',
            align: 'start',
            maxLines: 10,
          })}
        </g>
      `;
    case 'image': {
      const imageFallback = `
        <rect x="0" y="0" width="${formatSvgNumber(object.width)}" height="${formatSvgNumber(object.height)}" rx="4" ry="4" fill="#e2e8f0" stroke="#334155" stroke-width="1" />
        ${renderTextBlock({
          text: 'Image Placeholder',
          x: 8,
          y: 8,
          width: Math.max(0, object.width - 16),
          height: Math.max(0, object.height - 16),
          fontSize: 14,
          fontFamily: 'Arial, sans-serif',
          fill: '#334155',
          align: 'middle',
          maxLines: 2,
        })}
      `;

      if (!object.mediaUrl) {
        return `<g transform="${transform}">${imageFallback}</g>`;
      }

      return `
        <g transform="${transform}">
          <rect x="0" y="0" width="${formatSvgNumber(object.width)}" height="${formatSvgNumber(object.height)}" rx="4" ry="4" fill="#e2e8f0" stroke="#334155" stroke-width="1" />
          <clipPath id="clip-${escapeXml(object.id)}"><rect x="0" y="0" width="${formatSvgNumber(object.width)}" height="${formatSvgNumber(object.height)}" rx="4" ry="4" /></clipPath>
          <image href="${escapeXml(object.mediaUrl)}" x="0" y="0" width="${formatSvgNumber(object.width)}" height="${formatSvgNumber(object.height)}" preserveAspectRatio="none" clip-path="url(#clip-${escapeXml(object.id)})" />
        </g>
      `;
    }
    case 'audio': {
      const durationLabel = object.durationMs && object.durationMs > 0
        ? `${Math.round(object.durationMs / 100) / 10}s`
        : '0.0s';

      return `
        <g transform="${transform}">
          <rect x="0" y="0" width="${formatSvgNumber(object.width)}" height="${formatSvgNumber(object.height)}" rx="8" ry="8" fill="#dbeafe" stroke="#1d4ed8" stroke-width="1" />
          <circle cx="22" cy="22" r="14" fill="#1d4ed8" />
          <text x="22" y="27" font-family="Arial, sans-serif" font-size="14" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${escapeXml('>')}</text>
          ${renderTextBlock({
            text: object.text || 'Audio Placeholder',
            x: 46,
            y: 12,
            width: Math.max(0, object.width - 54),
            height: 24,
            fontSize: 14,
            fontFamily: 'Arial, sans-serif',
            fill: '#1e293b',
            align: 'start',
            maxLines: 2,
          })}
          ${renderTextBlock({
            text: durationLabel,
            x: 46,
            y: 32,
            width: Math.max(0, object.width - 54),
            height: 20,
            fontSize: 12,
            fontFamily: 'Arial, sans-serif',
            fill: '#475569',
            align: 'start',
            maxLines: 1,
          })}
        </g>
      `;
    }
    case 'video': {
      const durationLabel = object.durationMs && object.durationMs > 0
        ? `${Math.round(object.durationMs / 100) / 10}s`
        : '--';

      return `
        <g transform="${transform}">
          <rect x="0" y="0" width="${formatSvgNumber(object.width)}" height="${formatSvgNumber(object.height)}" rx="6" ry="6" fill="#dbeafe" stroke="#1e3a8a" stroke-width="1" />
          <rect x="10" y="10" width="${formatSvgNumber(Math.max(0, object.width - 20))}" height="${formatSvgNumber(Math.max(0, object.height - 20))}" rx="4" ry="4" fill="#1e293b" />
          <rect x="12" y="12" width="34" height="24" rx="4" ry="4" fill="rgba(15, 23, 42, 0.75)" />
          <text x="29" y="28" font-family="Arial, sans-serif" font-size="12" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${escapeXml('>')}</text>
          ${renderTextBlock({
            text: object.text || 'Video',
            x: 52,
            y: 15,
            width: Math.max(0, object.width - 64),
            height: 20,
            fontSize: 13,
            fontFamily: 'Arial, sans-serif',
            fill: '#0f172a',
            align: 'start',
            maxLines: 2,
          })}
          ${renderTextBlock({
            text: `${durationLabel} • ${object.mediaFormat || 'video'}`,
            x: 52,
            y: 32,
            width: Math.max(0, object.width - 64),
            height: 20,
            fontSize: 11,
            fontFamily: 'Arial, sans-serif',
            fill: '#334155',
            align: 'start',
            maxLines: 1,
          })}
        </g>
      `;
    }
    default:
      return '';
  }
}

function buildSvgExportMarkup(options: {
  objects: CanvasObject[];
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}): string {
  const { objects, width, height, offsetX, offsetY, scale } = options;
  const sortedObjects = [...objects].sort((left, right) => left.zIndex - right.zIndex);
  const viewportTransform = `translate(${formatSvgNumber(offsetX)} ${formatSvgNumber(offsetY)}) scale(${formatSvgNumber(scale)})`;
  const renderedObjects = sortedObjects.map((object) => renderObjectSvg(object)).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${formatSvgNumber(width)}" height="${formatSvgNumber(height)}" viewBox="0 0 ${formatSvgNumber(width)} ${formatSvgNumber(height)}" preserveAspectRatio="none">
  <defs>
    <linearGradient id="${SVG_BACKGROUND_GRADIENT_ID}" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#f8fafc" />
      <stop offset="100%" stop-color="#eef2ff" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${formatSvgNumber(width)}" height="${formatSvgNumber(height)}" fill="url(#${SVG_BACKGROUND_GRADIENT_ID})" />
  <g transform="${viewportTransform}">
${renderedObjects}
  </g>
</svg>`;
}

function buildMatterBodyFromObject(
  object: CanvasObject,
  physics: RoomPhysicsState,
  pinned: boolean
): Matter.Body {
  const common = {
    restitution: physics.restitution,
    frictionAir: physics.frictionAir,
    friction: 0.1,
    isStatic: pinned,
    angle: object.rotation,
  };

  if (object.type === 'circle') {
    const radius = Math.max(8, object.width / 2);
    return Matter.Bodies.circle(object.x + radius, object.y + radius, radius, common);
  }

  return Matter.Bodies.rectangle(
    object.x + object.width / 2,
    object.y + object.height / 2,
    Math.max(16, object.width),
    Math.max(16, object.height),
    common
  );
}

interface CanvasProps {
  participantCount: number;
  loadingPhase?: 'connecting' | 'hydrating' | 'syncing' | null;
  loadingCopy?: { title: string; sub: string } | null;
  onObjectDeleted?: () => void;
  onNotify?: (message: string) => void;
  sessionToken?: string;
  sessionId?: string;
}

/**
 * Toolbar order is intentionally stable so power users can build muscle memory
 * around icon positions in addition to keyboard shortcuts.
 */
const SHAPE_MENU_ITEMS: Array<{ option: ShapeMenuOption; createAs: Exclude<CreationTool, 'text'>; label: string; icon: string; isSquare?: boolean }> = [
  { option: 'rectangle', createAs: 'rectangle', label: 'Rectangle', icon: '▭' },
  { option: 'square', createAs: 'rectangle', label: 'Square', icon: '□', isSquare: true },
  { option: 'circle', createAs: 'circle', label: 'Circle', icon: '◯' },
  { option: 'triangle', createAs: 'triangle', label: 'Triangle', icon: '△' },
];

const TOOLBAR_ITEMS: Array<{ type: Extract<CanvasObjectType, 'text' | 'sticky-note'>; label: string; hotkey: string; icon: string }> = [
  { type: 'text', label: 'Text', hotkey: 'T', icon: 'T' },
  { type: 'sticky-note', label: 'Sticky Note', hotkey: 'S', icon: 'SN' },
];

/**
 * Canvas is the collaboration surface where local optimistic edits are merged
 * with server-broadcast updates.
 *
 * Design invariants:
 * - Store coordinates are world-space values, while Konva pointer events begin in
 *   browser/client coordinates; conversion happens at interaction boundaries.
 * - Local operations emit an operationId so socket echoes can be recognized and
 *   deduplicated without suppressing remote participant updates.
 * - Pan/zoom input is batched with requestAnimationFrame to cap state writes and
 *   avoid flooding React/Konva with per-event updates under high input rates.
 */
export const Canvas: React.FC<CanvasProps> = ({
  participantCount,
  loadingPhase = null,
  loadingCopy = null,
  onObjectDeleted,
  onNotify,
  sessionToken,
  sessionId,
}) => {
  const stageRef = useRef<Konva.Stage>(null);
  const imageUploadInputRef = useRef<HTMLInputElement>(null);
  const audioUploadInputRef = useRef<HTMLInputElement>(null);
  const videoUploadInputRef = useRef<HTMLInputElement>(null);
  const [stageSize, setStageSize] = useState({ width: 1024, height: 768 });
  const [activeTool, setActiveTool] = useState<CreationTool | null>(null);
  const [selectedShapeOption, setSelectedShapeOption] = useState<ShapeMenuOption>('rectangle');
  const [isShapeMenuOpen, setIsShapeMenuOpen] = useState(false);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [editingTextObjectId, setEditingTextObjectId] = useState<string | null>(null);
  const [editingTextValue, setEditingTextValue] = useState('');
  const [uploadInProgress, setUploadInProgress] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLabel, setUploadLabel] = useState<string | null>(null);
  const [failedUpload, setFailedUpload] = useState<{ files: File[]; mediaType: MediaUploadType; message: string } | null>(null);
  const [socketConnected, setSocketConnected] = useState(socket.connected);
  const [browserOnline, setBrowserOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [queuedOperationCount, setQueuedOperationCount] = useState(0);
  const [isReplayingQueue, setIsReplayingQueue] = useState(false);
  const [isReplayPanelOpen, setIsReplayPanelOpen] = useState(false);
  const [isReplayMode, setIsReplayMode] = useState(false);
  const [isReplayLoading, setIsReplayLoading] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [replayEvents, setReplayEvents] = useState<RoomEvent[]>([]);
  const [isReplayPlaying, setIsReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [fieldMode, setFieldMode] = useState<FieldMode>(null);
  const [isPhysicsControlsExpanded, setIsPhysicsControlsExpanded] = useState(false);
  const shapeMenuRef = useRef<HTMLDivElement>(null);
  const textEditorRef = useRef<HTMLTextAreaElement>(null);
  
  // Viewport state: pan and zoom transforms
  const { offsetX, offsetY, scale, panBy, zoomBy, setPan } = useViewportStore((s) => ({
    offsetX: s.offsetX,
    offsetY: s.offsetY,
    scale: s.scale,
    panBy: s.panBy,
    zoomBy: s.zoomBy,
    setPan: s.setPan,
  }));

  // Canvas objects: local CRUD state
  const { objects, addObject, addMediaObject, updateObject, deleteObject } = useCanvasObjectsStore((s) => ({
    objects: s.objects,
    addObject: s.addObject,
    addMediaObject: s.addMediaObject,
    updateObject: s.updateObject,
    deleteObject: s.deleteObject,
  }));
  const { room } = useRoomStore((s) => ({ room: s.room }));
  const participants = useRoomStore((s) => s.participants);
  const roomPhysics = usePhysicsStore((s) => s.roomPhysics);
  const setRoomPhysics = usePhysicsStore((s) => s.setRoomPhysics);
  const replayState = useReplayStore((s) => s.currentState);
  const replayEventCount = useReplayStore((s) => s.eventCount);
  const initializeReplay = useReplayStore((s) => s.initialize);
  const replayStepForward = useReplayStore((s) => s.stepForward);
  const replayStepBackward = useReplayStore((s) => s.stepBackward);
  const replaySeek = useReplayStore((s) => s.seek);
  const replayReset = useReplayStore((s) => s.reset);

  // Tracks optimistic operations until their server echo returns.
  // This prevents duplicate application of local writes while preserving all
  // remote participant updates.
  const pendingOperations = useRef<Set<string>>(new Set());
  const pendingOperationResolvers = useRef<Map<string, (result: OperationResult) => void>>(new Map());
  const panRafRef = useRef<number | null>(null);
  const pendingPanRef = useRef({ dx: 0, dy: 0 });
  const zoomRafRef = useRef<number | null>(null);
  const pendingZoomRef = useRef<{ deltaY: number; mouseX: number; mouseY: number } | null>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const runnerRef = useRef<Matter.Runner | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const bodyMapRef = useRef<Map<string, Matter.Body>>(new Map());
  const boundsRef = useRef<{ floorY: number; leftX: number; rightX: number } | null>(null);
  const resetSnapshotRef = useRef<Map<string, { x: number; y: number; rotation: number }>>(new Map());
  const lastSyncTsRef = useRef(0);
  const dragMomentumRef = useRef<Map<string, DragMomentumState>>(new Map());
  const fieldActionRef = useRef<{ active: boolean; mode: Exclude<FieldMode, null>; worldX: number; worldY: number } | null>(null);
  const roomPhysicsRef = useRef(roomPhysics);
  const pinnedSetRef = useRef<Set<string>>(new Set());
  const presenceSyncRef = useRef<{ lastSentAt: number; timer: number | null }>({
    lastSentAt: 0,
    timer: null,
  });
  const isReplayingQueueRef = useRef(false);
  const queueReplayTimerRef = useRef<number | null>(null);
  const offlineQueue = useMemo(() => getOfflineOperationsQueue(), []);



  const canSendRealtimeOperation = Boolean(room && socketConnected && browserOnline);
  const replayCurrentPosition = replayState.appliedEventCount;
  const replayProgress = replayEventCount > 0 ? replayCurrentPosition / replayEventCount : 0;
  const replayCurrentEvent = replayCurrentPosition > 0 ? replayEvents[replayCurrentPosition - 1] ?? null : null;
  const displayedObjects = useMemo<CanvasObject[]>(() => {
    if (!isReplayMode) return objects;

    return replayState.objects.map((object) => ({
      ...object,
      rotation: typeof object.rotation === 'number' ? object.rotation : 0,
      zIndex: typeof object.zIndex === 'number' ? object.zIndex : 0,
      color: typeof object.color === 'string' && object.color.length > 0
        ? object.color
        : DEFAULT_COLOR_BY_TYPE[object.type] ?? '#3498db',
    }));
  }, [isReplayMode, objects, replayState.objects]);

  const isPhysicsAuthority = useMemo(() => {
    if (!room?.createdBySessionId || !sessionId) return false;
    return room.createdBySessionId === sessionId;
  }, [room?.createdBySessionId, sessionId]);

  const isFieldActionEnabled = Boolean(
    roomPhysics.enabled &&
    roomPhysics.simulationRunning &&
    isPhysicsAuthority &&
    !isReplayMode &&
    fieldMode
  );

  const loadReplayEvents = useCallback(async (): Promise<RoomEvent[]> => {
    if (!room) return [];

    const response = await new Promise<RoomEventsListResponsePayload>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('Timed out loading room events'));
      }, 12000);

      socket.emit('room:events:list', { roomId: room.id }, (payload: RoomEventsListResponsePayload) => {
        window.clearTimeout(timeout);
        resolve(payload);
      });
    });

    if (response.code) {
      throw new Error(response.message || response.code);
    }

    return response.events ?? [];
  }, [room]);

  const enterReplayMode = useCallback(async () => {
    if (!room || isReplayLoading) return;

    setIsReplayPanelOpen(true);
    setIsReplayLoading(true);
    setReplayError(null);

    try {
      const events = await loadReplayEvents();
      setReplayEvents(events);
      initializeReplay(events);
      replayReset();
      setIsReplayMode(true);
      setIsReplayPlaying(false);
      setSelectedObjectId(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load replay events';
      setReplayError(message);
      setIsReplayMode(false);
    } finally {
      setIsReplayLoading(false);
    }
  }, [initializeReplay, isReplayLoading, loadReplayEvents, replayReset, room]);

  const exitReplayMode = useCallback(() => {
    setIsReplayMode(false);
    setIsReplayPlaying(false);
    setReplayError(null);
    setSelectedObjectId(null);
  }, []);

  const handleReplayStepForward = useCallback(() => {
    if (!isReplayMode) return;
    replayStepForward();
  }, [isReplayMode, replayStepForward]);

  const handleReplayStepBackward = useCallback(() => {
    if (!isReplayMode) return;
    replayStepBackward();
  }, [isReplayMode, replayStepBackward]);

  const handleReplayRestart = useCallback(() => {
    if (!isReplayMode) return;
    replayReset();
    setIsReplayPlaying(false);
  }, [isReplayMode, replayReset]);

  const handleReplaySeek = useCallback((position: number) => {
    if (!isReplayMode) return;
    replaySeek(position);
  }, [isReplayMode, replaySeek]);

  const handleReplayPanelToggle = useCallback(async () => {
    if (!isReplayPanelOpen) {
      await enterReplayMode();
      return;
    }

    setIsReplayPanelOpen(false);
    exitReplayMode();
  }, [enterReplayMode, exitReplayMode, isReplayPanelOpen]);

  useEffect(() => {
    if (!isReplayMode || !isReplayPlaying) return;
    if (replayCurrentPosition >= replayEventCount) {
      setIsReplayPlaying(false);
      return;
    }

    const intervalMs = Math.max(16, Math.round(REPLAY_BASE_STEP_INTERVAL_MS / replaySpeed));
    const timer = window.setInterval(() => {
      const state = useReplayStore.getState();
      if (state.currentState.appliedEventCount >= state.eventCount) {
        window.clearInterval(timer);
        setIsReplayPlaying(false);
        return;
      }
      state.stepForward();
    }, intervalMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [isReplayMode, isReplayPlaying, replayCurrentPosition, replayEventCount, replaySpeed]);

  useEffect(() => {
    setIsReplayPlaying(false);
    setIsReplayMode(false);
    setIsReplayPanelOpen(false);
    setReplayEvents([]);
    setReplayError(null);
    setFieldMode(null);
    fieldActionRef.current = null;
    setIsPhysicsControlsExpanded(false);
    setActiveTool(null);
    setIsShapeMenuOpen(false);
    setEditingTextObjectId(null);
    setEditingTextValue('');
  }, [room?.id]);

  useEffect(() => {
    if (!roomPhysics.enabled || !roomPhysics.simulationRunning) {
      setIsPhysicsControlsExpanded(false);
    }
  }, [roomPhysics.enabled, roomPhysics.simulationRunning]);

  useEffect(() => {
    if (!isReplayMode) return;
    setEditingTextObjectId(null);
    setActiveTool(null);
    setIsShapeMenuOpen(false);
  }, [isReplayMode]);

  const pinnedSet = useMemo(() => new Set(roomPhysics.staticObjectIds), [roomPhysics.staticObjectIds]);
  const physicsStructureSignature = useMemo(() => {
    return objects
      .filter((object) => isPhysicsObjectType(object.type))
      .map((object) => `${object.id}:${object.type}:${Math.round(object.width)}:${Math.round(object.height)}`)
      .sort()
      .join('|');
  }, [objects]);
  const physicsPinnedSignature = useMemo(() => roomPhysics.staticObjectIds.slice().sort().join('|'), [roomPhysics.staticObjectIds]);

  useEffect(() => {
    roomPhysicsRef.current = roomPhysics;
    if (!roomPhysics.enabled || !roomPhysics.simulationRunning) {
      fieldActionRef.current = null;
    }
  }, [roomPhysics]);

  useEffect(() => {
    pinnedSetRef.current = pinnedSet;
  }, [pinnedSet]);

  /**
   * Generates a per-operation correlation id used for optimistic echo handling.
   * No global ordering guarantee is assumed from this id.
   */
  const generateOperationId = useCallback(() => {
    return `op_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }, []);

  const refreshQueueCount = useCallback(() => {
    if (!room) {
      setQueuedOperationCount(0);
      return;
    }

    setQueuedOperationCount(offlineQueue.size(room.id, sessionId));
  }, [offlineQueue, room, sessionId]);

  const waitForOperationAck = useCallback((operationId: string, timeoutMs: number): Promise<OperationResult> => {
    return new Promise((resolve) => {
      const timeoutId = window.setTimeout(() => {
        pendingOperationResolvers.current.delete(operationId);
        resolve('timeout');
      }, timeoutMs);

      pendingOperationResolvers.current.set(operationId, (result) => {
        window.clearTimeout(timeoutId);
        pendingOperationResolvers.current.delete(operationId);
        resolve(result);
      });
    });
  }, []);

  const emitQueuedOperation = useCallback((entry: OfflineOperation) => {
    pendingOperations.current.add(entry.operationId);

    if (entry.type === 'create') {
      socket.emit('object:create', {
        operationId: entry.operationId,
        roomId: entry.roomId,
        object: entry.object,
      });
      return;
    }

    if (entry.type === 'update') {
      socket.emit('object:update', {
        operationId: entry.operationId,
        roomId: entry.roomId,
        objectId: entry.objectId,
        updates: entry.updates,
      });
      return;
    }

    socket.emit('object:delete', {
      operationId: entry.operationId,
      roomId: entry.roomId,
      objectId: entry.objectId,
    });
  }, []);

  const enqueueCreate = useCallback((object: CanvasObject) => {
    if (!room) return;

    const operationId = generateOperationId();
    offlineQueue.enqueueCreate({
      operationId,
      roomId: room.id,
      sessionId,
      object: object as unknown as Record<string, unknown>,
    });
    refreshQueueCount();
  }, [generateOperationId, offlineQueue, refreshQueueCount, room, sessionId]);

  const enqueueUpdate = useCallback((objectId: string, updates: Record<string, unknown>) => {
    if (!room) return;

    const operationId = generateOperationId();
    offlineQueue.enqueueUpdate({
      operationId,
      roomId: room.id,
      sessionId,
      objectId,
      updates,
    });
    refreshQueueCount();
  }, [generateOperationId, offlineQueue, refreshQueueCount, room, sessionId]);

  const enqueueDelete = useCallback((objectId: string) => {
    if (!room) return;

    const operationId = generateOperationId();
    offlineQueue.enqueueDelete({
      operationId,
      roomId: room.id,
      sessionId,
      objectId,
    });
    refreshQueueCount();
  }, [generateOperationId, offlineQueue, refreshQueueCount, room, sessionId]);

  const emitCreate = useCallback((object: CanvasObject) => {
    if (!room || isReplayMode) return;

    if (!canSendRealtimeOperation) {
      enqueueCreate(object);
      return;
    }

    const operationId = generateOperationId();
    pendingOperations.current.add(operationId);
    socket.emit('object:create', {
      operationId,
      roomId: room.id,
      object,
    });
  }, [canSendRealtimeOperation, enqueueCreate, generateOperationId, isReplayMode, room]);

  const emitUpdate = useCallback((objectId: string, updates: Record<string, unknown>) => {
    if (!room || isReplayMode) return;

    if (!canSendRealtimeOperation) {
      enqueueUpdate(objectId, updates);
      return;
    }

    const operationId = generateOperationId();
    pendingOperations.current.add(operationId);
    socket.emit('object:update', {
      operationId,
      roomId: room.id,
      objectId,
      updates,
    });
  }, [canSendRealtimeOperation, enqueueUpdate, generateOperationId, isReplayMode, room]);

  const emitDelete = useCallback((objectId: string) => {
    if (!room || isReplayMode) return;

    if (!canSendRealtimeOperation) {
      enqueueDelete(objectId);
      return;
    }

    const operationId = generateOperationId();
    pendingOperations.current.add(operationId);
    socket.emit('object:delete', {
      operationId,
      roomId: room.id,
      objectId,
    });
  }, [canSendRealtimeOperation, enqueueDelete, generateOperationId, isReplayMode, room]);

  const emitPhysicsStatePatch = useCallback((patch: Partial<RoomPhysicsState>) => {
    if (!room || isReplayMode) return;
    const operationId = generateOperationId();
    socket.emit('physics:update-state', {
      operationId,
      roomId: room.id,
      patch,
    });
  }, [generateOperationId, isReplayMode, room]);

  const emitPhysicsSetStatic = useCallback((objectId: string, isStatic: boolean) => {
    if (!room || isReplayMode) return;
    const operationId = generateOperationId();
    socket.emit('physics:set-static', {
      operationId,
      roomId: room.id,
      objectId,
      isStatic,
    });
  }, [generateOperationId, isReplayMode, room]);

  const emitPhysicsReset = useCallback(() => {
    if (!room || isReplayMode) return;
    const operationId = generateOperationId();
    socket.emit('physics:reset', {
      operationId,
      roomId: room.id,
    });
  }, [generateOperationId, isReplayMode, room]);

  const finishTextEditing = useCallback(() => {
    setEditingTextObjectId(null);
  }, []);

  const startTextEditing = useCallback((objectId: string) => {
    if (isReplayMode) return;
    const target = useCanvasObjectsStore.getState().getObject(objectId);
    if (!target || target.type !== 'text') return;

    setSelectedObjectId(objectId);
    setEditingTextObjectId(objectId);
    setEditingTextValue(target.text ?? '');
  }, [isReplayMode]);

  const createObjectAtAndSync = useCallback((
    type: CanvasObjectType,
    worldX: number,
    worldY: number,
    options?: { forceSquare?: boolean; beginTextEdit?: boolean }
  ) => {
    if (!room || isReplayMode) return null;

    const id = addObject(type, worldX, worldY);

    const object = useCanvasObjectsStore.getState().getObject(id);
    if (!object) {
      return null;
    }

    if (options?.forceSquare && type === 'rectangle') {
      const squareSize = Math.max(32, Math.min(object.width, object.height));
      updateObject(id, { width: squareSize, height: squareSize });
    }

    const syncedObject = useCanvasObjectsStore.getState().getObject(id);
    if (!syncedObject) {
      return null;
    }

    setSelectedObjectId(id);
    emitCreate(syncedObject);

    if (options?.forceSquare && type === 'rectangle') {
      emitUpdate(id, { width: syncedObject.width, height: syncedObject.height });
    }

    if (options?.beginTextEdit && type === 'text') {
      setEditingTextObjectId(id);
      setEditingTextValue(syncedObject.text ?? '');
    }

    return id;
  }, [addObject, emitCreate, emitUpdate, isReplayMode, room, updateObject]);

  const createObjectAndSync = useCallback((type: CanvasObjectType) => {
    if (!room || isReplayMode) return;

    // Keyboard and legacy quick-create still drop at viewport center.
    const center = canvasCenterToWorld(stageSize, { offsetX, offsetY, scale });
    createObjectAtAndSync(type, center.x, center.y, {
      beginTextEdit: type === 'text',
    });
  }, [createObjectAtAndSync, isReplayMode, offsetX, offsetY, room, scale, stageSize]);

  const selectedShapeConfig = useMemo(() => {
    return SHAPE_MENU_ITEMS.find((item) => item.option === selectedShapeOption) ?? SHAPE_MENU_ITEMS[0];
  }, [selectedShapeOption]);

  const handleShapeToolSelect = useCallback((option: ShapeMenuOption) => {
    const config = SHAPE_MENU_ITEMS.find((item) => item.option === option);
    if (!config) return;

    finishTextEditing();
    setSelectedShapeOption(option);
    setActiveTool(config.createAs);
    setIsShapeMenuOpen(false);
  }, [finishTextEditing]);

  const handleTextToolSelect = useCallback(() => {
    finishTextEditing();
    setActiveTool('text');
    setIsShapeMenuOpen(false);
  }, [finishTextEditing]);

  const createMediaObjectsAndSync = useCallback((uploads: UploadedMedia[]) => {
    if (!room || isReplayMode) return;

    const center = canvasCenterToWorld(stageSize, { offsetX, offsetY, scale });

    const createdIds: string[] = [];

    uploads.forEach((upload, index) => {
      const type = upload.resourceType;
      const id = addMediaObject({
        type,
        x: center.x + index * 28,
        y: center.y + index * 22,
        mediaUrl: upload.secureUrl,
        mediaPublicId: upload.publicId,
        mediaResourceType: upload.resourceType,
        mediaFormat: upload.format,
        mediaWidth: upload.width,
        mediaHeight: upload.height,
        mimeType: upload.mimeType,
        sizeBytes: upload.bytes,
        durationMs: upload.duration,
        mediaCreatedAt: upload.createdAt,
        text: type === 'audio' || type === 'video' ? upload.originalFilename : undefined,
        createdBySessionId: sessionId,
      });

      const object = useCanvasObjectsStore.getState().getObject(id);
      if (!object) return;

      createdIds.push(id);
      emitCreate(object);
    });

    if (createdIds.length > 0) {
      setSelectedObjectId(createdIds[createdIds.length - 1]);
    }
  }, [addMediaObject, emitCreate, isReplayMode, offsetX, offsetY, room, scale, sessionId, stageSize]);

  const runMediaUpload = useCallback(async (mediaType: MediaUploadType, files: File[]) => {
    if (isReplayMode) {
      onNotify?.('Exit replay mode to upload media.');
      return;
    }

    if (!room) {
      onNotify?.('Join a room before uploading media');
      return;
    }

    if (!sessionToken) {
      onNotify?.('Session token missing. Recreate your guest session and try again.');
      return;
    }

    if (uploadInProgress) {
      onNotify?.('Upload already in progress');
      return;
    }

    if (!browserOnline || !socketConnected) {
      onNotify?.('Media uploads require an active online connection.');
      return;
    }

    if (files.length === 0) {
      return;
    }

    setUploadInProgress(true);
    setUploadProgress(0);
    setUploadLabel(`Uploading ${files.length} ${mediaType} file${files.length > 1 ? 's' : ''}...`);
    setFailedUpload(null);

    try {
      const uploads = await uploadMediaFiles({
        files,
        expectedType: mediaType,
        sessionToken,
        onProgress: (progress) => setUploadProgress(progress),
      });

      createMediaObjectsAndSync(uploads);
      onNotify?.(`✓ Uploaded ${uploads.length} ${mediaType} file${uploads.length > 1 ? 's' : ''}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Media upload failed';
      setFailedUpload({ files, mediaType, message });
      onNotify?.(`Upload failed: ${message}`);
    } finally {
      setUploadInProgress(false);
      setUploadLabel(null);
      setUploadProgress(0);
    }
  }, [browserOnline, createMediaObjectsAndSync, isReplayMode, onNotify, room, sessionToken, socketConnected, uploadInProgress]);

  const openUploadPicker = useCallback((mediaType: MediaUploadType) => {
    if (isReplayMode) return;
    if (uploadInProgress) return;
    if (mediaType === 'image') imageUploadInputRef.current?.click();
    if (mediaType === 'audio') audioUploadInputRef.current?.click();
    if (mediaType === 'video') videoUploadInputRef.current?.click();
  }, [isReplayMode, uploadInProgress]);

  const handlePickerChanged = useCallback(async (mediaType: MediaUploadType, files: FileList | null) => {
    const nextFiles = files ? Array.from(files) : [];
    await runMediaUpload(mediaType, nextFiles);

    if (mediaType === 'image' && imageUploadInputRef.current) imageUploadInputRef.current.value = '';
    if (mediaType === 'audio' && audioUploadInputRef.current) audioUploadInputRef.current.value = '';
    if (mediaType === 'video' && videoUploadInputRef.current) videoUploadInputRef.current.value = '';
  }, [runMediaUpload]);

  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, []);

  const handleExportPng = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const dataUrl = stage.toDataURL({ pixelRatio: 2 });
    const anchor = document.createElement('a');
    anchor.href = dataUrl;
    anchor.download = `canvas-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    onNotify?.('✓ PNG exported');
  }, [onNotify]);

  const handleExportSvg = useCallback(() => {
    const svgMarkup = buildSvgExportMarkup({
      objects,
      width: stageSize.width,
      height: stageSize.height,
      offsetX,
      offsetY,
      scale,
    });
    const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    downloadBlob(blob, `canvas-${new Date().toISOString().replace(/[:.]/g, '-')}.svg`);
    onNotify?.('✓ SVG exported');
  }, [downloadBlob, objects, offsetX, offsetY, onNotify, scale, stageSize.height, stageSize.width]);

  const handleExportJson = useCallback(() => {
    const payload = {
      roomId: room?.id ?? null,
      exportedAt: new Date().toISOString(),
      objects: objects.map((obj) => {
        // Normalize invalid/placeholder media dimensions to null so exported JSON
        // mirrors persisted semantics used by downstream validation tooling.
        const normalizedMediaWidth = typeof obj.mediaWidth === 'number' && obj.mediaWidth > 0 ? obj.mediaWidth : null;
        const normalizedMediaHeight = typeof obj.mediaHeight === 'number' && obj.mediaHeight > 0 ? obj.mediaHeight : null;

        return {
          id: obj.id,
          type: obj.type,
          x: obj.x,
          y: obj.y,
          width: obj.width,
          height: obj.height,
          zIndex: obj.zIndex,
          rotation: obj.rotation,
          color: obj.color,
          text: obj.text,
          fontSize: obj.fontSize,
          createdBySessionId: obj.createdBySessionId ?? null,
          createdAt: obj.createdAt ?? null,
          updatedAt: obj.updatedAt ?? null,
          mediaUrl: obj.mediaUrl ?? null,
          mediaPublicId: obj.mediaPublicId ?? null,
          mediaResourceType: obj.mediaResourceType ?? null,
          mediaFormat: obj.mediaFormat ?? null,
          mimeType: obj.mimeType ?? null,
          sizeBytes: obj.sizeBytes ?? null,
          mediaWidth: normalizedMediaWidth,
          mediaHeight: normalizedMediaHeight,
          durationMs: obj.durationMs ?? null,
          mediaCreatedAt: obj.mediaCreatedAt ?? null,
          ownership: {
            createdBySessionId: obj.createdBySessionId ?? null,
          },
          timestamps: {
            createdAt: obj.createdAt ?? null,
            updatedAt: obj.updatedAt ?? null,
            mediaCreatedAt: obj.mediaCreatedAt ?? null,
          },
          media: obj.mediaUrl
            ? {
                publicId: obj.mediaPublicId ?? null,
                secureUrl: obj.mediaUrl,
                resourceType: obj.mediaResourceType ?? null,
                width: normalizedMediaWidth,
                height: normalizedMediaHeight,
                duration: obj.durationMs ?? null,
                format: obj.mediaFormat ?? null,
                bytes: obj.sizeBytes ?? null,
                mimeType: obj.mimeType ?? null,
              }
            : null,
        };
      }),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `canvas-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    onNotify?.('✓ JSON exported');
  }, [downloadBlob, objects, onNotify, room?.id]);

  const deleteObjectAndSync = useCallback((objectId: string) => {
    if (isReplayMode) return;
    deleteObject(objectId);
    if (selectedObjectId === objectId) {
      setSelectedObjectId(null);
    }
    if (editingTextObjectId === objectId) {
      setEditingTextObjectId(null);
      setEditingTextValue('');
    }
    emitDelete(objectId);
    onObjectDeleted?.();
  }, [deleteObject, editingTextObjectId, emitDelete, isReplayMode, onObjectDeleted, selectedObjectId]);

  const moveObjectAndSync = useCallback((objectId: string, x: number, y: number) => {
    if (isReplayMode) return;
    const existing = useCanvasObjectsStore.getState().getObject(objectId);
    if (!existing) return;

    if (roomPhysics.enabled && isPhysicsObjectType(existing.type)) {
      if (pinnedSetRef.current.has(objectId)) {
        dragMomentumRef.current.delete(objectId);
        return;
      }

      const moved = Math.abs(existing.x - x) >= 0.25 || Math.abs(existing.y - y) >= 0.25;
      const body = bodyMapRef.current.get(objectId);
      if (body) {
        Matter.Body.setPosition(body, {
          x: x + existing.width / 2,
          y: y + existing.height / 2,
        });
      }

      const momentumState = dragMomentumRef.current.get(objectId);
      const releaseVelocity = momentumState ? computeReleaseVelocity(momentumState.samples) : null;
      if (body) {
        if (releaseVelocity) {
          Matter.Body.setVelocity(body, releaseVelocity);
        } else {
          Matter.Body.setVelocity(body, { x: 0, y: 0 });
        }
      }

      dragMomentumRef.current.delete(objectId);
      updateObject(objectId, { x, y });

      if (releaseVelocity) {
        emitUpdate(objectId, {
          x,
          y,
          physicsVelocityX: releaseVelocity.x,
          physicsVelocityY: releaseVelocity.y,
        });
        return;
      }

      if (!isPhysicsAuthority && moved) {
        emitUpdate(objectId, { x, y });
      }

      return;
    }

    // No-op suppression reduces avoidable socket traffic and DB writes during
    // drag paths that report duplicate positions.
    if (existing.x === x && existing.y === y) return;

    updateObject(objectId, { x, y });
    emitUpdate(objectId, { x, y });
  }, [emitUpdate, isPhysicsAuthority, isReplayMode, roomPhysics.enabled, updateObject]);

  const resizeObjectAndSync = useCallback((objectId: string, width: number, height: number) => {
    if (isReplayMode) return;
    const existing = useCanvasObjectsStore.getState().getObject(objectId);
    if (!existing) return;

    // No-op suppression mirrors move semantics for resize updates.
    if (existing.width === width && existing.height === height) return;

    updateObject(objectId, { width, height });
    emitUpdate(objectId, { width, height });
  }, [emitUpdate, isReplayMode, updateObject]);

  const handleObjectDragStart = useCallback((objectId: string) => {
    const existing = useCanvasObjectsStore.getState().getObject(objectId);
    if (!existing) return;

    const now = performance.now();
    dragMomentumRef.current.set(objectId, {
      samples: [{ x: existing.x, y: existing.y, at: now }],
    });

    if (!roomPhysics.enabled || !isPhysicsObjectType(existing.type)) return;
    if (pinnedSetRef.current.has(objectId)) return;

    const body = bodyMapRef.current.get(objectId);
    if (!body) return;
    Matter.Body.setStatic(body, false);
    Matter.Body.setVelocity(body, { x: 0, y: 0 });
  }, [roomPhysics.enabled]);

  const handleObjectDragMove = useCallback((objectId: string, x: number, y: number) => {
    const existing = useCanvasObjectsStore.getState().getObject(objectId);
    if (!existing) return;

    const now = performance.now();
    const previous = dragMomentumRef.current.get(objectId);
    if (previous) {
      dragMomentumRef.current.set(objectId, {
        samples: appendDragSample(previous.samples, { x, y, at: now }),
      });
    } else {
      dragMomentumRef.current.set(objectId, {
        samples: [{ x, y, at: now }],
      });
    }

    if (!roomPhysics.enabled || !isPhysicsObjectType(existing.type)) return;
    if (pinnedSetRef.current.has(objectId)) return;

    const body = bodyMapRef.current.get(objectId);
    if (!body) return;

    Matter.Body.setPosition(body, {
      x: x + existing.width / 2,
      y: y + existing.height / 2,
    });
  }, [roomPhysics.enabled]);

  const resetPhysicsSnapshotFromCurrentObjects = useCallback(() => {
    const next = new Map<string, { x: number; y: number; rotation: number }>();
    const currentObjects = useCanvasObjectsStore.getState().objects;
    currentObjects.forEach((object) => {
      if (!isPhysicsObjectType(object.type)) return;
      next.set(object.id, {
        x: object.x,
        y: object.y,
        rotation: object.rotation,
      });
    });
    resetSnapshotRef.current = next;
  }, []);

  const ensureMatterRuntime = useCallback(() => {
    if (engineRef.current && runnerRef.current) {
      return;
    }

    const engine = Matter.Engine.create();
    engine.positionIterations = 10;
    engine.velocityIterations = 8;
    engine.gravity.scale = 0.01;
    engine.gravity.x = 0;
    engine.gravity.y = roomPhysics.gravityY;
    runnerRef.current = Matter.Runner.create();
    engineRef.current = engine;
  }, [roomPhysics.gravityY]);

  const clearMatterRuntime = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (runnerRef.current && engineRef.current) {
      Matter.Runner.stop(runnerRef.current);
      Matter.World.clear(engineRef.current.world, false);
      Matter.Engine.clear(engineRef.current);
    }

    bodyMapRef.current.clear();
    boundsRef.current = null;
    engineRef.current = null;
    runnerRef.current = null;
  }, []);

  const rebuildBodiesFromObjects = useCallback(() => {
    ensureMatterRuntime();
    const engine = engineRef.current;
    if (!engine) return;

    const currentPhysics = roomPhysicsRef.current;
    const currentPinnedSet = pinnedSetRef.current;
    const currentObjects = useCanvasObjectsStore.getState().objects;

    Matter.World.clear(engine.world, false);
    bodyMapRef.current.clear();

    const nextBodies: Matter.Body[] = [];
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    currentObjects.forEach((object) => {
      if (!isPhysicsObjectType(object.type)) return;

      const body = buildMatterBodyFromObject(object, currentPhysics, currentPinnedSet.has(object.id));
      body.label = object.id;
      bodyMapRef.current.set(object.id, body);
      nextBodies.push(body);

      minX = Math.min(minX, object.x);
      minY = Math.min(minY, object.y);
      maxX = Math.max(maxX, object.x + object.width);
      maxY = Math.max(maxY, object.y + object.height);
    });

    if (nextBodies.length > 0) {
      // Keep the arena comfortably larger than object bounds so collisions are
      // observable and stable instead of happening at near-zero drop distance.
      const wallThickness = 200;
      const horizontalPadding = 600;
      const floorGap = 420;
      const sideGap = 260;

      const centerX = (minX + maxX) / 2;
      const spanWidth = Math.max(2200, maxX - minX + horizontalPadding * 2);
      const spanHeight = Math.max(2600, maxY - minY + floorGap + sideGap);
      const floorCenterY = maxY + floorGap + wallThickness / 2;
      const sideCenterY = maxY + floorGap / 2;
      const leftWallX = minX - sideGap;
      const rightWallX = maxX + sideGap;

      boundsRef.current = {
        floorY: floorCenterY - wallThickness / 2,
        leftX: leftWallX + wallThickness / 2,
        rightX: rightWallX - wallThickness / 2,
      };

      nextBodies.push(
        Matter.Bodies.rectangle(centerX, floorCenterY, spanWidth, wallThickness, { isStatic: true }),
        Matter.Bodies.rectangle(leftWallX, sideCenterY, wallThickness, spanHeight, { isStatic: true }),
        Matter.Bodies.rectangle(rightWallX, sideCenterY, wallThickness, spanHeight, { isStatic: true })
      );
    } else {
      boundsRef.current = null;
    }

    Matter.World.add(engine.world, nextBodies);
    engine.gravity.y = currentPhysics.gravityY;
  }, [ensureMatterRuntime]);

  const syncObjectFromBody = useCallback((objectId: string, body: Matter.Body) => {
    const existing = useCanvasObjectsStore.getState().getObject(objectId);
    if (!existing) return;

    const nextX = body.position.x - existing.width / 2;
    const nextY = body.position.y - existing.height / 2;
    const nextRotation = body.angle;

    if (
      Math.abs(existing.x - nextX) < 0.25 &&
      Math.abs(existing.y - nextY) < 0.25 &&
      Math.abs(existing.rotation - nextRotation) < 0.01
    ) {
      return;
    }

    updateObject(objectId, {
      x: nextX,
      y: nextY,
      rotation: nextRotation,
    });
  }, [updateObject]);

  const applyPhysicsReset = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;

    for (const [objectId, body] of bodyMapRef.current.entries()) {
      const snapshot = resetSnapshotRef.current.get(objectId);
      const existing = useCanvasObjectsStore.getState().getObject(objectId);
      if (!snapshot || !existing) continue;

      const centerX = snapshot.x + existing.width / 2;
      const centerY = snapshot.y + existing.height / 2;

      Matter.Body.setVelocity(body, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(body, 0);
      Matter.Body.setPosition(body, { x: centerX, y: centerY });
      Matter.Body.setAngle(body, snapshot.rotation);

      updateObject(objectId, {
        x: snapshot.x,
        y: snapshot.y,
        rotation: snapshot.rotation,
      });

      if (isPhysicsAuthority) {
        emitUpdate(objectId, {
          x: snapshot.x,
          y: snapshot.y,
          rotation: snapshot.rotation,
        });
      }
    }
  }, [emitUpdate, isPhysicsAuthority, updateObject]);

  useEffect(() => {
    if (!room || !roomPhysics.enabled) {
      clearMatterRuntime();
      return;
    }

    ensureMatterRuntime();
    rebuildBodiesFromObjects();

    if (resetSnapshotRef.current.size === 0) {
      resetPhysicsSnapshotFromCurrentObjects();
    }

    return () => {
      if (!room) {
        clearMatterRuntime();
      }
    };
  }, [
    room,
    roomPhysics.enabled,
    physicsStructureSignature,
    physicsPinnedSignature,
    clearMatterRuntime,
    ensureMatterRuntime,
    rebuildBodiesFromObjects,
    resetPhysicsSnapshotFromCurrentObjects,
  ]);

  useEffect(() => {
    if (!roomPhysics.enabled) return;

    for (const body of bodyMapRef.current.values()) {
      body.restitution = roomPhysics.restitution;
      body.frictionAir = roomPhysics.frictionAir;
      body.friction = 0.1;
    }
  }, [roomPhysics.enabled, roomPhysics.frictionAir, roomPhysics.restitution]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.gravity.x = 0;
    engine.gravity.y = roomPhysics.gravityY;
  }, [roomPhysics.gravityY]);

  useEffect(() => {
    if (!roomPhysics.enabled) return;
    applyPhysicsReset();
  }, [applyPhysicsReset, roomPhysics.enabled, roomPhysics.resetNonce]);

  useEffect(() => {
    if (!roomPhysics.enabled || !roomPhysics.simulationRunning || !isPhysicsAuthority) {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    ensureMatterRuntime();
    const engine = engineRef.current;
    if (!engine) return;

    const tick = () => {
      const activeField = fieldActionRef.current;
      if (activeField?.active && roomPhysicsRef.current.enabled && roomPhysicsRef.current.simulationRunning) {
        for (const [objectId, body] of bodyMapRef.current.entries()) {
          if (pinnedSetRef.current.has(objectId) || body.isStatic) continue;

          const dx = activeField.worldX - body.position.x;
          const dy = activeField.worldY - body.position.y;
          const distance = Math.hypot(dx, dy);
          if (distance <= 0 || distance > PHYSICS_FIELD_RADIUS_PX) continue;

          const falloff = 1 - distance / PHYSICS_FIELD_RADIUS_PX;
          const clampedDistance = Math.max(PHYSICS_FIELD_MIN_DISTANCE_PX, distance);
          const directionScale = activeField.mode === 'attract' ? 1 : -1;
          const forceMagnitude = Math.min(
            PHYSICS_FIELD_MAX_FORCE,
            ((PHYSICS_FIELD_MAX_FORCE * falloff * falloff) / clampedDistance) * PHYSICS_FIELD_RADIUS_PX
          );

          Matter.Body.applyForce(body, body.position, {
            x: (dx / clampedDistance) * forceMagnitude * directionScale,
            y: (dy / clampedDistance) * forceMagnitude * directionScale,
          });
        }
      }

      Matter.Engine.update(engine, 1000 / 60);

      const updates: Array<{ objectId: string; x: number; y: number; rotation: number }> = [];

      for (const [objectId, body] of bodyMapRef.current.entries()) {
        const existing = useCanvasObjectsStore.getState().getObject(objectId);
        if (!existing) continue;

        const x = body.position.x - existing.width / 2;
        const y = body.position.y - existing.height / 2;
        const rotation = body.angle;

        const moved =
          Math.abs(existing.x - x) >= 0.25 ||
          Math.abs(existing.y - y) >= 0.25 ||
          Math.abs(existing.rotation - rotation) >= 0.01;

        syncObjectFromBody(objectId, body);
        if (moved) {
          updates.push({ objectId, x, y, rotation });
        }
      }

      const now = performance.now();
      if (room && now - lastSyncTsRef.current >= PHYSICS_SYNC_INTERVAL_MS) {
        for (const update of updates) {
          emitUpdate(update.objectId, {
            x: update.x,
            y: update.y,
            rotation: update.rotation,
          });
        }
        lastSyncTsRef.current = now;
      }

      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [
    emitUpdate,
    ensureMatterRuntime,
    isPhysicsAuthority,
    room,
    roomPhysics.enabled,
    roomPhysics.simulationRunning,
    syncObjectFromBody,
  ]);

  useEffect(() => {
    if (!isShapeMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (shapeMenuRef.current?.contains(target)) return;
      setIsShapeMenuOpen(false);
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isShapeMenuOpen]);

  useEffect(() => {
    if (!editingTextObjectId) return;
    const nextFrame = window.requestAnimationFrame(() => {
      textEditorRef.current?.focus();
      textEditorRef.current?.select();
    });
    return () => {
      window.cancelAnimationFrame(nextFrame);
    };
  }, [editingTextObjectId]);

  // Track mouse state for panning
  const isPanning = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });

  const updateFieldActionPointer = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (!stage || !fieldMode || !isFieldActionEnabled) return;

    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const worldX = (pointer.x - offsetX) / scale;
    const worldY = (pointer.y - offsetY) / scale;

    fieldActionRef.current = {
      active: true,
      mode: fieldMode,
      worldX,
      worldY,
    };
  }, [fieldMode, isFieldActionEnabled, offsetX, offsetY, scale]);

  // Keyboard shortcuts for object creation
  useEffect(() => {
    if (!room || isReplayMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement as HTMLElement | null;
      if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
        return;
      }

      // Use keyboard shortcuts: R=Rectangle tool, C=Circle tool, T=Text tool, S=Sticky Note.
      switch (e.key.toLowerCase()) {
        case 'r': {
          e.preventDefault();
          finishTextEditing();
          setSelectedShapeOption('rectangle');
          setActiveTool('rectangle');
          break;
        }
        case 'c': {
          e.preventDefault();
          finishTextEditing();
          setSelectedShapeOption('circle');
          setActiveTool('circle');
          break;
        }
        case 't': {
          e.preventDefault();
          finishTextEditing();
          setActiveTool('text');
          break;
        }
        case 's': {
          e.preventDefault();
          finishTextEditing();
          createObjectAndSync('sticky-note');
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [createObjectAndSync, finishTextEditing, isReplayMode, room]);

  // Subscriptions are attached only while in-room so handlers cannot leak across
  // room transitions.
  useEffect(() => {
    if (!room) return;

    // Listen for object creation from other clients
    const handleObjectCreated = (payload: ObjectCreatedPayload) => {
      const { operationId, object } = payload;

      // Skip if this is our own operation (echo)
      if (pendingOperations.current.has(operationId)) {
        pendingOperations.current.delete(operationId);
        pendingOperationResolvers.current.get(operationId)?.('ack');
        // Reconcile optimistic local object with server-canonical fields
        // (timestamps/media normalization) so export matches persisted state.
        updateObject(object.id, object);
        return;
      }

      // Functional add avoids stale snapshot races during bursty create broadcasts.
      useCanvasObjectsStore.getState().addObjectFromSync(object);
    };

    // Listen for object updates from other clients
    const handleObjectUpdated = (payload: ObjectUpdatedPayload) => {
      const { operationId, objectId, updates } = payload;

      // Skip if this is our own operation (echo)
      if (pendingOperations.current.has(operationId)) {
        pendingOperations.current.delete(operationId);
        pendingOperationResolvers.current.get(operationId)?.('ack');
        return;
      }

      updateObject(objectId, updates);

      const current = useCanvasObjectsStore.getState().getObject(objectId);
      const body = bodyMapRef.current.get(objectId);
      if (!current || !body || !isPhysicsObjectType(current.type)) return;

      const nextX = typeof updates.x === 'number' ? updates.x : current.x;
      const nextY = typeof updates.y === 'number' ? updates.y : current.y;
      const nextRotation = typeof updates.rotation === 'number' ? updates.rotation : current.rotation;
      const nextVelocityX = typeof updates.physicsVelocityX === 'number' ? updates.physicsVelocityX : null;
      const nextVelocityY = typeof updates.physicsVelocityY === 'number' ? updates.physicsVelocityY : null;
      Matter.Body.setPosition(body, {
        x: nextX + current.width / 2,
        y: nextY + current.height / 2,
      });
      Matter.Body.setAngle(body, nextRotation);

      if (nextVelocityX !== null && nextVelocityY !== null && !pinnedSetRef.current.has(objectId)) {
        Matter.Body.setStatic(body, false);
        Matter.Body.setVelocity(body, { x: nextVelocityX, y: nextVelocityY });
      }
    };

    // Listen for object deletion from other clients
    const handleObjectDeleted = (payload: ObjectDeletedPayload) => {
      const { operationId, objectId } = payload;

      // Skip if this is our own operation (echo)
      if (pendingOperations.current.has(operationId)) {
        pendingOperations.current.delete(operationId);
        pendingOperationResolvers.current.get(operationId)?.('ack');
        return;
      }

      deleteObject(objectId);
      setSelectedObjectId((current) => (current === objectId ? null : current));
      setEditingTextObjectId((current) => (current === objectId ? null : current));
    };

    socket.on('object:created', handleObjectCreated);
    socket.on('object:updated', handleObjectUpdated);
    socket.on('object:deleted', handleObjectDeleted);

    return () => {
      socket.off('object:created', handleObjectCreated);
      socket.off('object:updated', handleObjectUpdated);
      socket.off('object:deleted', handleObjectDeleted);
    };
  }, [deleteObject, room, updateObject]);

  useEffect(() => {
    const handleConnect = () => setSocketConnected(true);
    const handleDisconnect = () => setSocketConnected(false);
    const handleOnline = () => setBrowserOnline(true);
    const handleOffline = () => setBrowserOnline(false);

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    refreshQueueCount();
  }, [refreshQueueCount]);

  const replayOfflineQueue = useCallback(async () => {
    if (!room || !socketConnected || !browserOnline || isReplayMode) return;
    if (isReplayingQueueRef.current) return;

    const queued = offlineQueue.list(room.id, sessionId);
    if (queued.length === 0) return;

    isReplayingQueueRef.current = true;
    setIsReplayingQueue(true);

    let syncedCount = 0;
    let blockedByTimeout = false;

    for (const entry of queued) {
      if (!socketConnected || !browserOnline) {
        blockedByTimeout = true;
        break;
      }

      emitQueuedOperation(entry);
      const result = await waitForOperationAck(entry.operationId, 2500);
      if (result !== 'ack') {
        pendingOperations.current.delete(entry.operationId);
        offlineQueue.markAttempt(entry.id, 'Timed out waiting for server echo');
        blockedByTimeout = true;
        break;
      }

      offlineQueue.remove(entry.id);
      syncedCount += 1;
      refreshQueueCount();
    }

    setIsReplayingQueue(false);
    isReplayingQueueRef.current = false;

    refreshQueueCount();

    if (syncedCount > 0) {
      onNotify?.(`Synced ${syncedCount} queued change${syncedCount > 1 ? 's' : ''}.`);
    }

    if (blockedByTimeout) {
      onNotify?.('Some queued changes could not be confirmed yet and will retry automatically.');
    }
  }, [browserOnline, emitQueuedOperation, isReplayMode, offlineQueue, onNotify, refreshQueueCount, room, sessionId, socketConnected, waitForOperationAck]);

  useEffect(() => {
    if (!room || !socketConnected || !browserOnline || isReplayMode) return;
    if (queueReplayTimerRef.current !== null) {
      window.clearTimeout(queueReplayTimerRef.current);
    }

    // Allow room rejoin hydration to settle before replaying queued mutations.
    queueReplayTimerRef.current = window.setTimeout(() => {
      queueReplayTimerRef.current = null;
      void replayOfflineQueue();
    }, 350);
  }, [browserOnline, isReplayMode, replayOfflineQueue, room, socketConnected]);

  useEffect(() => {
    if (!room) return;

    const handlePhysicsState = (payload: PhysicsStatePayload) => {
      if (!payload || payload.roomId !== room.id || !payload.state) return;
      setRoomPhysics(payload.state);
    };

    const handlePresenceUpdated = (payload: PresenceUpdatedPayload) => {
      if (!payload || payload.roomId !== room.id || !payload.participantId) return;

      useRoomStore.getState().updateParticipantPresence(payload.participantId, {
        sessionId: payload.sessionId,
        lastViewportX: payload.viewport?.x,
        lastViewportY: payload.viewport?.y,
        lastViewportZoom: payload.viewport?.zoom,
        lastViewportWidth: payload.viewport?.width,
        lastViewportHeight: payload.viewport?.height,
        presenceStatus: payload.status,
        presenceTs: payload.serverTs,
      });
    };

    socket.on('physics:state', handlePhysicsState);
    socket.on('presence:updated', handlePresenceUpdated);
    return () => {
      socket.off('physics:state', handlePhysicsState);
      socket.off('presence:updated', handlePresenceUpdated);
    };
  }, [room, setRoomPhysics]);

  const emitPresenceSnapshot = useCallback((status: PresenceStatus) => {
    if (!room || isReplayMode) return;
    socket.emit('presence:update', {
      roomId: room.id,
      status,
      viewport: {
        x: offsetX,
        y: offsetY,
        zoom: scale,
        width: stageSize.width,
        height: stageSize.height,
      },
    });
    presenceSyncRef.current.lastSentAt = Date.now();
  }, [isReplayMode, offsetX, offsetY, room, scale, stageSize.height, stageSize.width]);

  useEffect(() => {
    if (!room || isReplayMode) return;

    const now = Date.now();
    const elapsed = now - presenceSyncRef.current.lastSentAt;
    const remaining = PRESENCE_SYNC_INTERVAL_MS - elapsed;

    if (remaining <= 0) {
      if (presenceSyncRef.current.timer !== null) {
        window.clearTimeout(presenceSyncRef.current.timer);
        presenceSyncRef.current.timer = null;
      }
      emitPresenceSnapshot('active');
      return;
    }

    if (presenceSyncRef.current.timer === null) {
      presenceSyncRef.current.timer = window.setTimeout(() => {
        presenceSyncRef.current.timer = null;
        emitPresenceSnapshot('active');
      }, remaining);
    }
  }, [emitPresenceSnapshot, isReplayMode, room]);

  useEffect(() => {
    if (!room || isReplayMode) return;

    const handleVisibilityChange = () => {
      emitPresenceSnapshot(document.visibilityState === 'hidden' ? 'idle' : 'active');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [emitPresenceSnapshot, isReplayMode, room]);

  // Update stage size on mount and resize
  useEffect(() => {
    const updateSize = () => {
      if (stageRef.current) {
        const stageContainer = stageRef.current.container() as HTMLDivElement;
        const surface = stageContainer.parentElement as HTMLDivElement | null;
        const measuredElement = surface ?? stageContainer;
        const rect = measuredElement.getBoundingClientRect();

        setStageSize({
          width: Math.max(320, Math.floor(rect.width)),
          height: Math.max(280, Math.floor(rect.height)),
        });
      }
    };

    updateSize();
    const stageContainer = stageRef.current?.container() as HTMLDivElement | undefined;
    const surface = stageContainer?.parentElement as HTMLDivElement | null;
    const resizeObserver = surface ? new ResizeObserver(updateSize) : null;
    if (surface && resizeObserver) {
      resizeObserver.observe(surface);
    }

    window.addEventListener('resize', updateSize);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  // Mouse down: start panning (but not if clicking on an object)
  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    // Only pan/place on left mouse button (button 0).
    if (e.evt.button !== 0) return;

    const parentGroup = e.target.findAncestor('Group');
    const clickedEmptyCanvas = !parentGroup;
    if (clickedEmptyCanvas) {
      if (activeTool) {
        const stage = e.target.getStage();
        const pointer = stage?.getPointerPosition();

        if (pointer) {
          const worldX = (pointer.x - offsetX) / scale;
          const worldY = (pointer.y - offsetY) / scale;
          const forceSquare = selectedShapeOption === 'square' && activeTool === 'rectangle';
          const beginTextEdit = activeTool === 'text';

          createObjectAtAndSync(activeTool, worldX, worldY, {
            forceSquare,
            beginTextEdit,
          });

          setActiveTool(null);
          setSelectedShapeOption((current) => (current === 'square' ? 'rectangle' : current));
        }
      }

      if (isFieldActionEnabled) {
        updateFieldActionPointer(e);
      }

      finishTextEditing();
      setSelectedObjectId(null);
      isPanning.current = true;
      lastMousePos.current = { x: e.evt.clientX, y: e.evt.clientY };
      return;
    }

    const objectId = parentGroup?.id();
    if (objectId) {
      finishTextEditing();
      setSelectedObjectId(objectId);
    }
  }, [activeTool, createObjectAtAndSync, finishTextEditing, isFieldActionEnabled, offsetX, offsetY, scale, selectedShapeOption, updateFieldActionPointer]);



  // Mouse move: pan if dragging.
  // Input events can arrive much faster than paint frames; batching pan deltas in
  // rAF keeps interaction smooth under sustained pointer movement.
  const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (fieldActionRef.current?.active) {
      updateFieldActionPointer(e);
    }

    if (!isPanning.current) return;

    const deltaX = e.evt.clientX - lastMousePos.current.x;
    const deltaY = e.evt.clientY - lastMousePos.current.y;

    pendingPanRef.current.dx += deltaX;
    pendingPanRef.current.dy += deltaY;
    if (panRafRef.current === null) {
      panRafRef.current = window.requestAnimationFrame(() => {
        const { dx, dy } = pendingPanRef.current;
        pendingPanRef.current = { dx: 0, dy: 0 };
        panRafRef.current = null;
        if (dx !== 0 || dy !== 0) {
          panBy(dx, dy);
        }
      });
    }

    lastMousePos.current = { x: e.evt.clientX, y: e.evt.clientY };
  }, [panBy, updateFieldActionPointer]);

  // Mouse up: stop panning
  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
    fieldActionRef.current = null;
    if (panRafRef.current !== null) {
      window.cancelAnimationFrame(panRafRef.current);
      panRafRef.current = null;
      pendingPanRef.current = { dx: 0, dy: 0 };
    }
  }, []);

  // Wheel: zoom toward/away from mouse position.
  // Coalescing wheel deltas per frame prevents runaway zoom acceleration on
  // high-resolution trackpads while preserving intent.
  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();

    const stage = e.target.getStage();
    if (!stage) return;

    // Convert viewport client coordinates to canvas-local coordinates before zoom.
    // Passing raw clientX/clientY here can shift zoom focus and mimic hit-test drift.
    const pointer = clientToCanvasPoint(
      e.evt.clientX,
      e.evt.clientY,
      stage.container().getBoundingClientRect()
    );

    const pending = pendingZoomRef.current;
    if (pending) {
      pending.deltaY += e.evt.deltaY;
      pending.mouseX = pointer.x;
      pending.mouseY = pointer.y;
    } else {
      pendingZoomRef.current = {
        deltaY: e.evt.deltaY,
        mouseX: pointer.x,
        mouseY: pointer.y,
      };
    }

    if (zoomRafRef.current === null) {
      zoomRafRef.current = window.requestAnimationFrame(() => {
        const next = pendingZoomRef.current;
        pendingZoomRef.current = null;
        zoomRafRef.current = null;
        if (!next) return;

        const normalizedDelta = Math.max(-120, Math.min(120, next.deltaY));
        const zoomFactor = Math.exp(-normalizedDelta * 0.0015);
        zoomBy(zoomFactor, next.mouseX, next.mouseY);
      });
    }
  }, [zoomBy]);

  useEffect(() => {
    return () => {
      if (panRafRef.current !== null) {
        window.cancelAnimationFrame(panRafRef.current);
      }
      if (zoomRafRef.current !== null) {
        window.cancelAnimationFrame(zoomRafRef.current);
      }
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      if (presenceSyncRef.current.timer !== null) {
        window.clearTimeout(presenceSyncRef.current.timer);
      }
      if (queueReplayTimerRef.current !== null) {
        window.clearTimeout(queueReplayTimerRef.current);
      }
      clearMatterRuntime();
    };
  }, [clearMatterRuntime]);

  const selectedObject = useMemo(() => {
    if (!selectedObjectId) return null;
    return displayedObjects.find((object) => object.id === selectedObjectId) ?? null;
  }, [displayedObjects, selectedObjectId]);

  const editingTextObject = useMemo(() => {
    if (!editingTextObjectId) return null;
    const target = displayedObjects.find((object) => object.id === editingTextObjectId) ?? null;
    if (!target || target.type !== 'text') return null;
    return target;
  }, [displayedObjects, editingTextObjectId]);

  const textEditorStyle = useMemo<React.CSSProperties | null>(() => {
    if (!editingTextObject) return null;

    return {
      left: `${offsetX + editingTextObject.x * scale}px`,
      top: `${offsetY + editingTextObject.y * scale}px`,
      width: `${Math.max(120, editingTextObject.width * scale)}px`,
      minHeight: `${Math.max(40, editingTextObject.height * scale)}px`,
      fontSize: `${Math.max(12, (editingTextObject.fontSize ?? 14) * scale)}px`,
      color: editingTextObject.color,
      transform: `rotate(${editingTextObject.rotation}rad)`,
      transformOrigin: 'top left',
    };
  }, [editingTextObject, offsetX, offsetY, scale]);

  const handleTextEditorChange = useCallback((value: string) => {
    if (!editingTextObjectId || isReplayMode) return;
    setEditingTextValue(value);
    updateObject(editingTextObjectId, { text: value });
    emitUpdate(editingTextObjectId, { text: value });
  }, [editingTextObjectId, emitUpdate, isReplayMode, updateObject]);

  const finishAndPersistTextEdit = useCallback(() => {
    if (!editingTextObjectId || isReplayMode) {
      finishTextEditing();
      return;
    }

    const latest = useCanvasObjectsStore.getState().getObject(editingTextObjectId);
    const nextText = editingTextValue.trim().length > 0 ? editingTextValue : 'Text';

    if (!latest || latest.type !== 'text') {
      finishTextEditing();
      return;
    }

    if (latest.text !== nextText) {
      updateObject(editingTextObjectId, { text: nextText });
      emitUpdate(editingTextObjectId, { text: nextText });
    }

    setEditingTextValue(nextText);
    finishTextEditing();
  }, [editingTextObjectId, editingTextValue, emitUpdate, finishTextEditing, isReplayMode, updateObject]);

  const selectedObjectSupportsPhysics = Boolean(selectedObject && isPhysicsObjectType(selectedObject.type));
  const selectedObjectIsPinned = Boolean(selectedObject && pinnedSet.has(selectedObject.id));

  const handleTogglePhysicsMode = useCallback(() => {
    const nextEnabled = !roomPhysics.enabled;
    if (nextEnabled) {
      resetPhysicsSnapshotFromCurrentObjects();
    }
    emitPhysicsStatePatch({
      enabled: nextEnabled,
      simulationRunning: nextEnabled,
    });
  }, [emitPhysicsStatePatch, resetPhysicsSnapshotFromCurrentObjects, roomPhysics.enabled]);

  const handleToggleSimulation = useCallback(() => {
    if (!roomPhysics.enabled) return;
    emitPhysicsStatePatch({
      simulationRunning: !roomPhysics.simulationRunning,
    });
  }, [emitPhysicsStatePatch, roomPhysics.enabled, roomPhysics.simulationRunning]);

  const handleAdjustGravity = useCallback((delta: number) => {
    emitPhysicsStatePatch({
      gravityY: Math.max(0, Math.min(10, roomPhysics.gravityY + delta)),
    });
  }, [emitPhysicsStatePatch, roomPhysics.gravityY]);

  const handleAdjustRestitution = useCallback((delta: number) => {
    emitPhysicsStatePatch({
      restitution: Math.max(0, Math.min(1.2, Number((roomPhysics.restitution + delta).toFixed(2)))),
    });
  }, [emitPhysicsStatePatch, roomPhysics.restitution]);

  const handleAdjustFrictionAir = useCallback((delta: number) => {
    emitPhysicsStatePatch({
      frictionAir: Math.max(0, Math.min(0.2, Number((roomPhysics.frictionAir + delta).toFixed(3)))),
    });
  }, [emitPhysicsStatePatch, roomPhysics.frictionAir]);

  const handleTogglePinned = useCallback(() => {
    if (!selectedObject || !selectedObjectSupportsPhysics) return;
    emitPhysicsSetStatic(selectedObject.id, !selectedObjectIsPinned);
  }, [emitPhysicsSetStatic, selectedObject, selectedObjectIsPinned, selectedObjectSupportsPhysics]);

  const handleToggleFieldMode = useCallback((mode: Exclude<FieldMode, null>) => {
    setFieldMode((current) => (current === mode ? null : mode));
    fieldActionRef.current = null;
  }, []);

  const handleResetPhysics = useCallback(() => {
    emitPhysicsReset();
  }, [emitPhysicsReset]);

  return (
    <div className="canvas-surface" role="region" aria-label="Infinite canvas workspace" aria-busy={loadingPhase !== null}>
      <div className="canvas-toolbar" role="toolbar" aria-label="Object creation toolbar">
        <div className="toolbar-strip toolbar-strip--objects" aria-label="Object tools group">
          <div className="toolbar-group-card">
            <div className="toolbar-group-head">
              <span className="toolbar-group-title">Objects</span>
              <span className="toolbar-group-hint">Create and export</span>
            </div>
            <div className="tool-actions" aria-label="Shape tools">
              <div className="shape-menu" ref={shapeMenuRef}>
                <button
                  type="button"
                  className={activeTool === 'rectangle' || activeTool === 'circle' || activeTool === 'triangle' ? 'tool-btn active shape-menu-trigger' : 'tool-btn shape-menu-trigger'}
                  onClick={() => {
                    finishTextEditing();
                    setIsShapeMenuOpen((current) => !current);
                  }}
                  disabled={isReplayMode}
                  title={`Shape (${selectedShapeConfig?.label ?? 'Rectangle'})`}
                  aria-label={`Shape menu (${selectedShapeConfig?.label ?? 'Rectangle'})`}
                  aria-expanded={isShapeMenuOpen}
                  aria-haspopup="menu"
                >
                  <span aria-hidden="true">{selectedShapeConfig?.icon ?? '▭'}</span>
                  <span>Shape</span>
                  <span aria-hidden="true">▾</span>
                </button>
                {isShapeMenuOpen ? (
                  <div className="shape-menu-panel" role="menu" aria-label="Shape options">
                    {SHAPE_MENU_ITEMS.map((shape) => (
                      <button
                        key={shape.option}
                        type="button"
                        role="menuitem"
                        className={selectedShapeOption === shape.option ? 'shape-menu-item shape-menu-item--active' : 'shape-menu-item'}
                        onClick={() => handleShapeToolSelect(shape.option)}
                        aria-label={`Select ${shape.label} tool`}
                      >
                        <span aria-hidden="true">{shape.icon}</span>
                        <span>{shape.label}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {TOOLBAR_ITEMS.map((tool) => (
                <button
                  key={tool.type}
                  type="button"
                  className={activeTool === tool.type ? 'tool-btn active' : 'tool-btn'}
                  onClick={() => {
                    if (tool.type === 'text') {
                      handleTextToolSelect();
                      return;
                    }

                    finishTextEditing();
                    createObjectAndSync(tool.type);
                    setActiveTool(null);
                  }}
                  disabled={isReplayMode}
                  title={tool.type === 'text' ? `${tool.label} (${tool.hotkey}) - click canvas to place` : `${tool.label} (${tool.hotkey})`}
                  aria-label={tool.type === 'text' ? `${tool.label} tool (${tool.hotkey})` : `${tool.label} (${tool.hotkey})`}
                >
                  <span aria-hidden="true">{tool.icon}</span>
                </button>
              ))}
              <button
                type="button"
                className="tool-btn"
                onClick={() => openUploadPicker('image')}
                disabled={uploadInProgress || isReplayMode}
                title="Upload and insert an image onto the canvas"
                aria-label="Upload image"
              >
                <span aria-hidden="true">Image</span>
              </button>
              <button
                type="button"
                className="tool-btn"
                onClick={() => openUploadPicker('audio')}
                disabled={uploadInProgress || isReplayMode}
                title="Upload and insert audio onto the canvas"
                aria-label="Upload audio"
              >
                <span aria-hidden="true">Audio</span>
              </button>
              <button
                type="button"
                className="tool-btn"
                onClick={() => openUploadPicker('video')}
                disabled={uploadInProgress || isReplayMode}
                title="Upload and insert video onto the canvas"
                aria-label="Upload video"
              >
                <span aria-hidden="true">Video</span>
              </button>
              <button
                type="button"
                className="tool-btn"
                onClick={handleExportPng}
                disabled={isReplayMode}
                title="Save canvas as PNG image (for sharing and presentations)"
                aria-label="Export PNG"
              >
                <span aria-hidden="true">PNG</span>
              </button>
              <button
                type="button"
                className="tool-btn"
                onClick={handleExportSvg}
                disabled={isReplayMode}
                title="Save as SVG vector (editable in design tools like Figma or Illustrator)"
                aria-label="Export SVG"
              >
                <span aria-hidden="true">SVG</span>
              </button>
              <button
                type="button"
                className="tool-btn"
                onClick={handleExportJson}
                disabled={isReplayMode}
                title="Save as JSON data (for backup or integration with other tools)"
                aria-label="Export JSON"
              >
                <span aria-hidden="true">JSON</span>
              </button>
              <button
                type="button"
                className={isReplayMode ? 'tool-btn active' : 'tool-btn'}
                onClick={() => {
                  void handleReplayPanelToggle();
                }}
                title={isReplayMode ? 'Exit replay mode and return to live canvas' : 'Open replay panel to watch event history'}
                aria-label={isReplayMode ? 'Exit replay mode' : 'Open replay panel'}
              >
                <span aria-hidden="true">Replay</span>
              </button>
            </div>
          </div>
        </div>

        <div className="toolbar-strip toolbar-strip--physics" aria-label="Physics controls group">
          <div className="toolbar-group-card">
            <div className="toolbar-group-head">
              <span className="toolbar-group-title">Physics</span>
              <span className="toolbar-group-hint">Simulation controls</span>
            </div>
            <div className="physics-core-controls">
              <button
                type="button"
                className={roomPhysics.enabled ? 'tool-btn active' : 'tool-btn'}
                onClick={handleTogglePhysicsMode}
                disabled={isReplayMode}
                aria-label="Toggle physics mode"
                aria-pressed={roomPhysics.enabled}
                title="Enable physics simulation: gravity, bouncing, throwing, and force fields"
              >
                <span aria-hidden="true">Physics</span>
              </button>
              <button
                type="button"
                className="tool-btn"
                onClick={handleToggleSimulation}
                disabled={!roomPhysics.enabled || isReplayMode}
                aria-label="Toggle physics simulation"
                aria-pressed={roomPhysics.simulationRunning}
                title={roomPhysics.enabled ? (roomPhysics.simulationRunning ? 'Pause physics simulation' : 'Start physics simulation') : 'Enable Physics first to use this control'}
              >
                <span aria-hidden="true">{roomPhysics.simulationRunning ? 'Pause' : 'Run'}</span>
              </button>
              <button
                type="button"
                className={isPhysicsControlsExpanded ? 'tool-btn active toolbar-expand-toggle' : 'tool-btn toolbar-expand-toggle'}
                onClick={() => setIsPhysicsControlsExpanded((current) => !current)}
                disabled={!roomPhysics.enabled || isReplayMode}
                aria-label="Toggle advanced physics controls"
                aria-pressed={isPhysicsControlsExpanded}
                title="Show/hide gravity, bounce, and friction controls"
              >
                <span aria-hidden="true">Advanced</span>
              </button>
            </div>

            <div className={isPhysicsControlsExpanded ? 'physics-advanced-controls physics-advanced-controls--open' : 'physics-advanced-controls'}>
              <button
                type="button"
                className="tool-btn"
                onClick={() => handleAdjustGravity(-0.1)}
                disabled={!roomPhysics.enabled || isReplayMode}
                aria-label="Decrease gravity"
                title="Decrease gravity"
              >
                <span aria-hidden="true">G-</span>
              </button>
              <button
                type="button"
                className="tool-btn"
                onClick={() => handleAdjustGravity(0.1)}
                disabled={!roomPhysics.enabled || isReplayMode}
                aria-label="Increase gravity"
                title="Increase gravity"
              >
                <span aria-hidden="true">G+</span>
              </button>
              <button
                type="button"
                className="tool-btn"
                onClick={() => handleAdjustRestitution(-0.05)}
                disabled={!roomPhysics.enabled || isReplayMode}
                aria-label="Decrease restitution"
                title="Decrease restitution"
              >
                <span aria-hidden="true">B-</span>
              </button>
              <button
                type="button"
                className="tool-btn"
                onClick={() => handleAdjustRestitution(0.05)}
                disabled={!roomPhysics.enabled || isReplayMode}
                aria-label="Increase restitution"
                title="Increase restitution"
              >
                <span aria-hidden="true">B+</span>
              </button>
              <button
                type="button"
                className="tool-btn"
                onClick={() => handleAdjustFrictionAir(-0.005)}
                disabled={!roomPhysics.enabled || isReplayMode}
                aria-label="Decrease friction"
                title="Decrease friction"
              >
                <span aria-hidden="true">F-</span>
              </button>
              <button
                type="button"
                className="tool-btn"
                onClick={() => handleAdjustFrictionAir(0.005)}
                disabled={!roomPhysics.enabled || isReplayMode}
                aria-label="Increase friction"
                title="Increase friction"
              >
                <span aria-hidden="true">F+</span>
              </button>
              <button
                type="button"
                className="tool-btn"
                onClick={handleTogglePinned}
                disabled={!roomPhysics.enabled || !selectedObjectSupportsPhysics || isReplayMode}
                aria-label="Toggle static object"
                aria-pressed={selectedObjectIsPinned}
                title={selectedObjectIsPinned ? 'Unpin selected object' : 'Pin selected object'}
              >
                <span aria-hidden="true">{selectedObjectIsPinned ? 'Unpin' : 'Pin'}</span>
              </button>
              <button
                type="button"
                className="tool-btn"
                onClick={handleResetPhysics}
                disabled={!roomPhysics.enabled || isReplayMode}
                aria-label="Reset physics simulation"
                title="Reset physics simulation"
              >
                <span aria-hidden="true">Reset</span>
              </button>
              <button
                type="button"
                className={fieldMode === 'attract' ? 'tool-btn active' : 'tool-btn'}
                onClick={() => handleToggleFieldMode('attract')}
                disabled={!roomPhysics.enabled || isReplayMode || !isPhysicsAuthority}
                aria-label="Toggle attraction field"
                aria-pressed={fieldMode === 'attract'}
                title="Enable force field that pulls nearby objects toward center (radius: 340px)"
              >
                <span aria-hidden="true">Attract</span>
              </button>
              <button
                type="button"
                className={fieldMode === 'repel' ? 'tool-btn active' : 'tool-btn'}
                onClick={() => handleToggleFieldMode('repel')}
                disabled={!roomPhysics.enabled || isReplayMode || !isPhysicsAuthority}
                aria-label="Toggle repulsion field"
                aria-pressed={fieldMode === 'repel'}
                title="Enable force field that pushes nearby objects away from center (radius: 340px)"
              >
                <span aria-hidden="true">Repel</span>
              </button>
            </div>
          </div>
        </div>

        <div className="toolbar-strip toolbar-strip--session" aria-label="Session indicators group">
          <div className="toolbar-meta">
            <span className={loadingPhase ? 'users-chip users-chip--loading' : 'users-chip'} aria-label={`Users in room: ${participantCount}`}>
            {loadingPhase ? 'Syncing...' : `${participantCount} users`}
            </span>
            {!browserOnline ? (
              <span className="users-chip users-chip--loading" aria-label="Offline mode status">
                Offline{queuedOperationCount > 0 ? ` | ${queuedOperationCount} queued` : ''}
              </span>
            ) : null}
            {browserOnline && !socketConnected ? (
              <span className="users-chip users-chip--loading" aria-label="Reconnecting status">
                Reconnecting{queuedOperationCount > 0 ? ` | ${queuedOperationCount} queued` : ''}
              </span>
            ) : null}
            {browserOnline && socketConnected && queuedOperationCount > 0 ? (
              <span className={isReplayingQueue ? 'users-chip users-chip--loading' : 'users-chip'} aria-label="Queued operation status">
                {isReplayingQueue ? `Syncing ${queuedOperationCount} queued` : `${queuedOperationCount} queued`}
              </span>
            ) : null}
            {roomPhysics.enabled ? (
              <span className="users-chip" aria-label="Physics status">
                {isPhysicsAuthority ? 'Physics Host' : 'Physics Follower'} | g {roomPhysics.gravityY.toFixed(1)} | b {roomPhysics.restitution.toFixed(2)} | f {roomPhysics.frictionAir.toFixed(3)}
              </span>
            ) : null}
            {fieldMode && roomPhysics.enabled ? (
              <span className={fieldActionRef.current?.active ? 'users-chip users-chip--loading' : 'users-chip'} aria-label="Field interaction mode">
                Field: {fieldMode === 'attract' ? 'Attract' : 'Repel'}
              </span>
            ) : null}
            {isReplayMode ? (
              <span className="users-chip users-chip--replay" aria-label="Replay mode enabled">
                Replay Mode
              </span>
            ) : null}
            {uploadInProgress && uploadLabel ? (
              <span className="users-chip users-chip--loading" aria-label="Upload in progress">
                {uploadLabel} {uploadProgress}%
              </span>
            ) : null}
            {failedUpload ? (
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  void runMediaUpload(failedUpload.mediaType, failedUpload.files);
                }}
                disabled={isReplayMode}
                aria-label="Retry failed upload"
                title={failedUpload.message}
              >
                Retry Upload
              </button>
            ) : null}
            {selectedObject?.type === 'text' && !isReplayMode ? (
              <button
                type="button"
                className="ghost-btn"
                onClick={() => startTextEditing(selectedObject.id)}
                aria-label="Edit selected text"
                title="Edit selected text"
              >
                Edit Text
              </button>
            ) : null}
            {selectedObjectId && !isReplayMode && (
              <button
                type="button"
                className="delete-btn"
                onClick={() => {
                  finishTextEditing();
                  deleteObjectAndSync(selectedObjectId);
                }}
                aria-label="Delete selected object"
                title="Delete selected object"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {isReplayPanelOpen ? (
        <aside className="replay-panel" aria-label="Replay controls panel">
          <div className="replay-panel__header">
            <div>
              <p className="replay-panel__eyebrow">Replay</p>
              <h3 className="replay-panel__title">Room Event Playback</h3>
            </div>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                void handleReplayPanelToggle();
              }}
            >
              {isReplayMode ? 'Exit Replay' : 'Close'}
            </button>
          </div>

          {isReplayLoading ? (
            <p className="replay-panel__status">Loading event history...</p>
          ) : null}
          {replayError ? <p className="inline-error">{replayError}</p> : null}

          {isReplayMode ? (
            <>
              <div className="replay-panel__controls">
                <button type="button" className="tool-btn" onClick={() => setIsReplayPlaying(true)} disabled={isReplayPlaying || replayCurrentPosition >= replayEventCount} aria-label="Play replay">
                  Play
                </button>
                <button type="button" className="tool-btn" onClick={() => setIsReplayPlaying(false)} disabled={!isReplayPlaying} aria-label="Pause replay">
                  Pause
                </button>
                <button type="button" className="tool-btn" onClick={handleReplayRestart} aria-label="Restart replay">
                  Restart
                </button>
                <button type="button" className="tool-btn" onClick={handleReplayStepBackward} disabled={replayCurrentPosition <= 0} aria-label="Step backward">
                  Step -
                </button>
                <button type="button" className="tool-btn" onClick={handleReplayStepForward} disabled={replayCurrentPosition >= replayEventCount} aria-label="Step forward">
                  Step +
                </button>
                <label className="replay-panel__speed" htmlFor="replay-speed-select">
                  Speed
                  <select
                    id="replay-speed-select"
                    className="replay-panel__speed-select"
                    value={replaySpeed}
                    onChange={(event) => setReplaySpeed(Number(event.target.value))}
                  >
                    <option value={0.25}>0.25x</option>
                    <option value={0.5}>0.5x</option>
                    <option value={1}>1x</option>
                    <option value={2}>2x</option>
                    <option value={4}>4x</option>
                  </select>
                </label>
              </div>

              <div className="replay-panel__timeline-wrap">
                <div className="replay-panel__timeline-meta">
                  <span>Event {replayCurrentPosition} / {replayEventCount}</span>
                  <span>{Math.round(replayProgress * 100)}%</span>
                </div>
                <input
                  type="range"
                  className="replay-panel__timeline"
                  min={0}
                  max={Math.max(0, replayEventCount)}
                  step={1}
                  value={replayCurrentPosition}
                  onChange={(event) => {
                    setIsReplayPlaying(false);
                    handleReplaySeek(Number(event.target.value));
                  }}
                  aria-label="Replay timeline scrubber"
                />
                <progress className="replay-panel__progress" value={replayCurrentPosition} max={Math.max(1, replayEventCount)} />
              </div>

              <div className="replay-panel__event-meta">
                <p><strong>Event Type:</strong> {replayCurrentEvent?.eventType ?? 'None'}</p>
                <p><strong>Sequence:</strong> {replayCurrentEvent?.sequenceNumber ?? '-'}</p>
                <p><strong>Timestamp:</strong> {replayCurrentEvent?.createdAt ? new Date(replayCurrentEvent.createdAt).toLocaleString() : '-'}</p>
                <p><strong>Playback:</strong> {replaySpeed}x</p>
              </div>
            </>
          ) : (
            <p className="replay-panel__status">Open replay mode to inspect deterministic event playback.</p>
          )}
        </aside>
      ) : null}

      {isReplayMode ? (
        <div className="replay-mode-banner" role="status" aria-label="Replay mode indicator">
          Replay Mode Active: canvas is rendering replay state only.
        </div>
      ) : null}

      {loadingPhase && loadingCopy ? <LoadingOverlay message={loadingCopy.title} subMessage={loadingCopy.sub} /> : null}

      <Stage
        ref={stageRef}
        width={stageSize.width}
        height={stageSize.height}
        x={offsetX}
        y={offsetY}
        scaleX={scale}
        scaleY={scale}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        style={{
          cursor: isPanning.current ? 'grabbing' : 'grab',
          touchAction: 'none',
          borderRadius: '14px',
          boxShadow: 'inset 0 0 0 1px rgba(148, 163, 184, 0.35)',
          background: 'linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)',
        }}
      >
        <Layer>
          {displayedObjects.map((obj) => (
            <ObjectRenderer
              key={obj.id}
              object={obj}
              selected={selectedObjectId === obj.id}
              draggable={isReplayMode ? false : !(roomPhysics.enabled && isPhysicsObjectType(obj.type) && pinnedSet.has(obj.id))}
              onDragStart={() => {
                if (isReplayMode) return;
                handleObjectDragStart(obj.id);
              }}
              onDragMove={(x, y) => {
                if (isReplayMode) return;
                handleObjectDragMove(obj.id, x, y);
              }}
              onMove={(x, y) => {
                if (isReplayMode) return;
                moveObjectAndSync(obj.id, x, y);
              }}
              onDelete={() => {
                if (isReplayMode) return;
                finishTextEditing();
                deleteObjectAndSync(obj.id);
              }}
              onResize={(width, height) => {
                if (isReplayMode) return;
                resizeObjectAndSync(obj.id, width, height);
              }}
              onEditText={(objectId) => {
                if (isReplayMode) return;
                startTextEditing(objectId);
              }}
            />
          ))}
        </Layer>
      </Stage>

      {editingTextObject && textEditorStyle ? (
        <textarea
          ref={textEditorRef}
          className="canvas-inline-text-editor"
          value={editingTextValue}
          onChange={(event) => {
            handleTextEditorChange(event.target.value);
          }}
          onBlur={() => {
            finishAndPersistTextEdit();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              finishAndPersistTextEdit();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              finishAndPersistTextEdit();
            }
          }}
          style={textEditorStyle}
          aria-label="Inline text editor"
        />
      ) : null}

      <MiniMapRadar
        objects={displayedObjects}
        participants={participants}
        currentSessionId={sessionId}
        viewport={{ offsetX, offsetY, scale }}
        stageSize={stageSize}
        onSetPan={setPan}
      />

      <input
        ref={imageUploadInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(event) => {
          void handlePickerChanged('image', event.target.files);
        }}
      />
      <input
        ref={audioUploadInputRef}
        type="file"
        accept="audio/mpeg,audio/wav,audio/x-wav,audio/ogg,audio/mp4,audio/webm"
        multiple
        hidden
        onChange={(event) => {
          void handlePickerChanged('audio', event.target.files);
        }}
      />
      <input
        ref={videoUploadInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/ogg"
        multiple
        hidden
        onChange={(event) => {
          void handlePickerChanged('video', event.target.files);
        }}
      />
    </div>
  );
};
