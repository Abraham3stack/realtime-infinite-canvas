import test from 'node:test';
import assert from 'node:assert/strict';
import type { CanvasObject } from '../types/canvas.js';
import type { RoomEvent, RoomEventType } from '../types/events.js';
import { createReplayStore, reconstructReplayState } from './engine.js';

function makeObject(id: string, overrides: Partial<CanvasObject> = {}): CanvasObject {
  return {
    id,
    type: 'rectangle',
    x: 100,
    y: 120,
    width: 140,
    height: 90,
    rotation: 0,
    zIndex: 1,
    color: '#3498db',
    ...overrides,
  };
}

function makeEvent(params: {
  sequenceNumber: number;
  eventType: RoomEventType;
  payload: Record<string, unknown>;
  operationId?: string;
  roomId?: string;
}): RoomEvent {
  const seq = params.sequenceNumber;
  return {
    id: `event-${seq}`,
    roomId: params.roomId ?? 'room-replay',
    sequenceNumber: seq,
    operationId: params.operationId ?? `op-${seq}`,
    actorSessionId: '11111111-1111-4111-8111-111111111111',
    actorDisplayName: 'ReplayTester',
    eventType: params.eventType,
    payload: params.payload,
    schemaVersion: 1,
    createdAt: new Date(`2026-07-26T12:00:${String(seq).padStart(2, '0')}.000Z`),
  };
}

test('empty journal initializes deterministic empty replay state', () => {
  const store = createReplayStore();
  store.initialize([]);

  const state = store.getCurrentState();
  assert.equal(state.objects.length, 0);
  assert.equal(state.appliedEventCount, 0);
  assert.equal(state.lastSequenceNumber, null);
  assert.equal(state.physics.enabled, false);
  assert.equal(state.physics.gravityY, 1);
  assert.deepEqual(state.physics.staticObjectIds, []);
});

test('single create replays into one object', () => {
  const object = makeObject('obj-1');
  const events = [
    makeEvent({
      sequenceNumber: 1,
      eventType: 'object:create',
      payload: { object },
    }),
  ];

  const state = reconstructReplayState(events);
  assert.equal(state.objects.length, 1);
  assert.equal(state.objects[0]?.id, 'obj-1');
  assert.equal(state.objects[0]?.width, 140);
  assert.equal(state.lastSequenceNumber, 1);
});

test('create update delete lifecycle replays correctly', () => {
  const events = [
    makeEvent({ sequenceNumber: 1, eventType: 'object:create', payload: { object: makeObject('obj-1') } }),
    makeEvent({ sequenceNumber: 2, eventType: 'object:update', payload: { objectId: 'obj-1', updates: { x: 220, y: 260 } } }),
    makeEvent({ sequenceNumber: 3, eventType: 'object:delete', payload: { objectId: 'obj-1' } }),
  ];

  const state = reconstructReplayState(events);
  assert.equal(state.objects.length, 0);
  assert.equal(state.appliedEventCount, 3);
  assert.equal(state.lastSequenceNumber, 3);
});

test('multiple objects preserve deterministic z-order after replay', () => {
  const events = [
    makeEvent({ sequenceNumber: 1, eventType: 'object:create', payload: { object: makeObject('obj-a', { zIndex: 4 }) } }),
    makeEvent({ sequenceNumber: 2, eventType: 'object:create', payload: { object: makeObject('obj-b', { zIndex: 2 }) } }),
    makeEvent({ sequenceNumber: 3, eventType: 'object:update', payload: { objectId: 'obj-a', updates: { zIndex: 1 } } }),
    makeEvent({ sequenceNumber: 4, eventType: 'object:create', payload: { object: makeObject('obj-c', { zIndex: 3 }) } }),
  ];

  const state = reconstructReplayState(events);
  assert.deepEqual(
    state.objects.map((object) => ({ id: object.id, zIndex: object.zIndex })),
    [
      { id: 'obj-a', zIndex: 1 },
      { id: 'obj-b', zIndex: 2 },
      { id: 'obj-c', zIndex: 3 },
    ]
  );
});

test('physics events replay deterministically', () => {
  const events = [
    makeEvent({ sequenceNumber: 1, eventType: 'physics:update-state', payload: { patch: { enabled: true, simulationRunning: true } } }),
    makeEvent({ sequenceNumber: 2, eventType: 'physics:update-state', payload: { patch: { gravityY: 1.75, restitution: 0.82 } } }),
    makeEvent({ sequenceNumber: 3, eventType: 'physics:set-static', payload: { objectId: 'obj-a', isStatic: true } }),
    makeEvent({ sequenceNumber: 4, eventType: 'physics:reset', payload: {} }),
  ];

  const state = reconstructReplayState(events);
  assert.equal(state.physics.enabled, true);
  assert.equal(state.physics.simulationRunning, true);
  assert.equal(state.physics.gravityY, 1.75);
  assert.equal(state.physics.restitution, 0.82);
  assert.deepEqual(state.physics.staticObjectIds, ['obj-a']);
  assert.equal(state.physics.resetNonce, 1);
  assert.equal(state.physics.revision, 5);
});

test('reconnect-generated events remain deterministic by sequenceNumber only', () => {
  const events = [
    makeEvent({ sequenceNumber: 1, eventType: 'object:create', payload: { object: makeObject('obj-reconnect') }, operationId: 'op-connected-1' }),
    makeEvent({ sequenceNumber: 2, eventType: 'object:update', payload: { objectId: 'obj-reconnect', updates: { x: 300 } }, operationId: 'op-connected-2' }),
    makeEvent({ sequenceNumber: 3, eventType: 'physics:update-state', payload: { patch: { enabled: true } }, operationId: 'op-reconnected-1' }),
    makeEvent({ sequenceNumber: 4, eventType: 'physics:set-static', payload: { objectId: 'obj-reconnect', isStatic: true }, operationId: 'op-reconnected-2' }),
  ];

  const state = reconstructReplayState(events);
  assert.equal(state.objects[0]?.x, 300);
  assert.deepEqual(state.physics.staticObjectIds, ['obj-reconnect']);
  assert.equal(state.lastSequenceNumber, 4);
});

test('step forward/backward and reset provide stable deterministic snapshots', () => {
  const events = [
    makeEvent({ sequenceNumber: 1, eventType: 'object:create', payload: { object: makeObject('obj-steps') } }),
    makeEvent({ sequenceNumber: 2, eventType: 'object:update', payload: { objectId: 'obj-steps', updates: { x: 410 } } }),
  ];

  const store = createReplayStore();
  store.initialize(events);

  const initial = store.getCurrentState();
  assert.equal(initial.objects.length, 0);

  const step1 = store.stepForward();
  assert.equal(step1.objects.length, 1);
  assert.equal(step1.objects[0]?.x, 100);

  const step2 = store.stepForward();
  assert.equal(step2.objects[0]?.x, 410);

  const back = store.stepBackward();
  assert.equal(back.objects[0]?.x, 100);

  const reset = store.reset();
  assert.equal(reset.objects.length, 0);
});

test('replay output is identical across repeated runs with same event sequence', () => {
  const events = [
    makeEvent({ sequenceNumber: 1, eventType: 'object:create', payload: { object: makeObject('obj-repeat') } }),
    makeEvent({ sequenceNumber: 2, eventType: 'object:update', payload: { objectId: 'obj-repeat', updates: { width: 220, height: 110 } } }),
    makeEvent({ sequenceNumber: 3, eventType: 'physics:update-state', payload: { patch: { enabled: true, gravityY: 1.6 } } }),
    makeEvent({ sequenceNumber: 4, eventType: 'physics:reset', payload: {} }),
  ];

  const first = reconstructReplayState(events);
  const second = reconstructReplayState(events);

  assert.deepEqual(second, first);
});
