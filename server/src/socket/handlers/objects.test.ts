import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  createInMemoryObjectRepository,
  getRoomObjectsFromRepository,
  registerObjectHandlersWithRepository,
} from './objects.js';

class MockSocket extends EventEmitter {
  emitted: Array<{ event: string; payload: unknown }> = [];
  roomId?: string;
  sessionId?: string;

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
  const repository = createInMemoryObjectRepository();

  const io = new MockIO();
  registerObjectHandlersWithRepository(io as unknown as import('socket.io').Server, repository);

  const socket = new MockSocket();
  socket.roomId = roomId;
  socket.sessionId = 'session-test-1';
  // Prevent Node EventEmitter from treating `error` as unhandled during tests.
  socket.on('error', () => {});

  io.emit('connection', socket as unknown);
  return { io, socket, repository };
}

test('object:create stores object and broadcasts created payload with operationId', async () => {
  const roomId = 'room-create';
  const { io, socket, repository } = setupConnection(roomId);

  const object = {
    id: 'obj-1',
    x: 10,
    y: 20,
    type: 'rectangle',
    width: 100,
    height: 100,
    rotation: 0,
    zIndex: 1,
    color: '#3498db',
  };
  socket.emit('object:create', {
    operationId: 'op-create-1',
    roomId,
    object,
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  const roomObjects = await getRoomObjectsFromRepository(repository, roomId);
  assert.equal(roomObjects.length, 1);
  assert.equal(roomObjects[0].id, object.id);
  assert.equal(roomObjects[0].type, object.type);
  assert.equal(roomObjects[0].x, object.x);
  assert.equal(roomObjects[0].y, object.y);
  assert.equal(roomObjects[0].width, object.width);
  assert.equal(roomObjects[0].height, object.height);
  assert.equal(roomObjects[0].rotation, object.rotation);
  assert.equal(roomObjects[0].zIndex, object.zIndex);

  assert.equal(io.broadcasts.length, 1);
  assert.equal(io.broadcasts[0].event, 'object:created');
  assert.equal(io.broadcasts[0].roomId, roomId);
  const payload = io.broadcasts[0].payload as {
    operationId: string;
    object: Record<string, unknown>;
  };
  assert.equal(payload.operationId, 'op-create-1');
  assert.equal(payload.object.id, object.id);
  assert.equal(payload.object.type, object.type);
  assert.equal(payload.object.x, object.x);
  assert.equal(payload.object.y, object.y);
});

test('object:update mutates existing object and broadcasts update payload with operationId', async () => {
  const roomId = 'room-update';
  const { io, socket, repository } = setupConnection(roomId);

  socket.emit('object:create', {
    operationId: 'op-create-2',
    roomId,
    object: {
      id: 'obj-2',
      x: 5,
      y: 5,
      type: 'circle',
      width: 100,
      height: 100,
      rotation: 0,
      zIndex: 1,
      color: '#e74c3c',
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  io.broadcasts = [];

  socket.emit('object:update', {
    operationId: 'op-update-1',
    roomId,
    objectId: 'obj-2',
    updates: { x: 111, y: 222 },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  const roomObjects = await getRoomObjectsFromRepository(repository, roomId);
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

test('object:delete removes object and broadcasts deletion payload with operationId', async () => {
  const roomId = 'room-delete';
  const { io, socket, repository } = setupConnection(roomId);

  socket.emit('object:create', {
    operationId: 'op-create-3',
    roomId,
    object: {
      id: 'obj-3',
      x: 1,
      y: 2,
      type: 'text',
      width: 120,
      height: 40,
      rotation: 0,
      zIndex: 1,
      text: 'Text',
      color: '#2c3e50',
      fontSize: 14,
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  io.broadcasts = [];

  socket.emit('object:delete', {
    operationId: 'op-delete-1',
    roomId,
    objectId: 'obj-3',
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  const roomObjects = await getRoomObjectsFromRepository(repository, roomId);
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

test('late join hydration returns all existing room objects', async () => {
  const roomId = 'room-hydration';
  const { socket, repository } = setupConnection(roomId);

  socket.emit('object:create', {
    operationId: 'op-create-4',
    roomId,
    object: {
      id: 'obj-4',
      x: 10,
      y: 10,
      type: 'rectangle',
      width: 100,
      height: 100,
      rotation: 0,
      zIndex: 1,
      color: '#3498db',
    },
  });

  socket.emit('object:create', {
    operationId: 'op-create-5',
    roomId,
    object: {
      id: 'obj-5',
      x: 20,
      y: 20,
      type: 'sticky-note',
      width: 150,
      height: 150,
      rotation: 0,
      zIndex: 2,
      text: 'Note',
      color: '#f1c40f',
      fontSize: 12,
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  const snapshot = await getRoomObjectsFromRepository(repository, roomId);
  assert.equal(snapshot.length, 2);
  assert.deepEqual(
    snapshot.map((o) => o.id).sort(),
    ['obj-4', 'obj-5']
  );
});

test('unauthorized socket cannot create object in a different room', async () => {
  const roomId = 'room-authorized';
  const { socket, repository } = setupConnection(roomId);

  socket.emit('object:create', {
    operationId: 'op-create-unauth',
    roomId: 'room-other',
    object: {
      id: 'obj-x',
      x: 0,
      y: 0,
      type: 'rectangle',
      width: 100,
      height: 100,
      rotation: 0,
      zIndex: 1,
      color: '#3498db',
    },
  });

  const roomObjects = await getRoomObjectsFromRepository(repository, roomId);
  assert.equal(roomObjects.length, 0);
  assert.equal(socket.emitted.length, 1);
  assert.equal(socket.emitted[0].event, 'error');
  assert.deepEqual(socket.emitted[0].payload, {
    code: 'UNAUTHORIZED',
    message: 'Not a member of this room',
  });
});

test('invalid object:update geometry is rejected without persistence or broadcast', async () => {
  const roomId = 'room-invalid-update';
  const { io, socket, repository } = setupConnection(roomId);

  socket.emit('object:create', {
    operationId: 'op-create-invalid-1',
    roomId,
    object: {
      id: 'obj-invalid-1',
      x: 10,
      y: 20,
      type: 'rectangle',
      width: 120,
      height: 80,
      rotation: 0,
      zIndex: 1,
      color: '#3498db',
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  io.broadcasts = [];
  socket.emitted = [];

  socket.emit('object:update', {
    operationId: 'op-update-invalid-1',
    roomId,
    objectId: 'obj-invalid-1',
    updates: { width: -25 },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  const roomObjects = await getRoomObjectsFromRepository(repository, roomId);
  assert.equal(roomObjects.length, 1);
  assert.equal(roomObjects[0].width, 120);
  assert.equal(io.broadcasts.length, 0);
  assert.equal(socket.emitted.length, 1);
  assert.equal(socket.emitted[0].event, 'error');
  assert.deepEqual(socket.emitted[0].payload, {
    code: 'INVALID_PAYLOAD',
    message: 'Invalid object payload',
  });
});
