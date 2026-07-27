# Socket.IO Events

This document describes the Socket.IO events that are implemented in the current codebase.

## Connection and Basic Diagnostics

### `server:hello` (server -> client)

Emitted when a connection is established.

Payload:

- `socketId`
- `serverTs`
- `message`

### `ping` / `pong`

- client emits `ping`
- server responds with `pong` and `serverTs`

## Room Lifecycle

### `room:create` (client -> server, callback response)

Request payload:

- optional `displayName` field (used as room title in current handler)

Callback response on success:

- `roomId`
- `shareCode` (generated 6-char code)
- `createdBySessionId`
- `session` metadata
- `participant` summary
- `initialState` (room + participant list)
- `physicsState`

Error response fields:

- `code`
- `message`

### `room:join` (client -> server, callback response)

Request payload:

- either `roomId` or `shareCode`

Callback response on success:

- `roomId`
- `title`
- `createdBySessionId`
- `participants`
- `canvasObjects`
- `physicsState`

Error response fields:

- `code`
- `message`

### `room:leave` (client -> server, callback response)

Request payload:

- currently ignored by server handler (client sends empty object)

Callback response:

- `{ success: true }` on successful leave
- `{ success: false }` otherwise

### `room:userJoined` (server -> room)

Broadcast to other participants when a member joins.

Payload:

- `participant`
- `serverTs`

### `room:userLeft` (server -> room)

Broadcast when a member leaves or disconnects.

Payload:

- `participantId`
- `roomId`
- `serverTs`

## Object Synchronization

### `object:create` (client -> server)

Payload:

- `operationId`
- `roomId`
- `object`

On success server broadcasts `object:created`.

### `object:created` (server -> room)

Payload:

- `operationId`
- `object` (canonical server-mapped object)
- `serverTs`

### `object:update` (client -> server)

Payload:

- `operationId`
- `roomId`
- `objectId`
- `updates`

On success server broadcasts `object:updated`.

### `object:updated` (server -> room)

Payload:

- `operationId`
- `objectId`
- `updates`
- `serverTs`

### `object:delete` (client -> server)

Payload:

- `operationId`
- `roomId`
- `objectId`

On success server broadcasts `object:deleted`.

### `object:deleted` (server -> room)

Payload:

- `operationId`
- `objectId`
- `serverTs`

## Presence Synchronization

### `presence:update` (client -> server)

Payload:

- `roomId`
- `viewport`:
  - `x`
  - `y`
  - `zoom`
  - optional `width`
  - optional `height`
- `status`: `active` or `idle`

### `presence:updated` (server -> room)

Payload:

- `participantId`
- `sessionId`
- `displayName`
- `roomId`
- `viewport`
- `status`
- `serverTs`

## Physics State Synchronization

### `physics:update-state` (client -> server)

Payload:

- `operationId`
- `roomId`
- `patch` with any of:
  - `enabled`
  - `simulationRunning`
  - `gravityY` (clamped 0..10)
  - `restitution` (clamped 0..1.2)
  - `frictionAir` (clamped 0..0.2)

### `physics:set-static` (client -> server)

Payload:

- `operationId`
- `roomId`
- `objectId`
- `isStatic`

### `physics:reset` (client -> server)

Payload:

- `operationId`
- `roomId`

### `physics:state` (server -> room)

Broadcast after each accepted physics mutation.

Payload:

- `roomId`
- `state`:
  - `enabled`
  - `simulationRunning`
  - `gravityY`
  - `restitution`
  - `frictionAir`
  - `staticObjectIds`
  - `resetNonce`
  - `revision`
- `serverTs`

## Replay Event Listing

### `room:events:list` (client -> server, callback response)

Request payload:

- optional `roomId` (defaults to authenticated socket room)
- optional `afterSequenceNumber`

Success callback response:

- `roomId`
- `events` (ordered by `sequenceNumber` ascending)

Error callback response includes:

- `code`
- `message`
- `roomId`
- `events: []`

## Not Implemented in Current Server Handlers

The following are not implemented as active server socket handlers in this repository:

- `cursor:update` / `cursor:updated`
- `objects:bulkSyncRequest` / delta batch protocol
- `media:register`
- `physics:applyImpulse`
- `miniMap:viewportUpdate`
