# System Architecture

This document describes the design, data flow, and component interactions in Realtime Infinite Canvas.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Frontend Architecture](#frontend-architecture)
3. [Backend Architecture](#backend-architecture)
4. [Database Architecture](#database-architecture)
5. [Realtime Synchronization](#realtime-synchronization)
6. [Physics Simulation](#physics-simulation)
7. [Replay Engine](#replay-engine)
8. [Offline Resilience](#offline-resilience)

---

## System Overview

### High-Level Design

```
┌─────────────────────────────────────┐
│  Client Browser                     │
│  ┌─────────────────────────────────┐│
│  │ React + Konva Canvas Layer      ││
│  │ ├─ ObjectRenderer               ││
│  │ ├─ CanvasView                   ││
│  │ └─ PhysicsIntegrator            ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ Zustand State Management        ││
│  │ ├─ objects store                ││
│  │ ├─ room store                   ││
│  │ ├─ physics store                ││
│  │ └─ replay store                 ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ Socket.IO Client                ││
│  │ └─ Event handlers               ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
         ↕ WebSocket / HTTP
┌─────────────────────────────────────┐
│  Server (Node.js + Express)         │
│  ┌─────────────────────────────────┐│
│  │ Socket.IO Namespace Handler     ││
│  │ ├─ Room coordination            ││
│  │ ├─ Event broadcasting           ││
│  │ └─ Presence tracking            ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ Event Journal                   ││
│  │ ├─ Append-only log              ││
│  │ ├─ Sequence numbering           ││
│  │ └─ Snapshot creation            ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ Validation Layer (Zod)          ││
│  │ └─ Schema enforcement           ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
         ↕ TCP/IP
┌─────────────────────────────────────┐
│  PostgreSQL Database                │
│  ├─ Rooms                           │
│  ├─ RoomParticipants                │
│  ├─ CanvasObjects                   │
│  ├─ RoomEvents (journal)            │
│  └─ GuestSessions                   │
└─────────────────────────────────────┘
```

### Request Lifecycle

```
User Action (e.g., create rectangle)
        ↓
React component calls Zustand action
        ↓
Local state updated immediately (optimistic)
        ↓
Socket.IO emit to server
        ↓
Server validates (Zod schema)
        ↓
Event appended to PostgreSQL journal
        ↓
Server broadcasts to room participants
        ↓
All clients receive and apply to state
        ↓
Canvas re-renders
        ↓
Replay journal updated (deterministic)
```

---

## Frontend Architecture

### State Management (Zustand)

Four stores manage complete application state:

#### 1. `objects` Store

```typescript
// Manages all canvas objects
interface CanvasObject {
  id: string
  type: 'rectangle' | 'circle' | 'text' | ...
  x: number, y: number      // World coordinates
  rotation: number
  width: number, height: number
  zIndex: number            // Stacking order
  content?: string          // For text/notes
  // ... more properties
}

// Key actions:
- addObject(type, x, y)      → generates ID, broadcasts
- updateObject(id, updates)  → merges state
- deleteObject(id)           → removes + broadcasts
- setObjects(array)          → bulk replace (on join)
```

#### 2. `room` Store

```typescript
interface RoomState {
  roomId?: string
  shareCode?: string
  sessionId?: string
  displayName?: string
  connectionStatus: 'disconnected' | 'connecting' | 'connected'
  isReplayMode: boolean
  participants: Participant[]
}

// Key actions:
- createRoom(title)          → backend creates + returns code
- joinRoom(shareCode)        → authenticate + hydrate
- setConnectionStatus(...)
- addParticipant(info)       → for presence
```

#### 3. `physics` Store

```typescript
interface PhysicsState {
  enabled: boolean
  engine: Matter.Engine | null
  bodies: Map<string, Matter.Body>
  forceFields: ForceField[]
}

// Key actions:
- initializeEngine()         → setup Matter.js
- synchronizeBody(id, pose)  → sync server → client
- applyForce(id, force)
```

#### 4. `replay` Store

```typescript
interface ReplayState {
  isReplaying: boolean
  currentFrame: number
  totalFrames: number
  events: CanvasEvent[]
}

// Key actions:
- loadReplay(roomId)         → fetch journal from server
- stepForward()
- stepBackward()
- jumpToFrame(n)
- resetReplay()
```

### Rendering Pipeline

**Canvas.tsx** (Main Orchestrator):

1. Mounts Konva Stage (infinite canvas)
2. Connects Socket.IO
3. Listens to Zustand stores
4. Dispatches user interactions

**ObjectRenderer.tsx** (Rendering Dispatch):

1. Iterates `objects` store array
2. For each object, renders appropriate Shape component
3. Maintains Konva Group hierarchy
4. Handles selection UI

**Shape Components** (Per-Type Renderers):

- `RectangleShape.tsx` → Konva.Rect
- `CircleShape.tsx` → Konva.Circle
- `TriangleShape.tsx` → Konva.Polygon
- `TextShape.tsx` → Konva.Text + inline editor
- `ImageShape.tsx` → Konva.Image (from Cloudinary URL)
- `AudioShape.tsx` → Konva.Group with placeholder + audio tag
- `VideoShape.tsx` → Konva.Group with placeholder + video tag

### Object Lifecycle

```
User selects tool (e.g., Rectangle)
        ↓
Tool button sets activeTool in Canvas state
        ↓
User clicks canvas
        ↓
handleMouseDown fires on Konva Stage
        ↓
Canvas computes world coordinates
        ↓
Calls createObjectAtAndSync()
        ↓
addObject() generates ID + creates in store
        ↓
emitCreate() sends to server
        ↓
Server broadcasts to room
        ↓
Client receives 'object:create' event
        ↓
Zustand action adds to store
        ↓
ObjectRenderer re-renders
        ↓
Konva Stage updates
        ↓
Replay journal appends event
```

### Selection & Editing

- **Selection**: Click object → `setSelectedObjectId()` → renders blue outline
- **Dragging**: Konva drag handler → `updateObject(id, {x, y})` → broadcast
- **Text Editing**: Double-click text → inline editor mode → blur → update content
- **Deletion**: Select + Delete key → `deleteObject()` → broadcast

### Replay Integration

**During Normal Playback:**

- Objects rendered from live `objects` store
- User interactions dispatch actions → Zustand → Socket → Server

**During Replay Playback:**

- `isReplayMode` flag prevents broadcast
- Frame stepping loads historical object state from journal
- Canvas renders from historical snapshot
- User cannot interact (read-only mode)

### Physics Integration

**PhysicsIntegrator**:

1. Syncs Konva object positions to Matter.js bodies every frame
2. Steps Matter.js engine at fixed timestep
3. Broadcasts physics updates to server every N frames
4. Server validates + broadcasts to other clients
5. Other clients update body positions

---

## Backend Architecture

### Express Server Structure

```
server/src/
├── index.ts                    # Entry point, Express setup
├── socket/
│   ├── index.ts                # Socket.IO namespace definition
│   ├── handlers/
│   │   ├── objects.ts          # Canvas object handlers
│   │   ├── room.ts             # Room + session handlers
│   │   ├── presence.ts         # Viewport/cursor tracking
│   │   └── physics.ts          # Physics synchronization
│   └── middleware/
│       ├── auth.ts             # Session validation
│       └── validation.ts        # Zod schema checking
├── api/
│   ├── rooms.ts                # REST: GET /api/rooms/:code
│   └── replay.ts               # REST: GET /api/rooms/:id/events
├── db/
│   ├── prisma.ts               # Prisma client singleton
│   └── migrations/             # SQL migration files
├── validation/
│   ├── canvas.ts               # Zod schemas
│   └── room.ts                 # Room validation
└── types/
    ├── socket.ts               # Socket.IO event types
    └── db.ts                   # Database types
```

### Room Coordination

**Room Manager** (in-memory state):

```typescript
interface Room {
  id: string
  shareCode: string
  participants: Map<string, Participant>
  lastEventSequence: number
  eventJournal: RoomEvent[]
}

// On client join:
1. Validate session token
2. Load from DB (or create)
3. Add participant to in-memory map
4. Send snapshot of current state
5. Broadcast "participant:joined"

// On client disconnect:
1. Mark participant as inactive
2. Broadcast "participant:left"
3. (DB cleans up after TTL)
```

### Event Journal

**Append-Only Log** (PostgreSQL):

```sql
CREATE TABLE RoomEvent (
  id UUID PRIMARY KEY,
  roomId UUID REFERENCES Room(id),
  sequenceNumber INT,               -- Monotonic
  operationId UUID,                 -- Idempotency
  actorSessionId UUID,              -- Who performed
  eventType VARCHAR,                -- 'object:create', etc
  payload JSONB,                    -- Event data
  createdAt TIMESTAMP,
  UNIQUE(roomId, sequenceNumber)    -- Prevent gaps
);
```

**Immutable guarantees:**

- Events appended, never deleted
- Sequence numbers monotonic per room
- Prevents out-of-order delivery

### Validation Layer

**Zod Schemas** (server-side):

```typescript
const createObjectSchema = z.object({
  type: z.enum(['rectangle', 'circle', 'text', ...]),
  x: z.number().min(0).max(1000000),
  y: z.number().min(0).max(1000000),
  width: z.number().positive(),
  height: z.number().positive(),
  // ... more fields
});

// On receive:
const parsed = createObjectSchema.safeParse(payload);
if (!parsed.success) return error();  // Reject malformed
if (!isAuthorized()) return error();  // Auth check
appendToJournal(parsed.data);
broadcast(parsed.data);
```

---

## Database Architecture

### Schema Overview

```
Guest Sessions (authentication)
├─ GuestSession
│  └─ GuestUser (name, created_at)
│
Rooms & Participants
├─ Room
│  ├─ RoomParticipant (joins + timestamps)
│  ├─ CanvasObject (canvas state)
│  └─ RoomEvent (immutable journal)
│
Media Metadata
└─ (Cloudinary URLs stored in CanvasObject.mediaUrl)
```

### Key Tables

**Room**:

```sql
id UUID PRIMARY KEY
shareCode VARCHAR(8) UNIQUE      -- Short code for joining
title VARCHAR                    -- User-provided name
createdBySessionId UUID          -- Creator info
eventSequenceNumber INT          -- Latest sequence
createdAt, updatedAt TIMESTAMP
```

**RoomParticipant**:

```sql
id UUID PRIMARY KEY
roomId UUID FOREIGN KEY
sessionId UUID FOREIGN KEY
joinedAt TIMESTAMP
lastSeenAt TIMESTAMP             -- For presence
isActive BOOLEAN                 -- Current online status
lastViewportX, lastViewportY FLOAT
lastViewportZoom FLOAT           -- For minimap
```

**CanvasObject**:

```sql
id UUID PRIMARY KEY
roomId UUID FOREIGN KEY
type VARCHAR                     -- Object type
x, y FLOAT                       -- Position
width, height FLOAT              -- Dimensions
rotation FLOAT                   -- In radians
zIndex INT                       -- Stacking order
createdBySessionId UUID
content TEXT                     -- For text/notes
color VARCHAR                    -- Fill/stroke
shapeType VARCHAR                -- 'square', 'circle', etc
mediaUrl VARCHAR                 -- Cloudinary URL
...
createdAt, updatedAt TIMESTAMP
deletedAt TIMESTAMP              -- Soft delete
```

**RoomEvent** (Journal):

```sql
id UUID PRIMARY KEY
roomId UUID FOREIGN KEY
sequenceNumber INT               -- Monotonic, PK with roomId
operationId UUID UNIQUE          -- Idempotency
actorSessionId UUID              -- Who performed
eventType VARCHAR                -- Event type
payload JSONB                    -- Full event data
schemaVersion INT                -- For compatibility
createdAt TIMESTAMP
```

### Data Consistency

**ACID Properties:**

- **Atomicity**: Transactions wrap room + event updates
- **Consistency**: Zod validation + foreign key constraints
- **Isolation**: READ_COMMITTED prevents dirty reads
- **Durability**: PostgreSQL WAL + replication (production)

**Optimistic Concurrency:**

```typescript
// Client: send with operationId
socket.emit('object:create', {
  operationId: randomUUID(),
  ...data
});

// Server: check if operationId exists
const existing = await db.roomEvent.findUnique({
  where: { operationId }
});
if (existing) return;  // Already processed, idempotent

// Append and broadcast
await db.roomEvent.create({...});
```

---

## Realtime Synchronization

### Socket.IO Protocol

**Event Flow**:

```
Client                          Server
  │
  ├─ 'object:create'  ────────>  Validate + append + broadcast
  │                     <────── 'object:created' (confirm)
  │
  ├─ 'object:update'  ────────>  Validate + append + broadcast
  │
  ├─ 'object:delete'  ────────>  Validate + append + broadcast
  │
  └─ 'room:subscribe' ────────>  Send current snapshot
                       <────── 'state:snapshot'
```

### Snapshot Hydration

**On Join** (minimize load time):

```typescript
server.emit('state:snapshot', {
  roomId,
  objects: [...],           // Current canvas state
  participants: [...],      // Active users
  lastSequence: 12345,      // For replay reference
  timestamp: Date.now()
});
```

**Client Processing:**

```typescript
on('state:snapshot', (snapshot) => {
  setObjects(snapshot.objects);
  addParticipants(snapshot.participants);
  // Subscribe to further events
});
```

### Live Synchronization

**Broadcast Pattern**:

```typescript
// Server handles create
socket.on('object:create', (data) => {
  // Validate, append to journal
  const event = await appendEvent({...});

  // Broadcast to room
  io.to(roomId).emit('object:created', {
    ...event,
    confirmedByServer: true
  });
});

// Client receives
on('object:created', (event) => {
  // Update local state
  addObject(event);
  // May be a confirmation of our own action
  // or from another client
});
```

### Offline Queue

**On Disconnect**:

```typescript
const queue: PendingOperation[] = [];

socket.on('disconnect', () => {
  connectionStatus = 'disconnected';
});

// User continues using app (optimistic updates)
// Actions queued locally
queue.push({
  operationId,
  action: 'object:create',
  payload: {...}
});
```

**On Reconnect**:

```typescript
socket.on('reconnect', () => {
  connectionStatus = 'connected';

  // 1. Get fresh snapshot
  emit('room:subscribe');
  on('state:snapshot', (snapshot) => {
    // Merge with local changes...
  });

  // 2. Flush queue
  for (const op of queue) {
    socket.emit(op.action, op.payload);
  }
  queue.clear();
});
```

---

## Physics Simulation

### Architecture

**Host Authoritative Model:**

- One client (host) runs Matter.js engine
- Host simulates all bodies each frame
- Server validates + broadcasts updates
- Other clients interpolate positions

### Implementation

**Matter.js Setup**:

```typescript
// On mount
const engine = Engine.create();
const world = engine.world;

// For each object on canvas
const body = Bodies.polygon(
  object.x,
  object.y,
  sides, // For triangle, etc
  radius,
  { label: object.id }
);
World.add(world, body);
```

**Simulation Loop**:

```typescript
// In useAnimationFrame
Engine.update(engine, deltaTime);

// Sync updated positions to Konva
for (const [id, body] of physicsStore.bodies) {
  const obj = objects[id];
  updateObject(id, {
    x: body.position.x,
    y: body.position.y,
    rotation: body.angle
  });
}

// Broadcast every N frames
if (frameCount % BROADCAST_INTERVAL === 0) {
  emitPhysicsUpdate({...});
}
```

### Force Fields

**Attraction/Repulsion**:

```typescript
interface ForceField {
  x;
  y: number;
  type: 'attract' | 'repel';
  strength: number;
  radius: number;
}

// Each simulation frame
for (const field of forceFields) {
  for (const body of bodies) {
    const distance = Math.hypot(body.position.x - field.x, body.position.y - field.y);

    if (distance < field.radius) {
      const force = computeForce(field, distance, field.strength);
      Body.applyForce(body, force);
    }
  }
}
```

### Throw Physics

**Momentum Tracking**:

```typescript
// On mouseup after drag
const velocity = {
  x: (currentX - lastX) / deltaTime,
  y: (currentY - lastY) / deltaTime,
};

// Apply to Matter body
Body.setVelocity(body, velocity);

// Friction damping in engine
engine.world.gravity.y = 0; // No gravity
// Matter.js applies damping automatically
```

---

## Replay Engine

### Event Journal Structure

```
Timeline:
[Event 0] object:create rect
  ├─ payload: {id, x, y, w, h, ...}
  └─ sequenceNumber: 0

[Event 1] object:update rect (drag)
  ├─ payload: {id, x: 200, y: 150}
  └─ sequenceNumber: 1

[Event 2] object:create circle
  └─ sequenceNumber: 2

... (more events)
```

### Deterministic Replay

**Snapshot at Frame N:**

```typescript
const reconstruct = (events: RoomEvent[], upTo: number) => {
  const state = {
    objects: new Map(),
    selectedId: null,
    // ... other state
  };

  for (let i = 0; i <= upTo; i++) {
    const event = events[i];

    switch (event.eventType) {
      case 'object:create':
        state.objects.set(event.payload.id, event.payload);
        break;

      case 'object:update':
        state.objects.set(event.payload.id, {
          ...state.objects.get(event.payload.id),
          ...event.payload,
        });
        break;

      case 'object:delete':
        state.objects.delete(event.payload.id);
        break;
    }
  }

  return state;
};
```

**Invariants:**

- Same input events → identical output state (across runs)
- Deterministic because no timestamps, randomness, or external I/O
- Tested: 8 replay test cases, all passing

### Frame Navigation

**Step Forward** (Event N → Event N+1):

```typescript
currentFrame++;
const newState = reconstruct(events, currentFrame);
setObjects(newState.objects);
```

**Step Backward** (Event N → Event N-1):

```typescript
currentFrame--;
const newState = reconstruct(events, currentFrame);
setObjects(newState.objects);
```

**Jump to Frame** (Go to Event K):

```typescript
currentFrame = K;
const newState = reconstruct(events, currentFrame);
setObjects(newState.objects);
```

**Reset**:

```typescript
currentFrame = -1;
setObjects({}); // Empty canvas
```

---

## Offline Resilience

### Offline Queue

**Enqueue**:

```typescript
const queue = useOfflineQueue();

socket.on('disconnect', () => {
  isOffline = true;
});

// User creates object
createObject(type, x, y); // Optimistic update
queue.enqueue({
  operationId: uuid(),
  action: 'object:create',
  payload: { type, x, y },
});
```

**Dequeue on Reconnect**:

```typescript
socket.on('reconnect', () => {
  isOffline = false;

  // Fetch fresh state
  const snapshot = await socket.emitWithAck('room:subscribe');
  applySnapshot(snapshot);

  // Flush queue
  const pending = queue.dequeueAll();
  for (const op of pending) {
    socket.emit(op.action, op.payload);
  }
});
```

### Conflict Resolution

**Strategy**: **Server Wins**

```
Local:  obj.x = 100, obj.y = 200
Server: obj.x = 150, obj.y = 150

On merge:
- Apply snapshot from server
- Lose local x/y updates
- Re-apply queued creates (these succeed)
```

**Alternative Strategies** (not implemented):

- Operational Transformation (complex, risky)
- CRDTs (overkill for this use case)
- Last-Write-Wins (can lose data)

---

## Summary

This architecture prioritizes:

✅ **Consistency**: Event sourcing + immutable journal  
✅ **Latency**: Optimistic updates + snapshot hydration  
✅ **Reliability**: Idempotent operations, offline queue  
✅ **Maintainability**: Clear separation of concerns, validated data flow  
✅ **Scalability**: Stateless server design (ready for horizontal scaling with Redis)

See [ENGINEERING_DECISIONS.md](ENGINEERING_DECISIONS.md) for rationale behind each choice.
