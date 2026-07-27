# System Architecture

This document describes the architecture that is currently implemented in this repository.

## Overview

Realtime Infinite Canvas is a monorepo with three workspaces:

- `client`: React + Konva + Zustand UI runtime
- `server`: Express + Socket.IO + Prisma backend
- `shared`: shared types, validation schemas, and replay engine

Core runtime flow:

1. Client authenticates as guest via REST (`/auth/guest`) and gets a session token.
2. Client connects Socket.IO with that token.
3. Client creates or joins a room via Socket.IO callback APIs.
4. Object and presence changes are synchronized through room-scoped socket events.
5. Mutating object and physics actions are appended to `RoomEvent` journal entries in PostgreSQL.
6. Replay mode fetches journal events with `room:events:list` and reconstructs state locally.

## Frontend Architecture

Primary files:

- `client/src/components/Canvas.tsx`
- `client/src/components/ObjectRenderer.tsx`
- `client/src/components/MiniMapRadar.tsx`
- `client/src/store/*.ts`
- `client/src/utils/offlineQueue.ts`

### State Stores

Implemented Zustand stores:

- `objects` store: canvas object state and local mutations
- `room` store: room metadata and participants
- `physics` store: room physics parameters and local simulation controls
- `replay` store: deterministic replay cursor and replay state
- `viewport` store: pan and zoom (`MIN_ZOOM = 0.1`, `MAX_ZOOM = 5.0`)

### Canvas and Interaction Model

`Canvas.tsx` is the orchestrator for:

- tool selection and object creation,
- drag/resize/update/delete flows,
- export (PNG/SVG/JSON),
- replay panel controls,
- physics control UI,
- presence emissions,
- offline queue replay.

### Offline Behavior

Offline behavior is object-operation focused:

- Queue persists create/update/delete operations locally.
- On reconnect, client rejoins room, hydrates authoritative snapshot, then replays queued operations.
- Queue deduplicates repeated transform updates for the same object.

## Backend Architecture

Primary files:

- `server/src/index.ts`
- `server/src/socket/index.ts`
- `server/src/socket/handlers/*.ts`
- `server/src/routes/auth.ts`
- `server/src/routes/media.ts`
- `server/src/journal/roomEvents.ts`

### REST Surface

- `POST /auth/guest`: create guest user + 24h session
- `POST /auth/validate`: validate session token
- `POST /media/upload`: authenticated upload to Cloudinary
- `GET /health`: server health check

### Socket Surface

Socket handlers are registered in `server/src/socket/index.ts`:

- room lifecycle: create/join/leave and join snapshot callbacks
- object sync: `object:create`, `object:update`, `object:delete`
- physics state sync: `physics:update-state`, `physics:set-static`, `physics:reset`
- presence sync: `presence:update`
- replay event listing: `room:events:list`

### Room Synchronization Model

- Room membership is enforced from authenticated socket context.
- Joining a room returns a snapshot (`participants`, `canvasObjects`, `physicsState`) through callback response.
- Incremental updates are broadcast to `io.to(roomId)`.

## Persistence Architecture

Prisma schema: `server/prisma/schema.prisma`

Implemented tables:

- `GuestUser`
- `GuestSession`
- `Room`
- `RoomParticipant`
- `CanvasObject`
- `RoomEvent`

Important persistence characteristics:

- Session tokens are stored hashed (`sessionTokenHash`).
- Room event sequence numbers are allocated by incrementing `Room.eventSequenceNumber`.
- Room events are immutable append-only records (`RoomEvent`).
- `CanvasObject` uses a single-table strategy with nullable type-specific columns.

## Replay Architecture

Implemented replay pipeline:

1. Client requests room events via `room:events:list`.
2. Server returns ordered events (`sequenceNumber` ascending).
3. Client replay store initializes from those events.
4. Replay applies only supported event types:
   - `object:create`, `object:update`, `object:delete`
   - `physics:update-state`, `physics:set-static`, `physics:reset`
5. UI steps forward/backward/seek by replay cursor, isolated from live mutation actions.

Replay engine source:

- `shared/src/replay/engine.ts`
- `shared/src/replay/engine.test.ts`

## Physics Architecture

Implemented model is host-authoritative at the client layer:

- Host client runs Matter.js simulation.
- Physics parameters and static-object flags are synchronized through server socket events.
- Physics state changes are journaled in `RoomEvent`.
- Followers render synchronized object updates and room physics state.

Current supported physics controls include:

- enable/disable
- run/pause simulation flag
- gravity, restitution, friction-air tuning
- per-object static toggle
- reset nonce

## Known Architectural Limits

- No distributed adapter (single Socket.IO server process).
- No CRDT/OT conflict model; reconnect uses snapshot + queue replay with server authority.
- Offline queue scope is object create/update/delete only.
- Replay rendering is client-side; no server-generated replay snapshots.
