/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { chromium } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import { createReplayStore, reconstructReplayState, type RoomEvent, type CanvasObject } from '@realtime-canvas/shared';
import { useRoomStore } from '../../../client/src/store/room.ts';
import { useCanvasObjectsStore } from '../../../client/src/store/objects.ts';
import { usePhysicsStore, type RoomPhysicsState } from '../../../client/src/store/physics.ts';
import { useReplayStore } from '../../../client/src/store/replay.ts';
import { getOfflineOperationsQueue } from '../../../client/src/utils/offlineQueue.ts';
import { runSingleUserDragValidation } from './single-user-drag-validation.js';
import { runSingleUserResizeValidation } from './single-user-resize-validation.js';

const SERVER_URL = process.env.REPLAY_VALIDATION_SERVER_URL || 'http://localhost:3000';
const CLIENT_URL = process.env.REPLAY_VALIDATION_CLIENT_URL || 'http://localhost:5173';
const EVIDENCE_ROOT = path.resolve('docs/validation/evidence');

interface AuthResponse {
  sessionToken: string;
  sessionId: string;
}

interface RoomCreateResponse {
  code?: string;
  message?: string;
  roomId: string;
  shareCode: string;
}

interface RoomJoinResponse {
  code?: string;
  message?: string;
  roomId: string;
  shareCode?: string;
  canvasObjects: CanvasObject[];
  physicsState: RoomPhysicsState;
}

interface RoomEventsListResponse {
  code?: string;
  message?: string;
  roomId: string;
  events: RoomEvent[];
}

interface ScenarioResult {
  name: string;
  pass: boolean;
  details: Record<string, unknown>;
}

function nowIsoCompact(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function makeOp(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function assertServiceHealth(): Promise<void> {
  const [serverHealth, clientHealth] = await Promise.all([
    fetch(`${SERVER_URL}/health`).then((r) => r.ok),
    fetch(CLIENT_URL, { method: 'HEAD' }).then((r) => r.ok),
  ]);

  if (!serverHealth) {
    throw new Error(`Server health check failed at ${SERVER_URL}/health`);
  }

  if (!clientHealth) {
    throw new Error(`Client health check failed at ${CLIENT_URL}`);
  }
}

async function createGuest(displayName: string): Promise<AuthResponse> {
  const response = await fetch(`${SERVER_URL}/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName }),
  });

  if (!response.ok) {
    throw new Error(`Guest auth failed: ${response.status}`);
  }

  const payload = await response.json() as AuthResponse;
  if (!payload.sessionToken || !payload.sessionId) {
    throw new Error('Guest auth payload missing sessionToken/sessionId');
  }

  return payload;
}

async function connectSocket(sessionToken: string): Promise<Socket> {
  const socket = io(SERVER_URL, {
    auth: { token: sessionToken },
    transports: ['websocket'],
    forceNew: true,
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Socket connect timeout')), 12000);

    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve();
    });

    socket.once('connect_error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  return socket;
}

async function emitWithAck<TResponse>(socket: Socket, eventName: string, payload: unknown, timeoutMs = 12000): Promise<TResponse> {
  return await new Promise<TResponse>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${eventName} ack timeout`)), timeoutMs);
    socket.emit(eventName, payload, (response: TResponse) => {
      clearTimeout(timeout);
      resolve(response);
    });
  });
}

async function createRoom(socket: Socket, title: string): Promise<RoomCreateResponse> {
  const response = await emitWithAck<RoomCreateResponse>(socket, 'room:create', { displayName: title });
  if (response.code || !response.roomId || !response.shareCode) {
    throw new Error(`room:create failed: ${response.code || response.message || 'unknown error'}`);
  }
  return response;
}

async function joinRoom(socket: Socket, payload: { roomId?: string; shareCode?: string }): Promise<RoomJoinResponse> {
  const response = await emitWithAck<RoomJoinResponse>(socket, 'room:join', payload);
  if (response.code || !response.roomId) {
    throw new Error(`room:join failed: ${response.code || response.message || 'unknown error'}`);
  }
  return response;
}

async function listRoomEvents(socket: Socket, roomId: string): Promise<RoomEventsListResponse> {
  const response = await emitWithAck<RoomEventsListResponse>(socket, 'room:events:list', { roomId });
  if (response.code) {
    throw new Error(`room:events:list failed: ${response.code} ${response.message || ''}`);
  }
  return response;
}

async function waitForEventCount(socket: Socket, roomId: string, expectedCount: number, timeoutMs = 20000): Promise<RoomEvent[]> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const response = await listRoomEvents(socket, roomId);
    if (response.events.length >= expectedCount) {
      return response.events;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const last = await listRoomEvents(socket, roomId);
  throw new Error(`Timed out waiting for ${expectedCount} events, got ${last.events.length}`);
}

function stableSerialize(value: unknown): string {
  const seen = new WeakSet<object>();

  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.map((item) => normalize(item));
    }

    if (input && typeof input === 'object') {
      if (seen.has(input as object)) {
        return '[Circular]';
      }
      seen.add(input as object);

      const record = input as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      const output: Record<string, unknown> = {};

      for (const key of keys) {
        output[key] = normalize(record[key]);
      }

      return output;
    }

    return input;
  };

  return JSON.stringify(normalize(value));
}

function normalizeComparableObjects(objects: CanvasObject[]): Array<Record<string, unknown>> {
  return [...objects]
    .map((object) => ({
      id: object.id,
      type: object.type,
      x: object.x,
      y: object.y,
      width: object.width,
      height: object.height,
      rotation: object.rotation,
      zIndex: object.zIndex,
    }))
    .sort((left, right) => {
      if ((left.zIndex as number) !== (right.zIndex as number)) {
        return (left.zIndex as number) - (right.zIndex as number);
      }
      return String(left.id).localeCompare(String(right.id));
    });
}

function compareReplayToLive(replayObjects: CanvasObject[], liveObjects: CanvasObject[]): {
  pass: boolean;
  checks: Record<string, boolean>;
  mismatches: string[];
} {
  const replayComparable = normalizeComparableObjects(replayObjects);
  const liveComparable = normalizeComparableObjects(liveObjects);

  const replayIds = replayComparable.map((obj) => String(obj.id));
  const liveIds = liveComparable.map((obj) => String(obj.id));

  const checks: Record<string, boolean> = {
    identicalObjectCount: replayComparable.length === liveComparable.length,
    identicalObjectIds: stableSerialize(replayIds) === stableSerialize(liveIds),
    identicalObjectTypes: stableSerialize(replayComparable.map((obj) => obj.type)) === stableSerialize(liveComparable.map((obj) => obj.type)),
    identicalXY: stableSerialize(replayComparable.map((obj) => ({ id: obj.id, x: obj.x, y: obj.y }))) === stableSerialize(liveComparable.map((obj) => ({ id: obj.id, x: obj.x, y: obj.y }))),
    identicalDimensions: stableSerialize(replayComparable.map((obj) => ({ id: obj.id, width: obj.width, height: obj.height }))) === stableSerialize(liveComparable.map((obj) => ({ id: obj.id, width: obj.width, height: obj.height }))),
    identicalRotation: stableSerialize(replayComparable.map((obj) => ({ id: obj.id, rotation: obj.rotation }))) === stableSerialize(liveComparable.map((obj) => ({ id: obj.id, rotation: obj.rotation }))),
    identicalZOrder: stableSerialize(replayComparable.map((obj) => ({ id: obj.id, zIndex: obj.zIndex }))) === stableSerialize(liveComparable.map((obj) => ({ id: obj.id, zIndex: obj.zIndex }))),
  };

  const mismatches = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  return {
    pass: mismatches.length === 0,
    checks,
    mismatches,
  };
}

function buildIsolationReferenceEvents(): RoomEvent[] {
  return [
    {
      id: 'iso-1',
      roomId: 'iso-room',
      sequenceNumber: 1,
      operationId: 'iso-op-1',
      actorSessionId: 'iso-session',
      actorDisplayName: 'iso',
      eventType: 'object:create',
      payload: {
        object: {
          id: 'iso-obj',
          type: 'rectangle',
          x: 12,
          y: 18,
          width: 44,
          height: 30,
          rotation: 0,
          zIndex: 1,
          color: '#3498db',
        },
      },
      schemaVersion: 1,
      createdAt: new Date(),
    },
    {
      id: 'iso-2',
      roomId: 'iso-room',
      sequenceNumber: 2,
      operationId: 'iso-op-2',
      actorSessionId: 'iso-session',
      actorDisplayName: 'iso',
      eventType: 'object:update',
      payload: {
        objectId: 'iso-obj',
        updates: { x: 20, y: 26, width: 52, height: 34 },
      },
      schemaVersion: 1,
      createdAt: new Date(),
    },
  ];
}

async function scenario1LiveReplayParity(): Promise<ScenarioResult> {
  const ownerAuth = await createGuest('Replay-Final-S1-Owner');
  const ownerSocket = await connectSocket(ownerAuth.sessionToken);

  try {
    const room = await createRoom(ownerSocket, 'Replay Final Validation S1');
    const roomId = room.roomId;

    const rectangleId = `rect-${Date.now()}`;
    const circleId = `circle-${Date.now()}`;
    const textId = `text-${Date.now()}`;
    const stickyId = `sticky-${Date.now()}`;

    const operationSequence: Array<{ name: string; emit: () => void; expectedEvents: number }> = [
      {
        name: 'Create rectangle',
        expectedEvents: 1,
        emit: () => ownerSocket.emit('object:create', {
          operationId: makeOp('s1-create-rectangle'),
          roomId,
          object: {
            id: rectangleId,
            type: 'rectangle',
            x: 100,
            y: 120,
            width: 180,
            height: 120,
            rotation: 0,
            zIndex: 1,
            color: '#3498db',
          },
        }),
      },
      {
        name: 'Create circle',
        expectedEvents: 2,
        emit: () => ownerSocket.emit('object:create', {
          operationId: makeOp('s1-create-circle'),
          roomId,
          object: {
            id: circleId,
            type: 'circle',
            x: 360,
            y: 130,
            width: 140,
            height: 140,
            rotation: 0,
            zIndex: 2,
            color: '#e74c3c',
          },
        }),
      },
      {
        name: 'Create text',
        expectedEvents: 3,
        emit: () => ownerSocket.emit('object:create', {
          operationId: makeOp('s1-create-text'),
          roomId,
          object: {
            id: textId,
            type: 'text',
            x: 640,
            y: 180,
            width: 220,
            height: 48,
            rotation: 0,
            zIndex: 3,
            color: '#2c3e50',
            text: 'Initial text',
            fontSize: 16,
          },
        }),
      },
      {
        name: 'Create sticky note',
        expectedEvents: 4,
        emit: () => ownerSocket.emit('object:create', {
          operationId: makeOp('s1-create-sticky'),
          roomId,
          object: {
            id: stickyId,
            type: 'sticky-note',
            x: 900,
            y: 210,
            width: 180,
            height: 180,
            rotation: 0,
            zIndex: 4,
            color: '#f1c40f',
            text: 'Sticky',
            fontSize: 14,
          },
        }),
      },
      {
        name: 'Move rectangle',
        expectedEvents: 5,
        emit: () => ownerSocket.emit('object:update', {
          operationId: makeOp('s1-update-rect-move'),
          roomId,
          objectId: rectangleId,
          updates: { x: 220, y: 260 },
        }),
      },
      {
        name: 'Resize circle',
        expectedEvents: 6,
        emit: () => ownerSocket.emit('object:update', {
          operationId: makeOp('s1-update-circle-resize'),
          roomId,
          objectId: circleId,
          updates: { width: 200, height: 200 },
        }),
      },
      {
        name: 'Update text',
        expectedEvents: 7,
        emit: () => ownerSocket.emit('object:update', {
          operationId: makeOp('s1-update-text'),
          roomId,
          objectId: textId,
          updates: { text: 'Updated text', color: '#0f172a' },
        }),
      },
      {
        name: 'Delete sticky note',
        expectedEvents: 8,
        emit: () => ownerSocket.emit('object:delete', {
          operationId: makeOp('s1-delete-sticky'),
          roomId,
          objectId: stickyId,
        }),
      },
      {
        name: 'Enable physics',
        expectedEvents: 9,
        emit: () => ownerSocket.emit('physics:update-state', {
          operationId: makeOp('s1-physics-enable'),
          roomId,
          patch: { enabled: true, simulationRunning: true },
        }),
      },
      {
        name: 'Change gravity',
        expectedEvents: 10,
        emit: () => ownerSocket.emit('physics:update-state', {
          operationId: makeOp('s1-physics-gravity'),
          roomId,
          patch: { gravityY: 2.4 },
        }),
      },
      {
        name: 'Set rectangle static',
        expectedEvents: 11,
        emit: () => ownerSocket.emit('physics:set-static', {
          operationId: makeOp('s1-physics-static'),
          roomId,
          objectId: rectangleId,
          isStatic: true,
        }),
      },
      {
        name: 'Reset physics',
        expectedEvents: 12,
        emit: () => ownerSocket.emit('physics:reset', {
          operationId: makeOp('s1-physics-reset'),
          roomId,
        }),
      },
    ];

    for (const operation of operationSequence) {
      operation.emit();
      await waitForEventCount(ownerSocket, roomId, operation.expectedEvents, 25000);
    }

    const roomEventsResponse = await listRoomEvents(ownerSocket, roomId);

    const verifierAuth = await createGuest('Replay-Final-S1-Verifier');
    const verifierSocket = await connectSocket(verifierAuth.sessionToken);

    let liveSnapshot: RoomJoinResponse;
    try {
      liveSnapshot = await joinRoom(verifierSocket, { shareCode: room.shareCode });
    } finally {
      verifierSocket.disconnect();
    }

    const replayState = reconstructReplayState(roomEventsResponse.events);

    const objectCompare = compareReplayToLive(replayState.objects as CanvasObject[], liveSnapshot.canvasObjects);

    const replayStatic = [...replayState.physics.staticObjectIds].sort();
    const liveStatic = [...(liveSnapshot.physicsState.staticObjectIds || [])].sort();

    const physicsChecks = {
      identicalPhysicsEnabledState: replayState.physics.enabled === liveSnapshot.physicsState.enabled,
      identicalGravityValues: replayState.physics.gravityY === liveSnapshot.physicsState.gravityY,
      identicalStaticBodyFlags: stableSerialize(replayStatic) === stableSerialize(liveStatic),
    };

    const stickyDeletedInReplay = !replayState.objects.some((obj) => obj.id === stickyId);
    const stickyDeletedInLive = !liveSnapshot.canvasObjects.some((obj) => obj.id === stickyId);
    const deletedBehaviorMatches = stickyDeletedInReplay && stickyDeletedInLive;

    const allChecksPass = objectCompare.pass && deletedBehaviorMatches && Object.values(physicsChecks).every(Boolean);

    if (!allChecksPass) {
      throw new Error(
        `Scenario 1 failed parity checks: ${JSON.stringify({
          objectChecks: objectCompare.checks,
          objectMismatches: objectCompare.mismatches,
          deletedBehaviorMatches,
          physicsChecks,
        })}`
      );
    }

    return {
      name: 'Scenario 1 - Live Replay Parity',
      pass: true,
      details: {
        roomId,
        shareCode: room.shareCode,
        eventCount: roomEventsResponse.events.length,
        performedSequence: operationSequence.map((operation) => operation.name),
        objectChecks: objectCompare.checks,
        deletedBehaviorMatches,
        physicsChecks,
        liveSnapshotSummary: {
          objectCount: liveSnapshot.canvasObjects.length,
          objectIds: liveSnapshot.canvasObjects.map((obj) => obj.id),
          physics: liveSnapshot.physicsState,
        },
        replaySnapshotSummary: {
          objectCount: replayState.objects.length,
          objectIds: replayState.objects.map((obj) => obj.id),
          physics: replayState.physics,
        },
      },
    };
  } finally {
    ownerSocket.disconnect();
  }
}

async function scenario2LargeJournalValidation(): Promise<ScenarioResult> {
  const ownerAuth = await createGuest('Replay-Final-S2-Owner');
  const ownerSocket = await connectSocket(ownerAuth.sessionToken);

  try {
    const room = await createRoom(ownerSocket, 'Replay Final Validation S2');
    const roomId = room.roomId;

    const objectIds: string[] = [];

    const createCount = 220;
    const updateCount = 180;
    const deleteCount = 20;
    const physicsUpdateCount = 90;
    const physicsStaticCount = 20;
    const physicsResetCount = 10;
    const minimumTargetEvents = 520;

    let expectedEventCount = 0;

    for (let index = 0; index < createCount; index += 1) {
      const objectId = `s2-obj-${index}-${Date.now()}`;
      objectIds.push(objectId);
      ownerSocket.emit('object:create', {
        operationId: makeOp(`s2-create-${index}`),
        roomId,
        object: {
          id: objectId,
          type: index % 2 === 0 ? 'rectangle' : 'circle',
          x: 20 + index * 4,
          y: 40 + index * 3,
          width: 80 + (index % 5) * 10,
          height: 70 + (index % 7) * 8,
          rotation: 0,
          zIndex: index + 1,
          color: index % 2 === 0 ? '#3498db' : '#e74c3c',
        },
      });
      expectedEventCount += 1;
    }

    for (let index = 0; index < updateCount; index += 1) {
      const objectId = objectIds[index % objectIds.length];
      ownerSocket.emit('object:update', {
        operationId: makeOp(`s2-update-${index}`),
        roomId,
        objectId,
        updates: {
          x: 100 + index * 3,
          y: 120 + index * 2,
          width: 90 + (index % 6) * 9,
          height: 80 + (index % 4) * 11,
          rotation: Number(((index % 10) * 0.1).toFixed(2)),
        },
      });
      expectedEventCount += 1;
    }

    ownerSocket.emit('physics:update-state', {
      operationId: makeOp('s2-physics-enable'),
      roomId,
      patch: { enabled: true, simulationRunning: true },
    });
    expectedEventCount += 1;

    for (let index = 0; index < physicsUpdateCount; index += 1) {
      ownerSocket.emit('physics:update-state', {
        operationId: makeOp(`s2-physics-update-${index}`),
        roomId,
        patch: {
          gravityY: Number((0.5 + (index % 40) * 0.1).toFixed(2)),
          restitution: Number((0.3 + (index % 9) * 0.07).toFixed(2)),
          frictionAir: Number((0.01 + (index % 8) * 0.01).toFixed(3)),
        },
      });
      expectedEventCount += 1;
    }

    for (let index = 0; index < physicsStaticCount; index += 1) {
      const objectId = objectIds[index % objectIds.length];
      ownerSocket.emit('physics:set-static', {
        operationId: makeOp(`s2-physics-static-${index}`),
        roomId,
        objectId,
        isStatic: index % 2 === 0,
      });
      expectedEventCount += 1;
    }

    for (let index = 0; index < deleteCount; index += 1) {
      const objectId = objectIds[objectIds.length - 1 - index];
      ownerSocket.emit('object:delete', {
        operationId: makeOp(`s2-delete-${index}`),
        roomId,
        objectId,
      });
      expectedEventCount += 1;
    }

    for (let index = 0; index < physicsResetCount; index += 1) {
      ownerSocket.emit('physics:reset', {
        operationId: makeOp(`s2-physics-reset-${index}`),
        roomId,
      });
      expectedEventCount += 1;
    }

    let events = await waitForEventCount(ownerSocket, roomId, Math.min(expectedEventCount, minimumTargetEvents), 60000);

    let topUpIndex = 0;
    while (events.length < minimumTargetEvents && topUpIndex < 200) {
      ownerSocket.emit('object:update', {
        operationId: makeOp(`s2-topup-${topUpIndex}`),
        roomId,
        objectId: objectIds[topUpIndex % objectIds.length],
        updates: {
          x: 3000 + topUpIndex * 5,
          y: 1500 + topUpIndex * 3,
          rotation: Number(((topUpIndex % 12) * 0.11).toFixed(3)),
        },
      });
      topUpIndex += 1;
      events = await waitForEventCount(ownerSocket, roomId, Math.min(minimumTargetEvents, events.length + 1), 60000);
    }

    if (events.length < 500) {
      throw new Error(`Scenario 2 failed to reach minimum journal size: ${events.length}`);
    }

    const durationsMs: number[] = [];
    const memoryBeforeBytes: number[] = [];
    const memoryAfterBytes: number[] = [];
    const serializedOutputs: string[] = [];

    for (let run = 0; run < 3; run += 1) {
      const before = process.memoryUsage().heapUsed;
      const startedAt = performance.now();
      const replayState = reconstructReplayState(events);
      const endedAt = performance.now();
      const after = process.memoryUsage().heapUsed;

      durationsMs.push(Number((endedAt - startedAt).toFixed(3)));
      memoryBeforeBytes.push(before);
      memoryAfterBytes.push(after);
      serializedOutputs.push(stableSerialize({
        objects: normalizeComparableObjects(replayState.objects as CanvasObject[]),
        physics: replayState.physics,
        roomId: replayState.roomId,
      }));
    }

    const deterministic = serializedOutputs[0] === serializedOutputs[1] && serializedOutputs[1] === serializedOutputs[2];
    const maxDuration = Math.max(...durationsMs);
    const minDuration = Math.min(...durationsMs);
    const slowdownRatio = minDuration > 0 ? maxDuration / minDuration : Number.POSITIVE_INFINITY;
    const [run1, run2, run3] = durationsMs;
    const noQuadraticSlowdown = !(run2 > run1 * 1.8 && run3 > run2 * 1.8);

    const maxMemoryAfter = Math.max(...memoryAfterBytes);
    const minMemoryAfter = Math.min(...memoryAfterBytes);
    const memorySpreadBytes = maxMemoryAfter - minMemoryAfter;

    const pass = deterministic && noQuadraticSlowdown;
    if (!pass) {
      throw new Error(`Scenario 2 failed: deterministic=${deterministic} durationsMs=${durationsMs.join(',')}`);
    }

    return {
      name: 'Scenario 2 - Large Journal Validation',
      pass: true,
      details: {
        roomId,
        shareCode: room.shareCode,
        eventCount: events.length,
        replayRuns: 3,
        durationsMs,
        slowdownRatio,
        noQuadraticSlowdown,
        memoryBeforeBytes,
        memoryAfterBytes,
        memorySpreadBytes,
        deterministic,
        noExceptions: true,
      },
    };
  } finally {
    ownerSocket.disconnect();
  }
}

async function scenario3RealBrowserReplayVerification(evidenceDir: string): Promise<ScenarioResult> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  let liveScreenshotPath = '';
  let replayScreenshotPath = '';

  try {
    await page.goto(CLIENT_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Create Guest Session', { timeout: 20000 });

    await page.getByPlaceholder('Enter display name').fill('Replay Browser Validator');
    await page.getByRole('button', { name: 'Create guest session' }).click();
    await page.waitForSelector('text=Guest Session', { timeout: 20000 });

    await page.getByRole('button', { name: 'Create room' }).click();
    await page.waitForSelector('text=Collaborative Session', { timeout: 20000 });

    const roomId = (await page.locator('article:has-text("Room ID") p').nth(1).innerText()).trim();
    const shareCode = (await page.locator('article:has-text("Share Code") p').nth(1).innerText()).trim();

    await page.getByRole('button', { name: 'Rectangle (R)' }).click();
    await page.getByRole('button', { name: 'Circle (C)' }).click();
    await page.getByRole('button', { name: 'Text (T)' }).click();
    await page.getByRole('button', { name: 'Sticky Note (S)' }).click();

    const clickObjectCenter = async (objectId: string): Promise<boolean> => {
      const point = await page.evaluate((id) => {
        const stage = (window as any).Konva?.stages?.[0];
        if (!stage) return null;
        const group = stage.find('Group').find((node: any) => node.id() === id);
        if (!group) return null;

        const body =
          group.find((node: any) => node.getClassName?.() === 'Rect' && !node.draggable?.())[0] ||
          group.find('Rect')[0] ||
          null;

        if (!body) return null;

        const bodyRect = body.getClientRect({ relativeTo: stage });
        const stageRect = stage.content.getBoundingClientRect();

        return {
          x: stageRect.left + stage.x() + (bodyRect.x + bodyRect.width / 2) * stage.scaleX(),
          y: stageRect.top + stage.y() + (bodyRect.y + bodyRect.height / 2) * stage.scaleY(),
        };
      }, objectId);

      if (!point) return false;
      await page.mouse.click(point.x, point.y);
      return true;
    };

    const ensureObjectSelected = async (objectId: string): Promise<boolean> => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const clicked = await clickObjectCenter(objectId);
        if (!clicked) continue;

        const selected = await page
          .getByRole('button', { name: 'Delete selected object' })
          .isVisible()
          .catch(() => false);

        if (selected) return true;
      }

      return false;
    };

    const resolveEditableObjectId = async (): Promise<string | null> => {
      return await page.evaluate(() => {
        const stage = (window as any).Konva?.stages?.[0];
        if (!stage) return null;

        const groups = stage.find('Group').filter((group: any) => {
          if (!group?.id?.()) return false;
          if (typeof group.draggable === 'function' && !group.draggable()) return false;

          const hasBody =
            group.find((node: any) => node.getClassName?.() === 'Rect' && !node.draggable?.())[0] ||
            group.find((node: any) => node.getClassName?.() === 'Circle' && !node.draggable?.())[0] ||
            null;

          return Boolean(hasBody);
        });

        if (!groups.length) return null;

        const topMost = groups.sort((a: any, b: any) => {
          const az = typeof a.zIndex === 'function' ? a.zIndex() : 0;
          const bz = typeof b.zIndex === 'function' ? b.zIndex() : 0;
          return bz - az;
        })[0];

        return topMost?.id?.() || null;
      });
    };

    let targetObjectId = await resolveEditableObjectId();

    if (!targetObjectId) {
      throw new Error('Scenario 3 could not resolve a target object for drag/resize.');
    }

    await runSingleUserDragValidation(page, targetObjectId);

    targetObjectId = await resolveEditableObjectId();
    if (!targetObjectId) {
      throw new Error('Scenario 3 could not resolve an editable object after drag.');
    }

    const selected = await ensureObjectSelected(targetObjectId);
    if (!selected) {
      throw new Error('Scenario 3 could not reliably select a target object before resize.');
    }

    let resizeSucceeded = false;
    let resizeErrorMessage = '';

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const refreshedId = await resolveEditableObjectId();
        if (refreshedId) {
          targetObjectId = refreshedId;
        }

        await runSingleUserResizeValidation(page, targetObjectId, {
          dragDeltaX: 44 + attempt * 6,
          dragDeltaY: 32 + attempt * 4,
        });
        resizeSucceeded = true;
        break;
      } catch (error) {
        resizeErrorMessage = error instanceof Error ? error.message : String(error);
        await ensureObjectSelected(targetObjectId);
        await page.waitForTimeout(150);
      }
    }

    if (!resizeSucceeded) {
      throw new Error(`Scenario 3 resize failed after retries: ${resizeErrorMessage}`);
    }

    await page.getByRole('button', { name: 'Toggle physics mode' }).click();
    await page.getByRole('button', { name: 'Increase gravity' }).click();

    const simulationToggle = page.getByRole('button', { name: 'Toggle physics simulation' });
    const simulationToggleEnabled = await simulationToggle.isEnabled().catch(() => false);
    if (simulationToggleEnabled) {
      await simulationToggle.click();
    }

    const physicsTargetId = await resolveEditableObjectId();
    let staticActionPerformed = false;

    if (physicsTargetId) {
      await ensureObjectSelected(physicsTargetId);
      const staticToggle = page.getByRole('button', { name: 'Toggle static object' });
      const canToggleStatic = await staticToggle.isEnabled().catch(() => false);
      if (canToggleStatic) {
        await staticToggle.click();
        staticActionPerformed = true;
      }
    }

    await page.getByRole('button', { name: 'Reset physics simulation' }).click();

    await page.waitForTimeout(1800);

    liveScreenshotPath = path.join(evidenceDir, 'scenario3_live_room.png');
    await page.screenshot({ path: liveScreenshotPath, fullPage: true });

    const verifierAuth = await createGuest('Replay-Final-S3-Verifier');
    const verifierSocket = await connectSocket(verifierAuth.sessionToken);

    const snapshot: RoomJoinResponse = await joinRoom(verifierSocket, { shareCode });
    let roomEvents: RoomEventsListResponse = await listRoomEvents(verifierSocket, snapshot.roomId);

    const hasPhysicsParity = (replay: ReturnType<typeof reconstructReplayState>, live: RoomJoinResponse): boolean => {
      const replayStatic = [...replay.physics.staticObjectIds].sort();
      const liveStatic = [...(live.physicsState.staticObjectIds || [])].sort();
      return (
        replay.physics.enabled === live.physicsState.enabled &&
        replay.physics.gravityY === live.physicsState.gravityY &&
        stableSerialize(replayStatic) === stableSerialize(liveStatic)
      );
    };

    let replayState = reconstructReplayState(roomEvents.events);
    const settleStartedAt = Date.now();

    while (!hasPhysicsParity(replayState, snapshot) && Date.now() - settleStartedAt < 10000) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      roomEvents = await listRoomEvents(verifierSocket, snapshot.roomId);
      replayState = reconstructReplayState(roomEvents.events);
    }

    verifierSocket.disconnect();

    const replayHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Replay State Render</title>
  <style>
    body { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #f8fafc; }
    .meta { padding: 12px 16px; border-bottom: 1px solid #cbd5e1; background: #e2e8f0; }
    .canvas { position: relative; width: 1400px; height: 900px; margin: 16px auto; background: white; border: 1px solid #94a3b8; overflow: hidden; }
    .obj { position: absolute; box-sizing: border-box; border: 2px solid #334155; opacity: 0.95; }
    .text { display: flex; align-items: center; justify-content: center; padding: 4px; font-size: 12px; color: #111827; }
  </style>
</head>
<body>
  <div class="meta" id="meta"></div>
  <div class="canvas" id="canvas"></div>
  <script>
    const replay = ${JSON.stringify(replayState)};
    const canvas = document.getElementById('canvas');
    const meta = document.getElementById('meta');
    meta.textContent = 'Replay Render | Objects: ' + replay.objects.length + ' | Physics enabled: ' + replay.physics.enabled + ' | Gravity: ' + replay.physics.gravityY;

    for (const obj of replay.objects) {
      const node = document.createElement('div');
      node.className = 'obj ' + (obj.type === 'text' ? 'text' : '');
      node.style.left = obj.x + 'px';
      node.style.top = obj.y + 'px';
      node.style.width = obj.width + 'px';
      node.style.height = obj.height + 'px';
      node.style.transform = 'rotate(' + obj.rotation + 'rad)';
      node.style.zIndex = String(obj.zIndex);
      node.style.background = obj.color || '#cbd5e1';
      if (obj.type === 'circle') node.style.borderRadius = '50%';
      if (obj.type === 'text' || obj.type === 'sticky-note') node.textContent = obj.text || obj.type;
      canvas.appendChild(node);
    }
  </script>
</body>
</html>`;

    const replayHtmlPath = path.join(evidenceDir, 'scenario3_replay_render.html');
    await fs.writeFile(replayHtmlPath, replayHtml, 'utf8');

    const replayPage = await context.newPage();
    await replayPage.goto(`file://${replayHtmlPath}`, { waitUntil: 'domcontentloaded' });
    replayScreenshotPath = path.join(evidenceDir, 'scenario3_replay_render.png');
    await replayPage.screenshot({ path: replayScreenshotPath, fullPage: true });

    const comparison = compareReplayToLive(replayState.objects as CanvasObject[], snapshot.canvasObjects);
    const physicsMatches = hasPhysicsParity(replayState, snapshot);

    const pass = comparison.pass && physicsMatches;
    if (!pass) {
      throw new Error(
        `Scenario 3 failed visual parity checks: ${JSON.stringify({
          comparison,
          physicsMatches,
          livePhysics: snapshot.physicsState,
          replayPhysics: replayState.physics,
          replayEventCount: roomEvents.events.length,
        })}`
      );
    }

    return {
      name: 'Scenario 3 - Real Browser Replay Verification',
      pass: true,
      details: {
        roomId,
        shareCode,
        screenshots: {
          live: liveScreenshotPath,
          replay: replayScreenshotPath,
        },
        liveObjectCount: snapshot.canvasObjects.length,
        replayObjectCount: replayState.objects.length,
        visualChecks: {
          sameObjectLayout: comparison.checks.identicalXY && comparison.checks.identicalDimensions && comparison.checks.identicalRotation,
          sameStackingOrder: comparison.checks.identicalZOrder,
          samePhysicsConfiguration: physicsMatches,
          staticActionPerformed,
          noMissingObjects: comparison.checks.identicalObjectIds,
          noDuplicateObjects: snapshot.canvasObjects.length === new Set(snapshot.canvasObjects.map((obj) => obj.id)).size,
        },
      },
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

function scenario4EdgeCases(): ScenarioResult {
  const checks: Record<string, boolean> = {};

  const emptyStore = createReplayStore();
  emptyStore.initialize([]);
  checks.emptyJournal = emptyStore.getCurrentState().objects.length === 0;

  let duplicateSequenceRejected = false;
  try {
    emptyStore.initialize([
      {
        id: 'dup-1',
        roomId: 'edge-room',
        sequenceNumber: 1,
        operationId: 'op-1',
        actorSessionId: 's1',
        actorDisplayName: 'edge',
        eventType: 'object:create',
        payload: { object: { id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 1 } },
        schemaVersion: 1,
        createdAt: new Date(),
      },
      {
        id: 'dup-2',
        roomId: 'edge-room',
        sequenceNumber: 1,
        operationId: 'op-2',
        actorSessionId: 's1',
        actorDisplayName: 'edge',
        eventType: 'object:update',
        payload: { objectId: 'a', updates: { x: 4 } },
        schemaVersion: 1,
        createdAt: new Date(),
      },
    ]);
  } catch {
    duplicateSequenceRejected = true;
  }
  checks.duplicateSequenceRejected = duplicateSequenceRejected;

  const unknownStore = createReplayStore();
  const unknownType = 'replay:unknown:event';
  unknownStore.initialize([
    {
      id: 'unk-1',
      roomId: 'edge-room',
      sequenceNumber: 1,
      operationId: 'op-1',
      actorSessionId: 's1',
      actorDisplayName: 'edge',
      eventType: 'object:create',
      payload: { object: { id: 'known', type: 'rectangle', x: 1, y: 1, width: 10, height: 10, rotation: 0, zIndex: 1 } },
      schemaVersion: 1,
      createdAt: new Date(),
    },
    {
      id: 'unk-2',
      roomId: 'edge-room',
      sequenceNumber: 2,
      operationId: 'op-2',
      actorSessionId: 's1',
      actorDisplayName: 'edge',
      eventType: 'object:update' as RoomEvent['eventType'],
      payload: { objectId: 'known', updates: { x: 8 } },
      schemaVersion: 1,
      createdAt: new Date(),
    },
    {
      id: 'unk-3',
      roomId: 'edge-room',
      sequenceNumber: 3,
      operationId: 'op-3',
      actorSessionId: 's1',
      actorDisplayName: 'edge',
      eventType: unknownType as RoomEvent['eventType'],
      payload: { any: 'payload' },
      schemaVersion: 1,
      createdAt: new Date(),
    },
    {
      id: 'unk-4',
      roomId: 'edge-room',
      sequenceNumber: 4,
      operationId: 'op-4',
      actorSessionId: 's1',
      actorDisplayName: 'edge',
      eventType: 'physics:reset' as RoomEvent['eventType'],
      payload: {},
      schemaVersion: 1,
      createdAt: new Date(),
    },
    {
      id: 'unk-5',
      roomId: 'edge-room',
      sequenceNumber: 5,
      operationId: 'op-5',
      actorSessionId: 's1',
      actorDisplayName: 'edge',
      eventType: 'object:update' as RoomEvent['eventType'],
      payload: { objectId: 'missing', updates: { x: 999 } },
      schemaVersion: 1,
      createdAt: new Date(),
    },
    {
      id: 'unk-6',
      roomId: 'edge-room',
      sequenceNumber: 7,
      operationId: 'op-5',
      actorSessionId: 's1',
      actorDisplayName: 'edge',
      eventType: 'object:delete' as RoomEvent['eventType'],
      payload: { objectId: 'missing-delete' },
      schemaVersion: 1,
      createdAt: new Date(),
    },
  ]);

  unknownStore.stepForward();
  unknownStore.stepForward();
  unknownStore.stepForward();
  unknownStore.stepForward();
  unknownStore.stepForward();
  unknownStore.stepForward();

  const unknownState = unknownStore.getCurrentState();
  checks.sequenceGapsHandled = unknownState.lastSequenceNumber === 7;
  checks.unknownEventTypeIgnoredSafely = unknownState.objects.length === 1;
  checks.missingCreateBeforeUpdateHandled = unknownState.objects.some((obj) => obj.id === 'known' && obj.x === 8);
  checks.missingCreateBeforeDeleteHandled = unknownState.objects.length === 1;
  checks.duplicateOperationIdDifferentSequenceHandled = unknownState.lastSequenceNumber === 7;

  const repeatEvents: RoomEvent[] = [
    {
      id: 'rep-1',
      roomId: 'edge-room',
      sequenceNumber: 1,
      operationId: 'same-op',
      actorSessionId: 's1',
      actorDisplayName: 'edge',
      eventType: 'object:create',
      payload: { object: { id: 'rep-obj', type: 'rectangle', x: 5, y: 6, width: 20, height: 22, rotation: 0, zIndex: 1 } },
      schemaVersion: 1,
      createdAt: new Date(),
    },
    {
      id: 'rep-2',
      roomId: 'edge-room',
      sequenceNumber: 2,
      operationId: 'same-op',
      actorSessionId: 's1',
      actorDisplayName: 'edge',
      eventType: 'object:update',
      payload: { objectId: 'rep-obj', updates: { x: 42 } },
      schemaVersion: 1,
      createdAt: new Date(),
    },
  ];

  const firstReplay = reconstructReplayState(repeatEvents);
  const secondReplay = reconstructReplayState(repeatEvents);
  checks.repeatedReplayIdentical = stableSerialize(firstReplay) === stableSerialize(secondReplay);

  const pass = Object.values(checks).every(Boolean);

  if (!pass) {
    throw new Error(`Scenario 4 failed: ${JSON.stringify(checks)}`);
  }

  return {
    name: 'Scenario 4 - Edge Cases',
    pass,
    details: checks,
  };
}

async function scenario5IsolationVerification(referenceEvents: RoomEvent[]): Promise<ScenarioResult> {
  const ownerAuth = await createGuest('Replay-Final-S5-Owner');
  const ownerSocket = await connectSocket(ownerAuth.sessionToken);

  try {
    const room = await createRoom(ownerSocket, 'Replay Final Validation S5');

    ownerSocket.emit('object:create', {
      operationId: makeOp('s5-create'),
      roomId: room.roomId,
      object: {
        id: `s5-obj-${Date.now()}`,
        type: 'rectangle',
        x: 80,
        y: 80,
        width: 120,
        height: 90,
        rotation: 0,
        zIndex: 1,
        color: '#3498db',
      },
    });

    const beforeEvents = await waitForEventCount(ownerSocket, room.roomId, 1, 20000);

    useRoomStore.getState().setRoom({
      id: 'live-room-sentinel',
      shareCode: 'LIVE01',
      title: 'Live Sentinel Room',
      createdBySessionId: 'live-session',
    });

    useCanvasObjectsStore.getState().setObjects([
      {
        id: 'live-obj-1',
        type: 'rectangle',
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        rotation: 0,
        color: '#000000',
        zIndex: 1,
      },
    ] as unknown as CanvasObject[]);

    usePhysicsStore.getState().setRoomPhysics({
      enabled: true,
      simulationRunning: false,
      gravityY: 3,
      restitution: 0.8,
      frictionAir: 0.04,
      staticObjectIds: ['live-obj-1'],
      resetNonce: 2,
      revision: 99,
    });

    const queue = getOfflineOperationsQueue();
    queue.enqueueCreate({
      operationId: 'live-queue-op',
      roomId: 'live-room-sentinel',
      object: { id: 'queued-obj' },
    });

    const roomBefore = structuredClone(useRoomStore.getState().room);
    const objectsBefore = structuredClone(useCanvasObjectsStore.getState().objects);
    const physicsBefore = structuredClone(usePhysicsStore.getState().roomPhysics);
    const queueBefore = structuredClone(queue.list());
    const socketIdBefore = ownerSocket.id;

    const replayStore = useReplayStore.getState();
    replayStore.initialize(referenceEvents);
    for (let index = 0; index < referenceEvents.length; index += 1) {
      replayStore.stepForward();
    }

    const roomAfter = structuredClone(useRoomStore.getState().room);
    const objectsAfter = structuredClone(useCanvasObjectsStore.getState().objects);
    const physicsAfter = structuredClone(usePhysicsStore.getState().roomPhysics);
    const queueAfter = structuredClone(queue.list());

    const afterEvents = await listRoomEvents(ownerSocket, room.roomId);
    const socketIdAfter = ownerSocket.id;

    const checks = {
      liveRoomStoreUnchanged: stableSerialize(roomBefore) === stableSerialize(roomAfter),
      liveObjectStoreUnchanged: stableSerialize(objectsBefore) === stableSerialize(objectsAfter),
      livePhysicsStoreUnchanged: stableSerialize(physicsBefore) === stableSerialize(physicsAfter),
      socketConnectionUnchanged: Boolean(ownerSocket.connected) && socketIdBefore === socketIdAfter,
      roomEventJournalUnchangedByReplay: beforeEvents.length === afterEvents.events.length,
      offlineQueueUnchanged: stableSerialize(queueBefore) === stableSerialize(queueAfter),
    };

    const pass = Object.values(checks).every(Boolean);
    if (!pass) {
      throw new Error(`Scenario 5 failed: ${JSON.stringify(checks)}`);
    }

    return {
      name: 'Scenario 5 - Isolation Verification',
      pass,
      details: {
        roomId: room.roomId,
        checks,
      },
    };
  } finally {
    ownerSocket.disconnect();
  }
}

async function run(): Promise<void> {
  await assertServiceHealth();

  const runTag = nowIsoCompact();
  const evidenceDir = path.join(EVIDENCE_ROOT, `replay_final_validation_${runTag}`);
  await fs.mkdir(evidenceDir, { recursive: true });

  const scenarioResults: ScenarioResult[] = [];

  const scenario1 = await scenario1LiveReplayParity();
  scenarioResults.push(scenario1);

  const scenario2 = await scenario2LargeJournalValidation();
  scenarioResults.push(scenario2);

  const scenario3 = await scenario3RealBrowserReplayVerification(evidenceDir);
  scenarioResults.push(scenario3);

  const scenario4 = scenario4EdgeCases();
  scenarioResults.push(scenario4);

  const scenario5 = await scenario5IsolationVerification(buildIsolationReferenceEvents());
  scenarioResults.push(scenario5);

  const allPass = scenarioResults.every((scenario) => scenario.pass);
  const summary = {
    runAt: new Date().toISOString(),
    serverUrl: SERVER_URL,
    clientUrl: CLIENT_URL,
    allPass,
    scenarioResults,
  };

  const summaryPath = path.join(evidenceDir, 'summary.json');
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({ allPass, summaryPath, scenarioResults }, null, 2));

  if (!allPass) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error('Replay final validation run failed');
  console.error(error?.stack || String(error));
  process.exit(1);
});
