# Engineering Decisions

This document explains the major technical choices and their rationale.

---

## Frontend Framework

### Decision: React 18 + TypeScript

**Context:**  
Building a collaborative canvas requires frequent re-renders and complex state management. Evaluated: React, Vue, Svelte.

**Alternatives Considered:**

- **Vue 3**: Strong reactivity model, smaller bundle. Trade-off: smaller ecosystem, fewer architectural patterns documented.
- **Svelte**: Smallest bundle, excellent performance. Trade-off: smaller community, less TypeScript tooling maturity.
- **Vanilla JS + WebGL**: Maximum performance. Trade-off: high maintenance burden, no component model.

**Decision: React**

**Why:**

- Largest ecosystem (Canvas libraries, validation tools, routing)
- Excellent TypeScript support and IDE integration
- Well-documented patterns for complex UIs
- Strong adoption among senior engineers (better for maintenance)
- HMR support via Vite excellent for developer experience

**Tradeoffs:**

- Larger initial bundle (mitigated by tree-shaking, lazy loading)
- Requires discipline to avoid re-render cascades
- TypeScript adds compile step (acceptable given Vite speed)

---

## State Management

### Decision: Zustand (not Redux)

**Context:**  
Canvas needs real-time state synchronization across components. Evaluated: Redux, Zustand, MobX, Jotai.

**Alternatives Considered:**

- **Redux**: Industry standard, time-travel debugging. Trade-off: verbose boilerplate, steep learning curve.
- **MobX**: Elegant reactive model. Trade-off: "magic" can surprise, harder to debug.
- **React Context**: Built-in. Trade-off: performance issues with frequent updates.
- **Jotai**: Atomic model similar to Zustand. Trade-off: less proven, smaller community.

**Decision: Zustand**

**Why:**

- Minimal boilerplate (actions are plain functions)
- Direct Immer integration (immutable updates readable)
- Excellent TypeScript inference
- No provider wrapping needed
- Scales to many stores without performance hit
- Easy to test (stores are just objects)

**Tradeoffs:**

- Less time-travel debugging than Redux
- Fewer middleware ecosystem plugins
- Smaller community than Redux (but growing)

**Implementation:**

```typescript
// Clean, readable store definitions
const objectsStore = create((set) => ({
  objects: [],
  addObject: (type) =>
    set((state) => ({
      objects: [...state.objects, { id: uuid(), type }],
    })),
}));
```

---

## Canvas Rendering

### Decision: Konva.js (not Raw Canvas or Three.js)

**Context:**  
Need to render 100+ interactive objects with transforms, selections, and real-time updates. Evaluated: Konva, Pixi, Babylon.js, raw Canvas API.

**Alternatives Considered:**

- **Raw Canvas API**: Highest control and performance. Trade-off: manual event handling, transform matrix math, no selection tools.
- **Pixi.js**: Ultra-optimized for 2D. Trade-off: less abstraction, smaller ecosystem, no transform controls out-of-box.
- **Babylon.js**: 3D-first (overkill). Trade-off: heavier, more complex API.
- **Fabric.js**: Great for drawings. Trade-off: not optimized for many objects, heavier than Konva.

**Decision: Konva.js**

**Why:**

- Abstraction over Canvas API (draw rectangles, circles, text directly)
- Built-in transform controls (rotate, scale, drag)
- Event system integrated (click, drag, touch)
- WebGL backend available (auto-scales to 1000s of objects)
- React integration straightforward via Konva React
- Strong community, well-documented

**Tradeoffs:**

- Not as performant as raw Canvas at extreme scale (10k+ objects)
- Requires mental model of Stage → Layer → Shape hierarchy
- Bundle size ~150KB (acceptable given features)

**Implementation:**

```typescript
<Konva.Stage width={w} height={h} ref={stageRef}>
  <Konva.Layer>
    {objects.map(obj => (
      <Konva.Rect
        x={obj.x}
        y={obj.y}
        width={obj.width}
        height={obj.height}
        onMouseDown={handleSelect}
        onDragEnd={handleDrag}
      />
    ))}
  </Konva.Layer>
</Konva.Stage>
```

---

## Build Tool

### Decision: Vite (not Webpack or Parcel)

**Context:**  
Development must be fast (HMR), production must be optimized. Evaluated: Webpack, Parcel, esbuild, Vite.

**Alternatives Considered:**

- **Webpack**: Industry standard, highly configurable. Trade-off: complex config, slow HMR, steep learning curve.
- **Parcel**: Zero-config. Trade-off: less control, slower production builds than Vite.
- **esbuild**: Super fast but build-only (not dev server).

**Decision: Vite**

**Why:**

- Extremely fast HMR (< 100ms for CSS, < 500ms for JS)
- ES modules during development (true module boundaries)
- esbuild-based for production (30% faster than Webpack)
- Minimal config needed
- First-class TypeScript support
- CSS preprocessing built-in

**Tradeoffs:**

- Newer tool (less ecosystem plugins vs Webpack)
- Some legacy dependencies don't work with ES modules
- Production build verbosity sometimes confusing

---

## API Protocol

### Decision: Socket.IO (not WebRTC or HTTP polling)

**Context:**  
Real-time events (< 100ms latency) needed for multiplayer. Evaluated: Socket.IO, WebRTC, HTTP polling, Server-Sent Events.

**Alternatives Considered:**

- **WebRTC Data Channel**: Peer-to-peer, lower latency. Trade-off: requires signaling server anyway, complex fallback logic, NAT traversal issues, no logging/debugging.
- **HTTP Polling**: Works everywhere. Trade-off: high overhead, high latency, battery drain on mobile.
- **Server-Sent Events**: Unidirectional (server → client only). Trade-off: requires separate channel for client → server.
- **Raw WebSocket**: Lower level than Socket.IO. Trade-off: no reconnection logic, no message queuing, more boilerplate.

**Decision: Socket.IO**

**Why:**

- Bi-directional real-time communication
- Automatic reconnection with exponential backoff
- Message queue during disconnection
- Fallback to HTTP polling if WebSocket unavailable
- Built-in room/namespace management
- Easy acknowledgment pattern (`emitWithAck`)
- Excellent TypeScript support via `@socket.io/typescript`

**Tradeoffs:**

- Small protocol overhead vs raw WebSocket (acceptable for LAN speeds)
- Requires socket.io library on backend (but Express-friendly)
- Namespace routing adds learning curve

**Architecture Decision: Server-Managed Rooms**

```
// Clients don't need to know about each other
// All coordination via server
socket.on('object:create', data => {
  // Server broadcasts to room
  io.to(roomId).emit('object:created', data);
});

// No peer-to-peer communication (simplifies NAT/firewall issues)
```

---

## Database

### Decision: PostgreSQL with Prisma (not MongoDB or Firebase)

**Context:**  
Need to store structured data (rooms, objects, events) with relationships and transactions. Evaluated: PostgreSQL, MongoDB, Firebase Firestore, SQLite.

**Alternatives Considered:**

- **MongoDB**: Schemaless flexibility. Trade-off: no transactions (pre-5.0), complex joins, eventual consistency issues.
- **Firebase Firestore**: Managed, scales automatically. Trade-off: vendor lock-in, limited query flexibility, expensive at scale, harder to debug.
- **SQLite**: Lightweight, works locally. Trade-off: not suitable for concurrent writes (lock contention), no replication.

**Decision: PostgreSQL + Prisma ORM**

**Why:**

- ACID transactions (essential for event journal immutability)
- Strong schema enforcement (prevents data corruption)
- Efficient joins (e.g., get room + participants + objects in 1 query)
- Full-text search, JSON columns (for event payloads)
- Mature, battle-tested, free
- Prisma adds type safety + migrations

**Tradeoffs:**

- Requires database setup (vs Firebase's 0-ops)
- Scaling requires careful sharding (not auto-scaling)
- ORM adds small latency vs raw SQL

**Data Model Rationale:**

```sql
-- Immutable event journal (core pattern)
CREATE TABLE RoomEvent (
  id UUID PRIMARY KEY,
  roomId UUID,
  sequenceNumber INT,  -- Monotonic per room
  eventType VARCHAR,
  payload JSONB,       -- Full event data
  UNIQUE(roomId, sequenceNumber)
);

-- This enables:
-- 1. Complete audit trail
-- 2. Deterministic replay
-- 3. Horizontal scaling (events can be replicated)
-- 4. Point-in-time recovery
```

---

## ORM

### Decision: Prisma (not TypeORM or SQL.js)

**Context:**  
Need type-safe database queries without boilerplate. Evaluated: Prisma, TypeORM, Sequelize, Knex.

**Alternatives Considered:**

- **TypeORM**: Decorators, more SQL control. Trade-off: more verbose, requires learning decorator syntax.
- **Sequelize**: Mature, flexible. Trade-off: large API surface, migration system clunky.
- **Raw SQL**: Maximum control. Trade-off: no type safety, error-prone.

**Decision: Prisma**

**Why:**

- Schema-first design (schema.prisma file is source of truth)
- Auto-generated, type-safe client
- Excellent migrations system (`prisma migrate`)
- Great error messages (designed for DX)
- Built-in connection pooling
- Works with existing databases

**Tradeoffs:**

- Less flexible for complex queries (use raw SQL when needed)
- Generation step adds build complexity
- Smaller ecosystem than TypeORM

---

## Physics Engine

### Decision: Matter.js (not Rapier or custom)

**Context:**  
Need realistic physics for throw mechanics and force fields. Evaluated: Matter.js, Rapier (via WebAssembly), custom physics.

**Alternatives Considered:**

- **Rapier**: Performance-optimized, written in Rust. Trade-off: WASM overhead, higher complexity, smaller community.
- **Custom Physics**: Full control, minimal overhead. Trade-off: complex to debug, collision detection error-prone, huge time investment.
- **Cannon-es**: 3D physics for 2D (overkill). Trade-off: heavier, more API surface.

**Decision: Matter.js**

**Why:**

- Mature, battle-tested (used in many web games)
- Clear separation of body, constraint, and engine
- Easy to integrate with Konva (just need position/angle)
- Excellent documentation and examples
- Predictable behavior (important for multiplayer)
- Pure JavaScript (no WASM complexity)

**Tradeoffs:**

- Not as performant as Rapier at high object counts
- Uses more CPU than necessary for simple simulations
- Host-authoritative model means client can't predict (minor latency impact)

**Host-Authoritative Decision:**
Rather than running physics on each client and reconciling, only the host runs Matter.js. This ensures:

- Consistent physics state (no client disagreements)
- Prevents cheating (client can't modify velocity locally)
- Simpler reconciliation (just broadcast positions every N frames)

---

## Event Sourcing & Replay

### Decision: Immutable Event Journal (not state snapshots)

**Context:**  
Need to support session replay and audit trails. Evaluated: event sourcing, periodic snapshots, delta compression.

**Alternatives Considered:**

- **Periodic Snapshots**: Faster replay, smaller storage. Trade-off: replay from snapshot loses ability to jump to arbitrary point, harder to merge clients.
- **Delta Compression**: Store only changes. Trade-off: reconstruction slower, complex conflict resolution.
- **Time-Series DB (InfluxDB)**: Built for this pattern. Trade-off: vendor lock-in, overkill for this use case.

**Decision: Event Sourcing**

**Why:**

- Complete audit trail (regulatory/debugging)
- Deterministic replay (same events → same state)
- Can jump to any point in time
- Easy to merge changes from offline clients
- Scales horizontally (events can be replicated to other servers)
- Enables temporal queries ("show me state at 3:45 PM")

**Tradeoffs:**

- More storage than snapshots (mitigated by compression)
- Replay performance slower (acceptable for replay-on-demand, not real-time streaming)
- Requires careful handling of event schema versioning

**Snapshot Hydration Optimization:**
To speed up new joins, we still generate snapshots periodically:

```
[Event 0-99] → Snapshot at event 100 (stored)
[Event 100-199] → Snapshot at event 200 (stored)

When replaying: load snapshot 100 + events 100-150 (faster than events 0-150)
```

---

## Offline Queue & Conflict Resolution

### Decision: Server-Wins (not Operational Transformation)

**Context:**  
When offline, client can't reach server. On reconnect, need to merge local + remote changes.

**Alternatives Considered:**

- **Operational Transformation (OT)**: Mathematically proven merge algorithm. Trade-off: complex to implement, bug-prone, slow.
- **Conflict-Free Replicated Data Types (CRDTs)**: Eventual consistency via math. Trade-off: overkill for centralized architecture, harder to reason about.
- **Last-Write-Wins**: Simple. Trade-off: data loss (user loses work).
- **Merge UI**: Ask user to resolve. Trade-off: poor UX, requires UI for every conflict.

**Decision: Server-Wins (simplified)**

**Why:**

- Simple to implement and reason about
- No data corruption (server is authoritative)
- Acceptable for this use case (not a collaborative document editor)
- Offline queue still preserves user intent (new operations succeed)

**How it Works:**

```
1. Client goes offline
   - Queue: [create rect, update circle, delete triangle]

2. Server state changes (another client modified)
   - Room now has different objects

3. Client reconnects
   - Server sends snapshot (current state)
   - Client applies snapshot
   - Client flushes queue (new operations)

4. Result: User's new actions preserved, but edits to existing objects lost

For many tasks, this is acceptable:
- Creating new objects: succeeds ✅
- Editing existing object: lost ❌
- Deleting object: lost (but queued, might fail)
```

**Better UX Strategy** (not implemented):

```typescript
// Instead of silently losing edits, notify user
on('reconnect', () => {
  const snapshot = getSnapshot();
  const conflicts = detectConflicts(localQueue, snapshot);

  if (conflicts.length > 0) {
    showNotification(`${conflicts.length} changes were synced. Others made edits too.`);
  }
});
```

---

## Security

### Decision: Guest Sessions Without Authentication

**Context:**  
Hackathon project prioritizes ease of use. Evaluated: OAuth, JWT tokens, simple guest sessions.

**Alternatives Considered:**

- **OAuth (Google/GitHub)**: Proven, secure. Trade-off: setup complexity, dependency on external provider.
- **Email + Password**: Traditional. Trade-off: storage/hashing burden, phishing risk, UX friction.
- **Anonymous Sharing**: Any link, anyone can edit. Trade-off: security vulnerability.

**Decision: Guest Sessions**

**Why:**

- Minimal friction (user just picks a name)
- Sufficient for hackathon (not handling sensitive data)
- Easy to replace later with real auth (just wrap session validation)

**Implementation:**

```typescript
// No passwords, just a temporary session token
const token = generateSecureToken();
const session = db.guestSession.create({
  token: sha256(token),  // Hash before storage
  expiresAt: now + 30days,
  userId: generateId()
});

// Client stores token in localStorage
// Each request includes token in header
// Server validates: token is not expired, exists, not revoked
```

**Security Assumptions:**

- Rooms are "secret" via short codes (not in public URL)
- Sessions expire after 30 days
- No sensitive PII stored
- Rate limiting on room creation prevents spam

**Future Enhancement:**

```typescript
// When ready, add proper auth:
const authenticatedSession = db.session.create({
  userId: user.id,
  token: generateSecureToken(),
  expiresAt: now + 24hours
});
// No code changes needed in Canvas.tsx (session validation is in middleware)
```

---

## Testing Strategy

### Decision: Snapshot + Replay Tests (not exhaustive unit tests)

**Context:**  
Need high confidence in correctness without excessive test boilerplate.

**Alternatives Considered:**

- **100% Unit Test Coverage**: Maximum confidence. Trade-off: huge maintenance burden, brittle tests.
- **E2E Tests Only**: Realistic but slow.
- **Focused Tests**: Test critical paths only. Trade-off: some bugs escape.

**Decision: Focused Snapshot + Replay Tests**

**Why:**

- Deterministic replay is _inherently testable_ (same input → same output)
- Fewer tests needed because logic is centralized (no branching paths)
- Tests double as documentation

**What We Test:**

```typescript
// Replay correctness (most important)
test('replay: identical state after 100 operations', () => {
  const events = generateRandomEvents(100);

  // Replay twice
  const state1 = reconstructState(events);
  const state2 = reconstructState(events);

  // Should be byte-identical
  expect(state1).toEqual(state2);
});

// Room event handling
test('room:create and room:join', async () => {
  const code = await createRoom();
  expect(code).toHaveLength(8);

  const snapshot = await joinRoom(code);
  expect(snapshot.roomId).toBeDefined();
});

// Physics simulation (sample, not exhaustive)
test('throw physics: velocity decreases over time', () => {
  const body = Bodies.rectangle(0, 0, 20, 20);
  Body.setVelocity(body, { x: 100, y: 0 });

  Engine.update(engine, 1000 / 60);
  const vx1 = body.velocity.x;

  Engine.update(engine, 1000 / 60);
  const vx2 = body.velocity.x;

  expect(vx2).toBeLessThan(vx1); // Friction applied
});
```

---

## Performance Optimizations

### 1. Viewport-Based Rendering

**Decision:** Only render objects near camera view.

```typescript
const visible = objects.filter((obj) => {
  const dist = distance(obj.pos, camera.pos);
  return dist < VIEWPORT_DISTANCE;
});

// Render only visible subset
renderObjects(visible);
```

**Benefit:** 100+ objects on canvas, but only 20-30 rendered at any time.

### 2. Frame Rate Syncing

**Decision:** Sync physics updates every 10th render frame (6 updates/sec instead of 60).

```typescript
if (frameCount % 10 === 0) {
  emitPhysicsUpdate({...});
}
```

**Benefit:** Reduces network traffic 90%, imperceptible to users (network latency dominates).

### 3. Batch Event Journaling

**Decision:** Batch writes to DB (insert 10 events per transaction vs 1).

```typescript
// Client: queue events locally
eventQueue.push(event);

// Every 100ms or 10 events
if (eventQueue.length >= BATCH_SIZE || timeElapsed > BATCH_INTERVAL) {
  db.roomEvent.createMany(eventQueue);
  eventQueue.clear();
}
```

**Benefit:** 90% reduction in DB round-trips.

### 4. Konva Layer Optimization

**Decision:** Use layer caching for static groups.

```typescript
<Konva.Layer ref={layerRef}>
  {objects.map(obj => <Shape key={obj.id} {...obj} />)}
</Konva.Layer>

// After all shapes rendered
layerRef.current.batchDraw();  // Single composite render
```

**Benefit:** Reduces browser paint time.

---

## Scalability Considerations

### Current Architecture Limits

- **Single Room**: 2-3 concurrent clients (no optimization yet)
- **Max Objects**: 500 (performance degrades)
- **Max Sessions**: 100 (before server memory pressure)

### Scaling Roadmap

**Phase 1**: Horizontal server scaling

```
Load Balancer
├─ Server 1 (Room A, B)
├─ Server 2 (Room C, D)
└─ Redis (Socket.IO adapter, session store)
```

**Phase 2**: Database scaling

```
Primary: Postgres (writes)
└─ Replicas: Postgres (read queries)
```

**Phase 3**: Event archival

```
Hot events: PostgreSQL (recent)
Cold events: S3/Archive (older than 7 days)
```

See [FUTURE_WORK.md](FUTURE_WORK.md) for detailed scaling plan.

---

## Summary Table

| Decision       | Why                                 | Tradeoff                       |
| -------------- | ----------------------------------- | ------------------------------ |
| React          | Ecosystem, TypeScript, community    | Larger bundle                  |
| Zustand        | Minimal boilerplate                 | Less ecosystem than Redux      |
| Konva          | Transform controls, event system    | Not ideal for 10k+ objects     |
| Vite           | Fast HMR, optimized builds          | Newer tool                     |
| Socket.IO      | Bi-directional, reconnection, rooms | Small overhead vs raw WS       |
| PostgreSQL     | ACID, joins, transactions           | Requires setup vs Firebase     |
| Prisma         | Type-safe, migrations               | Less control than raw SQL      |
| Matter.js      | Mature, clear API                   | Not as performant as Rapier    |
| Event Sourcing | Audit trail, replay, merge          | More storage                   |
| Server-Wins    | Simple, no data corruption          | User loses offline edits       |
| Guest Sessions | Minimal friction                    | Limited security (intentional) |
| Snapshot Tests | Fewer tests needed, focused         | Doesn't test all paths         |

**Philosophy:**  
_Choose proven, well-documented tools that enable correctness. Avoid premature optimization. Optimize only when measurements show the bottleneck._
