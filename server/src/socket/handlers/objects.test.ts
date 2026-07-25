import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  clearRoomObjects,
  getRoomObjects,
  initializeRoomObjects,
  registerObjectHandlers,
} from './objects.js';

class MockSocket extends EventEmitter {
  emitted: Array<{ event: string; payload: unknown }> = [];
  roomId?: string;

  override emit(event: string, ...args: unknown[]): boolean {
    if (event === 'error') {
      this.emitted.push({ event, payload: args[0] });
    }
    return super.emit(event, ...args);
  }
}

class MockIO extends EventEmitter {
  broadcasts: Array<{ roomId: string; event: string; payload: unknown }> = [];

  to(roomId: string) {
    return {
      emit: (event: string, payload: unknown) => {
        this.broadcasts.push({ roomId, event, payload });
      },
    };
  }
}

function setupConnection(roomId: string) {
  clearRoomObjects(roomId);
  initializeRoomObjects(roomId);

  const io = new MockIO();
  registerObjectHandlers(io as unknown as import('socket.io').Server);

  const socket = new MockSocket();
  socket.roomId = roomId;
  // Prevent Node EventEmitter from treating `error` as unhandled during tests.
  socket.on('error', () => {});

  io.emit('connection', socket as unknown);
  return { io, socket };
}

test('object:create stores object and broadcasts created payload with operationId', () => {
  const roomId = 'room-create';
  const { io, socket } = setupConnection(roomId);

  const object = { id: 'obj-1', x: 10, y: 20, type: 'rectangle' };
  socket.emit('object:create', {
    operationId: 'op-create-1',
    roomId,
    object,
  });

  const roomObjects = getRoomObjects(roomId);
  assert.equal(roomObjects.length, 1);
  assert.deepEqual(roomObjects[0], object);

  assert.equal(io.broadcasts.length, 1);
  assert.equal(io.broadcasts[0].event, 'object:created');
  assert.equal(io.broadcasts[0].roomId, roomId);
  const payload = io.broadcasts[0].payload as {
    operationId: string;
    object: Record<string, unknown>;
  };
  assert.equal(payload.operationId, 'op-create-1');
  assert.deepEqual(payload.object, object);
});

test('object:update mutates existing object and broadcasts update payload with operationId', () => {
  const roomId = 'room-update';
  const { io, socket } = setupConnection(roomId);

  socket.emit('object:create', {
    operationId: 'op-create-2',
    roomId,
    object: { id: 'obj-2', x: 5, y: 5, type: 'circle' },
  });

  io.broadcasts = [];

  socket.emit('object:update', {
    operationId: 'op-update-1',
    roomId,
    objectId: 'obj-2',
    updates: { x: 111, y: 222 },
  });

  const roomObjects = getRoomObjects(roomId);
  assert.equal(roomObjects.length, 1);
  assert.equal(roomObjects[0].x, 111);
  assert.equal(roomObjects[0].y, 222);

  assert.equal(io.broadcasts.length, 1);
  assert.equal(io.broadcasts[0].event, 'object:updated');
  const payload = io.broadcasts[0].payload as {
    operationId: string;
    objectId: string;
    updates: Record<string, unknown>;
  };
  assert.equal(payload.operationId, 'op-update-1');
  assert.equal(payload.objectId, 'obj-2');
  assert.deepEqual(payload.updates, { x: 111, y: 222 });
});

test('object:delete removes object and broadcasts deletion payload with operationId', () => {
  const roomId = 'room-delete';
  const { io, socket } = setupConnection(roomId);

  socket.emit('object:create', {
    operationId: 'op-create-3',
    roomId,
    object: { id: 'obj-3', x: 1, y: 2, type: 'text' },
  });

  io.broadcasts = [];

  socket.emit('object:delete', {
    operationId: 'op-delete-1',
    roomId,
    objectId: 'obj-3',
  });

  const roomObjects = getRoomObjects(roomId);
  assert.equal(roomObjects.length, 0);

  assert.equal(io.broadcasts.length, 1);
  assert.equal(io.broadcasts[0].event, 'object:deleted');
  const payload = io.broadcasts[0].payload as {
    operationId: string;
    objectId: string;
  };
  assert.equal(payload.operationId, 'op-delete-1');
  assert.equal(payload.objectId, 'obj-3');
});

test('late join hydration returns all existing room objects', () => {
  const roomId = 'room-hydration';
  const { socket } = setupConnection(roomId);

  socket.emit('object:create', {
    operationId: 'op-create-4',
    roomId,
    object: { id: 'obj-4', x: 10, y: 10, type: 'rectangle' },
  });

  socket.emit('object:create', {
    operationId: 'op-create-5',
    roomId,
    object: { id: 'obj-5', x: 20, y: 20, type: 'sticky-note' },
  });

  const snapshot = getRoomObjects(roomId);
  assert.equal(snapshot.length, 2);
  assert.deepEqual(
    snapshot.map((o) => o.id).sort(),
    ['obj-4', 'obj-5']
  );
});

test('unauthorized socket cannot create object in a different room', () => {
  const roomId = 'room-authorized';
  const { socket } = setupConnection(roomId);

  socket.emit('object:create', {
    operationId: 'op-create-unauth',
    roomId: 'room-other',
    object: { id: 'obj-x', x: 0, y: 0, type: 'rectangle' },
  });

  assert.equal(getRoomObjects(roomId).length, 0);
  assert.equal(socket.emitted.length, 1);
  assert.equal(socket.emitted[0].event, 'error');
  assert.deepEqual(socket.emitted[0].payload, {
    code: 'UNAUTHORIZED',
    message: 'Not a member of this room',
  });
});
