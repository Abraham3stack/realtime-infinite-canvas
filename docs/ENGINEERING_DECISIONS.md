# Engineering Decisions

This document records key decisions that are directly reflected in the current implementation.

## 1. Monorepo with Shared Package

Decision:

- Keep client and server in one repo with a `shared` workspace package.

Why:

- Shared event/type contracts reduce drift between frontend and backend.
- Replay engine can be reused by client runtime and tested independently.

Evidence:

- `package.json` workspaces: `client`, `server`, `shared`
- shared contracts in `shared/src/types/*`
- replay engine in `shared/src/replay/engine.ts`

Tradeoff:

- Build/test commands span multiple workspaces and are slightly heavier than a single package.

## 2. Guest Session Authentication

Decision:

- Use guest sessions with server-issued bearer tokens instead of account-based auth.

Why:

- Minimal onboarding friction for collaborative rooms.
- Sufficient for hackathon scope where sensitive data is not the primary focus.

Evidence:

- `POST /auth/guest` in `server/src/routes/auth.ts`
- session verification in `server/src/socket/middleware/auth.ts`
- protected media route via `requireSession`

Tradeoff:

- No persistent account identity, permissions, or ownership model.

## 3. Socket.IO for Realtime Synchronization

Decision:

- Use Socket.IO room-scoped broadcasts for collaboration events.

Why:

- Built-in reconnect behavior and room broadcast semantics simplify implementation.
- Callback patterns for room lifecycle APIs enable snapshot hydration responses.

Evidence:

- socket registration in `server/src/socket/index.ts`
- room/object/presence/physics handlers under `server/src/socket/handlers/`

Tradeoff:

- Socket protocol is server-centric; horizontal scale requires an adapter that is not yet implemented.

## 4. Snapshot Hydration + Incremental Events

Decision:

- Use callback-based room join responses as authoritative snapshots, then apply incremental events.

Why:

- Reconnect/join needs a full canonical state before resuming realtime updates.

Evidence:

- `room:join` callback returns participants, objects, and physics state in `server/src/socket/handlers/room.ts`
- client hydration in `client/src/hooks/useRoom.ts`

Tradeoff:

- Snapshot payload size grows with room complexity.

## 5. Append-Only Room Event Journal

Decision:

- Persist object/physics mutations to `RoomEvent` entries with room-scoped sequence numbers.

Why:

- Provides deterministic replay input and an auditable mutation history.

Evidence:

- schema model `RoomEvent` in `server/prisma/schema.prisma`
- sequence allocation in `server/src/journal/roomEvents.ts`
- journal writes from object and physics handlers

Tradeoff:

- Additional write overhead on mutating operations.

## 6. Deterministic Replay in Shared Runtime

Decision:

- Implement replay as pure event reduction in shared code, consumed by client UI.

Why:

- Deterministic reduction is easy to test and independent from network timing.

Evidence:

- reducer logic in `shared/src/replay/engine.ts`
- deterministic tests in `shared/src/replay/engine.test.ts`
- client replay panel in `client/src/components/Canvas.tsx`

Tradeoff:

- Replay currently depends on loading full ordered event history from server endpoint.

## 7. Host-Authoritative Physics Controls

Decision:

- Keep physics simulation authority on room creator client and synchronize state through server.

Why:

- Avoid divergent simulation results from multiple independent simulators.
- Keeps server logic focused on synchronization and journaling.

Evidence:

- client simulation + physics control UI in `client/src/components/Canvas.tsx`
- room physics state handler in `server/src/socket/handlers/physics.ts`

Tradeoff:

- If host disconnects, simulation authority is interrupted until room state re-stabilizes.

## 8. Server-Wins Reconnect Strategy

Decision:

- On reconnect, hydrate from server snapshot first, then replay queued offline operations.

Why:

- Guarantees convergence to a canonical room state before local pending mutations are retried.

Evidence:

- offline queue implementation in `client/src/utils/offlineQueue.ts`
- reconnect + rejoin flow in `client/src/hooks/useRoom.ts` and `client/src/components/Canvas.tsx`

Tradeoff:

- Local offline edits can be superseded by newer server state for the same object.

## 9. Cloudinary for Media Storage

Decision:

- Upload media files to Cloudinary and persist only metadata/URLs in Postgres.

Why:

- Keeps database focused on structured collaboration state.
- Offloads media delivery/storage concerns.

Evidence:

- upload route in `server/src/routes/media.ts`
- metadata fields in `CanvasObject` model (`mediaUrl`, `mediaPublicId`, etc.)

Tradeoff:

- Media upload availability depends on Cloudinary configuration and external service health.
