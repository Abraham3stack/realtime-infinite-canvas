# Submission Notes

## Project Summary

Realtime Infinite Canvas is a collaborative canvas application that combines:

- React + Konva rendering,
- Socket.IO room-based synchronization,
- Prisma/PostgreSQL persistence,
- append-only room event journaling,
- deterministic replay of journaled events,
- host-authoritative physics controls.

The implementation is feature-complete for the core hackathon scope and is documented to reflect current behavior without placeholders.

## Strongest Implemented Engineering Work

### 1. End-to-end room synchronization model

- Guest authentication and socket authorization
- Room create/join/leave with callback responses
- Snapshot hydration on join/rejoin
- Incremental object and presence event broadcasts

### 2. Replay foundation with deterministic reducer

- Room mutations are persisted as `RoomEvent` entries with room-scoped sequence numbers.
- Replay engine applies ordered events to reconstruct state.
- Replay panel in the client supports play/pause/step/seek/restart.

### 3. Physics integration with explicit authority model

- Matter.js simulation runs on the host client.
- Server synchronizes and journals room physics state mutations.
- UI supports toggling simulation, static object pinning, and force controls.

### 4. Offline operation queue

- Object create/update/delete operations are persisted locally while disconnected.
- On reconnect, client rejoins room, rehydrates snapshot, and replays queued operations.

## Validation Evidence in Repository

Automated tests currently present:

- `shared/src/replay/engine.test.ts` (8 tests)
- `server/src/journal/roomEvents.test.ts` (3 tests)
- `server/src/socket/handlers/objects.test.ts` (6 tests)

Total test cases: 17

Core quality gates used during validation:

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm test`

## Known Limitations (Honest Scope)

- Physics authority is single-host per room.
- Conflict resolution after reconnect is server-authoritative, not CRDT/OT.
- Offline queue scope is object create/update/delete only.
- Guest sessions are temporary and account-less.
- No implemented JSON import workflow yet.
- Horizontal multi-instance Socket.IO scaling is not configured yet.

## What Is Deliberately Not Claimed

To keep this submission technically credible, documentation avoids claiming:

- benchmark numbers not reproducibly measured in this repository,
- socket protocols that are not implemented by handlers,
- test artifacts that are not present,
- production licensing artifacts that do not exist in the repository.

## Reviewer Map

- Architecture details: [ARCHITECTURE.md](ARCHITECTURE.md)
- Design rationale: [ENGINEERING_DECISIONS.md](ENGINEERING_DECISIONS.md)
- Data persistence model: [DATA_MODEL.md](DATA_MODEL.md)
- Socket contracts: [SOCKET_EVENTS.md](SOCKET_EVENTS.md)
- REST contracts: [API.md](API.md)
- Setup and usage: [README.md](../README.md)
