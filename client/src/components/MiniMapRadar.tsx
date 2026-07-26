import React, { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { CanvasObject } from '../store/objects.js';
import type { RoomParticipant } from '../store/room.js';

interface ViewportState {
  offsetX: number;
  offsetY: number;
  scale: number;
}

interface StageSize {
  width: number;
  height: number;
}

interface MiniMapRadarProps {
  objects: CanvasObject[];
  participants: RoomParticipant[];
  currentSessionId?: string;
  viewport: ViewportState;
  stageSize: StageSize;
  onSetPan: (offsetX: number, offsetY: number) => void;
}

interface WorldRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MINIMAP_WIDTH = 248;
const MINIMAP_HEIGHT = 172;
const MAP_PADDING = 14;
const KEYBOARD_PAN_WORLD_UNITS = 220;

function toWorldRect(viewportX: number, viewportY: number, zoom: number, viewportWidth: number, viewportHeight: number): WorldRect {
  const width = viewportWidth / zoom;
  const height = viewportHeight / zoom;
  return {
    left: -viewportX / zoom,
    top: -viewportY / zoom,
    width,
    height,
  };
}

function hashColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }

  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 78% 48%)`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export const MiniMapRadar: React.FC<MiniMapRadarProps> = ({
  objects,
  participants,
  currentSessionId,
  viewport,
  stageSize,
  onSetPan,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const dragStateRef = useRef<{ pointerId: number; startClientX: number; startClientY: number; startWorldLeft: number; startWorldTop: number } | null>(null);

  const currentViewportRect = useMemo(() => {
    return toWorldRect(viewport.offsetX, viewport.offsetY, viewport.scale, stageSize.width, stageSize.height);
  }, [stageSize.height, stageSize.width, viewport.offsetX, viewport.offsetY, viewport.scale]);

  const collaboratorViewports = useMemo(() => {
    return participants
      .filter((participant) => participant.isActive)
      .map((participant) => {
        const zoom = participant.lastViewportZoom;
        const x = participant.lastViewportX;
        const y = participant.lastViewportY;
        if (typeof zoom !== 'number' || typeof x !== 'number' || typeof y !== 'number' || zoom <= 0) {
          return null;
        }

        const width = participant.lastViewportWidth ?? stageSize.width;
        const height = participant.lastViewportHeight ?? stageSize.height;

        return {
          participant,
          color: hashColor(participant.id),
          rect: toWorldRect(x, y, zoom, width, height),
          isCurrentUser: Boolean(currentSessionId && participant.sessionId === currentSessionId),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  }, [currentSessionId, participants, stageSize.height, stageSize.width]);

  const worldBounds = useMemo(() => {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    const includeRect = (left: number, top: number, width: number, height: number) => {
      minX = Math.min(minX, left);
      minY = Math.min(minY, top);
      maxX = Math.max(maxX, left + width);
      maxY = Math.max(maxY, top + height);
    };

    objects.forEach((object) => {
      includeRect(object.x, object.y, object.width, object.height);
    });

    includeRect(currentViewportRect.left, currentViewportRect.top, currentViewportRect.width, currentViewportRect.height);
    collaboratorViewports.forEach((entry) => {
      includeRect(entry.rect.left, entry.rect.top, entry.rect.width, entry.rect.height);
    });

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return {
        minX: currentViewportRect.left,
        minY: currentViewportRect.top,
        maxX: currentViewportRect.left + currentViewportRect.width,
        maxY: currentViewportRect.top + currentViewportRect.height,
      };
    }

    const padding = 120;
    return {
      minX: minX - padding,
      minY: minY - padding,
      maxX: maxX + padding,
      maxY: maxY + padding,
    };
  }, [collaboratorViewports, currentViewportRect.height, currentViewportRect.left, currentViewportRect.top, currentViewportRect.width, objects]);

  const mapGeometry = useMemo(() => {
    const worldWidth = Math.max(1, worldBounds.maxX - worldBounds.minX);
    const worldHeight = Math.max(1, worldBounds.maxY - worldBounds.minY);

    const innerWidth = MINIMAP_WIDTH - MAP_PADDING * 2;
    const innerHeight = MINIMAP_HEIGHT - MAP_PADDING * 2;

    const fitScale = Math.min(innerWidth / worldWidth, innerHeight / worldHeight);
    const renderedWidth = worldWidth * fitScale;
    const renderedHeight = worldHeight * fitScale;

    const offsetX = MAP_PADDING + (innerWidth - renderedWidth) / 2;
    const offsetY = MAP_PADDING + (innerHeight - renderedHeight) / 2;

    return {
      fitScale,
      offsetX,
      offsetY,
      worldWidth,
      worldHeight,
      worldMinX: worldBounds.minX,
      worldMinY: worldBounds.minY,
    };
  }, [worldBounds.maxX, worldBounds.maxY, worldBounds.minX, worldBounds.minY]);

  const toMapRect = (rect: WorldRect) => {
    const x = mapGeometry.offsetX + (rect.left - mapGeometry.worldMinX) * mapGeometry.fitScale;
    const y = mapGeometry.offsetY + (rect.top - mapGeometry.worldMinY) * mapGeometry.fitScale;
    const width = rect.width * mapGeometry.fitScale;
    const height = rect.height * mapGeometry.fitScale;
    return { x, y, width, height };
  };

  const localMapRect = toMapRect(currentViewportRect);

  const objectRects = useMemo(() => {
    return objects.map((object) => ({
      id: object.id,
      type: object.type,
      color: object.color,
      rect: toMapRect({
        left: object.x,
        top: object.y,
        width: object.width,
        height: object.height,
      }),
    }));
  }, [objects, mapGeometry.fitScale, mapGeometry.offsetX, mapGeometry.offsetY, mapGeometry.worldMinX, mapGeometry.worldMinY]);

  const collaboratorRects = useMemo(() => {
    return collaboratorViewports
      .filter((entry) => !entry.isCurrentUser)
      .map((entry) => ({
        id: entry.participant.id,
        label: entry.participant.displayName,
        color: entry.color,
        rect: toMapRect(entry.rect),
      }));
  }, [collaboratorViewports, mapGeometry.fitScale, mapGeometry.offsetX, mapGeometry.offsetY, mapGeometry.worldMinX, mapGeometry.worldMinY]);

  const handleNavigateToClientPoint = (clientX: number, clientY: number, rect: DOMRect) => {
    const x = clamp(clientX - rect.left, 0, MINIMAP_WIDTH);
    const y = clamp(clientY - rect.top, 0, MINIMAP_HEIGHT);

    const worldX = mapGeometry.worldMinX + (x - mapGeometry.offsetX) / mapGeometry.fitScale;
    const worldY = mapGeometry.worldMinY + (y - mapGeometry.offsetY) / mapGeometry.fitScale;

    const currentViewWidth = stageSize.width / viewport.scale;
    const currentViewHeight = stageSize.height / viewport.scale;

    const nextLeft = worldX - currentViewWidth / 2;
    const nextTop = worldY - currentViewHeight / 2;

    onSetPan(-nextLeft * viewport.scale, -nextTop * viewport.scale);
  };

  const handleMapPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const insideViewport =
      event.clientX >= rect.left + localMapRect.x &&
      event.clientX <= rect.left + localMapRect.x + localMapRect.width &&
      event.clientY >= rect.top + localMapRect.y &&
      event.clientY <= rect.top + localMapRect.y + localMapRect.height;

    if (!insideViewport) {
      handleNavigateToClientPoint(event.clientX, event.clientY, rect);
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWorldLeft: currentViewportRect.left,
      startWorldTop: currentViewportRect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleMapPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const dxClient = event.clientX - dragState.startClientX;
    const dyClient = event.clientY - dragState.startClientY;

    const dxWorld = dxClient / mapGeometry.fitScale;
    const dyWorld = dyClient / mapGeometry.fitScale;

    const nextLeft = dragState.startWorldLeft + dxWorld;
    const nextTop = dragState.startWorldTop + dyWorld;

    onSetPan(-nextLeft * viewport.scale, -nextTop * viewport.scale);
  };

  const handleMapPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleMapKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    event.preventDefault();
    const delta = KEYBOARD_PAN_WORLD_UNITS / Math.max(0.1, viewport.scale);
    const worldXCenter = currentViewportRect.left + currentViewportRect.width / 2;
    const worldYCenter = currentViewportRect.top + currentViewportRect.height / 2;

    let nextWorldXCenter = worldXCenter;
    let nextWorldYCenter = worldYCenter;

    if (event.key === 'ArrowUp') nextWorldYCenter -= delta;
    if (event.key === 'ArrowDown') nextWorldYCenter += delta;
    if (event.key === 'ArrowLeft') nextWorldXCenter -= delta;
    if (event.key === 'ArrowRight') nextWorldXCenter += delta;

    const nextLeft = nextWorldXCenter - currentViewportRect.width / 2;
    const nextTop = nextWorldYCenter - currentViewportRect.height / 2;
    onSetPan(-nextLeft * viewport.scale, -nextTop * viewport.scale);
  };

  return (
    <div className={collapsed ? 'minimap minimap--collapsed' : 'minimap'} data-testid="minimap-panel" aria-label="Mini-map and collaborator radar">
      <div className="minimap-header">
        <button
          type="button"
          className="minimap-toggle"
          onClick={() => setCollapsed((current) => !current)}
          aria-label={collapsed ? 'Expand mini-map' : 'Collapse mini-map'}
          aria-pressed={collapsed}
        >
          {collapsed ? 'Map' : 'Hide'}
        </button>
        {!collapsed ? (
          <button
            type="button"
            className="minimap-toggle"
            onClick={() => setShowLabels((current) => !current)}
            aria-label={showLabels ? 'Hide collaborator labels' : 'Show collaborator labels'}
            aria-pressed={showLabels}
          >
            {showLabels ? 'Labels' : 'No labels'}
          </button>
        ) : null}
      </div>

      {!collapsed ? (
        <div
          className="minimap-canvas"
          data-testid="minimap-canvas"
          role="application"
          tabIndex={0}
          aria-label="Mini-map navigator"
          aria-describedby="minimap-keyboard-hint"
          onPointerDown={handleMapPointerDown}
          onPointerMove={handleMapPointerMove}
          onPointerUp={handleMapPointerUp}
          onPointerCancel={handleMapPointerUp}
          onKeyDown={handleMapKeyDown}
        >
          <p id="minimap-keyboard-hint" className="visually-hidden">Use arrow keys to nudge camera position. Click or drag inside the minimap to reposition the viewport.</p>
          <div className="minimap-world-plane" />

          {objectRects.map((entry) => (
            <div
              key={entry.id}
              className={entry.type === 'circle' ? 'minimap-object minimap-object--circle' : 'minimap-object'}
              style={{
                left: `${entry.rect.x}px`,
                top: `${entry.rect.y}px`,
                width: `${Math.max(2, entry.rect.width)}px`,
                height: `${Math.max(2, entry.rect.height)}px`,
                backgroundColor: entry.color,
              }}
            />
          ))}

          {collaboratorRects.map((entry) => (
            <div
              key={entry.id}
              className="minimap-collaborator"
              data-testid={`minimap-collab-${entry.id}`}
              style={{
                left: `${entry.rect.x}px`,
                top: `${entry.rect.y}px`,
                width: `${Math.max(4, entry.rect.width)}px`,
                height: `${Math.max(4, entry.rect.height)}px`,
                borderColor: entry.color,
              }}
              title={entry.label}
            >
              {showLabels ? <span className="minimap-collaborator-label">{entry.label}</span> : null}
            </div>
          ))}

          <div
            className="minimap-viewport"
            data-testid="minimap-viewport-local"
            style={{
              left: `${localMapRect.x}px`,
              top: `${localMapRect.y}px`,
              width: `${Math.max(8, localMapRect.width)}px`,
              height: `${Math.max(8, localMapRect.height)}px`,
            }}
          />
        </div>
      ) : null}
    </div>
  );
};
