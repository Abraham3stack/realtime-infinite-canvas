import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Prisma } from '@prisma/client';
import { appendRoomEvent } from './roomEvents.js';
import { registerRoomEventHandlers } from '../socket/handlers/roomEvents.js';

class MockSocket extends EventEmitter {
  emitted: Array<{ event: string; payload: unknown }> = [];
  roomId?: string;
  sessionId?: string;
  displayName?: string;

  override emit(event: string, ...args: unknown[]): boolean {
    if (event === 'error') {
      this.emitted.push({ event, payload: args[0] });
    }
    return super.emit(event, ...args);
  }
}

class MockIO extends EventEmitter {
  to() {
    return {
      emit: () => {},
    };
  }
}

test('appendRoomEvent allocates monotonic sequence numbers and preserves payload', async () => {
  const state = {
    eventSequenceNumber: 0,
    events: [] as Array<Record<string, unknown>>,
  };

  const tx = {
    room: {
      update: async () => {
        state.eventSequenceNumber += 1;
        return { eventSequenceNumber: state.eventSequenceNumber };
      },
    },
    roomEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const created = {
          id: `event-${state.events.length + 1}`,
          createdAt: new Date('2026-07-26T12:00:00.000Z'),
          ...data,
        };
        state.events.push(created);
        return created;
      },
    },
  } as unknown as Prisma.TransactionClient;

  const first = await appendRoomEvent(tx, {
    roomId: '11111111-1111-4111-8111-111111111111',
    operationId: 'op-1',
    actorSessionId: '22222222-2222-4222-8222-222222222222',
    actorDisplayName: 'Alice',
    eventType: 'object:create',
    payload: { objectId: 'obj-1' },
  });

  const second = await appendRoomEvent(tx, {
    roomId: '11111111-1111-4111-8111-111111111111',
    operationId: 'op-2',
    actorSessionId: '22222222-2222-4222-8222-222222222222',
    actorDisplayName: 'Alice',
    eventType: 'physics:reset',
    payload: {},
  });

  assert.equal(first.sequenceNumber, 1);
  assert.equal(second.sequenceNumber, 2);
  assert.equal(first.roomId, '11111111-1111-4111-8111-111111111111');
  assert.equal(first.operationId, 'op-1');
  assert.deepEqual(first.payload, { objectId: 'obj-1' });
  assert.equal(first.schemaVersion, 1);
  assert.equal(second.eventType, 'physics:reset');
  assert.deepEqual(second.payload, {});
});

test('room:events:list returns ordered events for the active room', async () => {
  const io = new MockIO();
  const socket = new MockSocket();
  socket.roomId = '33333333-3333-4333-8333-333333333333';
  socket.sessionId = '44444444-4444-4444-8444-444444444444';
  socket.displayName = 'Alice';
  socket.on('error', () => {});

  registerRoomEventHandlers(io as unknown as import('socket.io').Server, async (_roomId, options) => ({
    roomId: '33333333-3333-4333-8333-333333333333',
    events: [
      {
        id: 'event-2',
        roomId: '33333333-3333-4333-8333-333333333333',
        sequenceNumber: (options.afterSequenceNumber ?? 0) + 2,
        operationId: 'op-2',
        actorSessionId: '44444444-4444-4444-8444-444444444444',
        actorDisplayName: 'Alice',
        eventType: 'object:update',
        payload: { x: 42 },
        schemaVersion: 1,
        createdAt: new Date('2026-07-26T12:01:00.000Z'),
      },
    ],
  }));

  io.emit('connection', socket as unknown);

  const response = await new Promise<Record<string, unknown>>((resolve) => {
    socket.emit('room:events:list', { roomId: '33333333-3333-4333-8333-333333333333', afterSequenceNumber: 1 }, (result: Record<string, unknown>) => {
      resolve(result);
    });
  });

  assert.equal(response.roomId, '33333333-3333-4333-8333-333333333333');
  assert.equal(Array.isArray(response.events), true);
  const event = (response.events as Array<Record<string, unknown>>)[0];
  assert.equal(event.sequenceNumber, 3);
  assert.equal(event.eventType, 'object:update');
  assert.deepEqual(event.payload, { x: 42 });
});

test('room:events:list rejects cross-room access', async () => {
  const io = new MockIO();
  const socket = new MockSocket();
  socket.roomId = '55555555-5555-4555-8555-555555555555';
  socket.sessionId = '66666666-6666-4666-8666-666666666666';
  socket.displayName = 'Alice';
  socket.on('error', () => {});

  registerRoomEventHandlers(io as unknown as import('socket.io').Server, async () => ({
    roomId: '55555555-5555-4555-8555-555555555555',
    events: [],
  }));

  io.emit('connection', socket as unknown);

  const response = await new Promise<Record<string, unknown>>((resolve) => {
    socket.emit('room:events:list', { roomId: '77777777-7777-4777-8777-777777777777' }, (result: Record<string, unknown>) => {
      resolve(result);
    });
  });

  assert.equal(response.code, 'UNAUTHORIZED');
  assert.deepEqual(response.events, []);
});
