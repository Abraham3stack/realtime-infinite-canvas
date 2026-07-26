# Future Work

This document describes realistic evolution opportunities for Realtime Infinite Canvas, organized by priority and impact.

---

## Infrastructure & Operations

### Production-Grade Deployment

**Current State:** Docker Compose for local development; no production setup.

**Improvements:**

- Kubernetes manifests for scalable deployment
- Helm charts for easy configuration
- CI/CD pipeline (GitHub Actions)
- Automated database backups + point-in-time recovery
- Health checks + automated restarts
- Logging aggregation (ELK stack or Datadog)
- Error tracking (Sentry integration)
- Performance monitoring (APM)

**Effort:** 2-3 weeks | **Impact:** ⭐⭐⭐⭐⭐ (enables real users)

### Environment Parity

- Separate dev/staging/prod configurations
- Secrets management (Vault or AWS Secrets Manager)
- Database migration safety (approval workflow)
- Canary deployments (gradual rollout)
- Rollback automation

**Effort:** 1 week | **Impact:** ⭐⭐⭐⭐

---

## Scalability

### Horizontal Server Scaling

**Current Limit:** Single server instance (~2-3 concurrent rooms max).

**Solution:**

- Redis adapter for Socket.IO (room broadcasting across instances)
- Session store in Redis (shared across servers)
- Stateless server design (already done)
- Load balancer (NGINX or cloud provider)

```typescript
// Socket.IO Redis adapter
const io = new Server(app, {
  adapter: createAdapter(pubClient, subClient),
});
// Now rooms broadcast across all server instances
```

**Architecture:**

```
Load Balancer (ALB/NLB)
├─ Server 1 (Socket.IO + Redis adapter)
├─ Server 2 (Socket.IO + Redis adapter)
└─ Server 3 (Socket.IO + Redis adapter)

↓ (shared)
Redis Cluster (room state, sessions)
```

**Effort:** 1-2 weeks | **Impact:** ⭐⭐⭐⭐⭐ (10x throughput)

### Database Scaling

**Read Replicas:**

```sql
Primary: Postgres (writes only)
Replica 1: Postgres (read-only queries)
Replica 2: Postgres (read-only queries)

-- Prisma config:
primaryUrl = postgresql://...primary...
replicaUrls = [
  postgresql://...replica1...,
  postgresql://...replica2...
]
```

**Eventual Consistency:**

- Strong consistency for writes (always hit primary)
- Eventual consistency for reads (replicas might lag 100ms)
- Acceptable because event journal is append-only

**Effort:** 1 week | **Impact:** ⭐⭐⭐⭐

### Event Journal Archival

**Current:** All events in hot PostgreSQL storage.

**Problem:** Query latency increases as event count grows.

**Solution:**

```
Recent (< 7 days):  PostgreSQL (hot)
Archive (> 7 days): S3 + Parquet (cold)

-- When replaying old session:
SELECT * FROM events WHERE createdAt > now() - 7 days
UNION
SELECT * FROM s3_query(
  's3://archive/events/2024-01-*.parquet',
  WHERE createdAt > sessionCreatedAt
)
```

**Benefits:**

- Faster queries (hot data smaller)
- Cost reduction (S3 cheaper than DB storage)
- Compliance-friendly (immutable archive)

**Effort:** 2 weeks | **Impact:** ⭐⭐⭐ (mostly for multi-month sessions)

---

## Collaboration Features

### User Identity & Permissions

**Current:** Guest sessions only, no ownership.

**Improvements:**

- User accounts (email or OAuth)
- Role-based access control (RBAC)
- Permission levels: viewer, editor, admin
- Audit log (who changed what, when)

```typescript
interface RoomAccess {
  userId: string;
  roomId: string;
  role: 'viewer' | 'editor' | 'admin';
  grantedAt: Date;
  grantedBy: string;
}

// In socket handler:
if (userRole !== 'editor') {
  return error('Insufficient permissions');
}
```

**Effort:** 2 weeks | **Impact:** ⭐⭐⭐⭐ (team collaboration)

### Presence Indicators & Cursors

**Current:** Viewport/viewport tracking only.

**Improvements:**

- Real-time cursor positions
- User labels next to cursors
- Selections visible to others
- "User is typing" indicators (for text editing)

```typescript
// Broadcast cursor position every 50ms
emitPresence({
  userId,
  cursorX,
  cursorY,
  viewport: {x, y, zoom}
});

// Render other cursors
{participants.map(p => (
  <Cursor
    x={p.cursorX}
    y={p.cursorY}
    label={p.displayName}
    color={colorForUser(p.userId)}
  />
))}
```

**Effort:** 1 week | **Impact:** ⭐⭐⭐ (UX improvement)

### Comments & Annotations

**Data Model:**

```sql
CREATE TABLE ObjectComment (
  id UUID PRIMARY KEY,
  objectId UUID REFERENCES CanvasObject,
  userId UUID,
  content TEXT,
  createdAt TIMESTAMP,
  resolvedAt TIMESTAMP
);
```

**Features:**

- Thread comments on objects
- Resolve discussions
- Notifications for mentions
- Comment history + edits

**Effort:** 2 weeks | **Impact:** ⭐⭐⭐

### Change Tracking & Blame

**Like Git blame for canvas:**

```typescript
// Show object history
GET /api/objects/:id/history
→ [
  { version: 1, changedAt, changedBy, action: 'create' },
  { version: 2, changedAt, changedBy, action: 'move', delta: {x: 10, y: 5} },
  { version: 3, changedAt, changedBy, action: 'delete' }
]
```

**Benefits:**

- Understand how design evolved
- Debug unexpected changes
- Accountability in team settings

**Effort:** 2 weeks | **Impact:** ⭐⭐⭐ (for teams)

---

## Canvas Features

### Advanced Selection

**Current:** Click to select, single selection only.

**Improvements:**

- Multi-select (Shift+click)
- Lasso selection (drag to draw polygon)
- Smart selection (select all of type)
- Selection groups (group for moving together)

```typescript
// Lasso selection
const lasso = generatePolygon(points);
const selected = objects.filter((obj) => pointInPolygon(obj.center, lasso));
setSelectedIds(selected.map((o) => o.id));
```

**Effort:** 1-2 weeks | **Impact:** ⭐⭐⭐

### Alignment & Distribution Tools

**Figma-style alignment:**

```typescript
alignLeft(); // Align all selected to leftmost
alignCenterX(); // Distribute horizontally
alignTop();
distributeVertically();
```

**Benefits:**

- Faster manual design layouts
- Professional appearance

**Effort:** 1 week | **Impact:** ⭐⭐

### Layers Panel

**Current:** No layer management.

**Improvements:**

```typescript
<LayersPanel>
  {objects.map(obj => (
    <LayerItem
      key={obj.id}
      object={obj}
      selected={selectedId === obj.id}
      visible={!obj.hidden}
      onSelect={() => setSelected(obj.id)}
      onToggleVisible={() => toggleHidden(obj.id)}
      onReorder={(index) => moveLayer(obj.id, index)}
    />
  ))}
</LayersPanel>
```

**Benefits:**

- Manage z-order visually
- Hide/show objects
- Quick navigation in crowded canvas

**Effort:** 1 week | **Impact:** ⭐⭐⭐

### Undo/Redo Per Object

**Current:** Global replay only.

**Improvements:**

```typescript
// Undo/redo stack per client
const undoStack = [];
const redoStack = [];

onObjectUpdate(id, changes) {
  undoStack.push({
    action: 'update',
    objectId: id,
    before: objects[id],
    after: {...objects[id], ...changes}
  });

  updateObject(id, changes);
  redoStack.clear();
}

onUndo() {
  const action = undoStack.pop();
  redoStack.push(action);
  revertAction(action);
}
```

**Tradeoff:** Local undo only (doesn't sync to other clients).

**Effort:** 1 week | **Impact:** ⭐⭐⭐⭐

---

## AI Capabilities

### Smart Object Suggestion

**Use case:** User draws rough circle, AI suggests perfect circle.

```typescript
// Integrate TensorFlow.js or Cloud Vision API
const shape = await detectShape(canvasSnapshot);
const suggestion = {
  type: 'circle',
  x: shape.centerX,
  y: shape.centerY,
  radius: shape.radius,
};

if (userAccepts(suggestion)) {
  createObject(suggestion);
}
```

**Effort:** 2 weeks | **Impact:** ⭐⭐

### Layout Optimization

**Use case:** Auto-arrange objects for better composition.

```typescript
// AI analyzes composition
const layout = await suggestLayout(objects);
// Returns [improved positions]

applyLayout(layout);
```

**Providers:** OpenAI API, Claude API, or local model.

**Effort:** 1-2 weeks | **Impact:** ⭐⭐⭐

---

## Mobile Experience

### Touch Gesture Support

**Current:** Desktop-focused.

**Improvements:**

- Two-finger pinch to zoom
- Two-finger pan
- Long-press for context menu
- Tap to select, double-tap to edit

```typescript
// Gesture detection
const gestureHandler = useGesture({
  onPinch: (delta) => {
    const newZoom = currentZoom * (1 + delta);
    setZoom(newZoom);
  },
  onDrag: (delta) => {
    setViewport((v) => ({
      x: v.x - delta.x,
      y: v.y - delta.y,
    }));
  },
});
```

**Effort:** 1 week | **Impact:** ⭐⭐⭐

### Responsive Canvas

**Current:** Designed for widescreen.

**Improvements:**

- Mobile-optimized toolbar (larger hit targets)
- Collapsible panels on small screens
- Swipe navigation (hide toolbar)
- Landscape + portrait support

**Effort:** 1-2 weeks | **Impact:** ⭐⭐⭐

### Progressive Web App (PWA)

- Service Worker for offline mode
- Install to home screen
- App-like experience
- Faster load times

**Effort:** 1 week | **Impact:** ⭐⭐

---

## Performance

### WebGL Rendering

**Current:** Konva uses Canvas 2D + optional WebGL.

**Benefits of Full WebGL:**

- Smooth rendering at 4K resolution
- Better performance on weak devices
- Instant zoom without flicker

```typescript
// Already available in Konva, just needs config:
<Konva.Stage
  width={w}
  height={h}
  scaleX={pixelRatio}
  scaleY={pixelRatio}
  // Enable WebGL backend
>
```

**Effort:** 0.5 weeks | **Impact:** ⭐⭐

### Worker Threads for Physics

**Current:** Physics runs on main thread (can stutter if busy).

**Solution:** Move physics to Web Worker.

```typescript
// main.ts
const physicsWorker = new Worker('physics-worker.js');

physicsWorker.postMessage({
  action: 'step',
  bodies: serializedBodies,
  deltaTime: 16,
});

physicsWorker.onmessage = (e) => {
  // Receive updated body positions
  applyPhysicsUpdate(e.data);
};
```

**Benefits:**

- Smooth canvas interaction even during heavy physics
- Offload expensive calculations

**Effort:** 1 week | **Impact:** ⭐⭐⭐

### Virtual Scrolling for Large Object Lists

**Current:** Render all objects always.

**Problem:** 1000+ objects → performance issues.

**Solution:**

```typescript
const visibleObjects = objects.slice(
  viewportStart,
  viewportEnd
);

// Only render visible objects
return visibleObjects.map(obj => <Shape {...obj} />);
```

**Effort:** 1 week | **Impact:** ⭐⭐⭐⭐ (for large canvases)

---

## Security

### Rate Limiting

**Current:** No rate limits.

**Implementation:**

```typescript
// Per IP, per user
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 1000, // 1000 requests
  message: 'Too many requests',
});

app.use('/api', limiter);
```

**Effort:** 0.5 weeks | **Impact:** ⭐⭐⭐⭐

### Content Security Policy (CSP)

```typescript
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdn.example.com'],
      imgSrc: ["'self'", 'https:', 'data:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  })
);
```

**Effort:** 0.5 weeks | **Impact:** ⭐⭐

### Input Validation & Sanitization

**Current:** Zod validation only.

**Improvements:**

- HTML sanitization (prevent XSS in text fields)
- Rate limiting per operation
- File size limits for uploads
- Virus scanning for media

**Effort:** 1 week | **Impact:** ⭐⭐⭐⭐

### Encryption at Rest & In Transit

- TLS 1.3 for all connections
- Database encryption (PostgreSQL native)
- API key rotation policies

**Effort:** 1 week (setup) | **Impact:** ⭐⭐⭐⭐⭐

---

## Enterprise Features

### Multi-Workspace Support

```sql
CREATE TABLE Workspace (
  id UUID PRIMARY KEY,
  name VARCHAR,
  ownerId UUID,
  members: WorkspaceMember[]
);

CREATE TABLE WorkspaceMember (
  id UUID,
  workspaceId UUID,
  userId UUID,
  role VARCHAR -- admin, member, guest
);

-- Rooms belong to workspaces
ALTER TABLE Room ADD workspaceId UUID;
```

**Benefits:**

- Organization-level collaboration
- Shared resource libraries
- Admin controls

**Effort:** 2-3 weeks | **Impact:** ⭐⭐⭐

### Usage Analytics

```sql
CREATE TABLE UsageEvent (
  id UUID,
  workspaceId UUID,
  eventType VARCHAR,    -- 'room:created', 'object:created'
  metadata JSONB,
  createdAt TIMESTAMP
);

-- Dashboards:
- Active users per day
- Objects created per room
- Session duration
- Feature adoption
```

**Effort:** 1 week | **Impact:** ⭐⭐

### Audit Logging

**Already partly done (event journal)**, but enhance:

```typescript
logAudit({
  userId,
  action: 'object:delete',
  resourceId: objectId,
  timestamp,
  ipAddress,
  userAgent,
});

// Compliance reporting
generateAuditReport(workspaceId, dateRange);
```

**Effort:** 1 week | **Impact:** ⭐⭐⭐ (for regulated industries)

---

## Accessibility

### Keyboard Navigation

**Current:** Mouse-only.

**Improvements:**

- Tab to select objects
- Arrow keys to move
- Delete key to delete
- Ctrl+Z for undo
- Keyboard shortcuts menu

**Effort:** 1 week | **Impact:** ⭐⭐⭐

### Screen Reader Support

- ARIA labels for all controls
- Alt text for objects
- Semantic HTML for dialogs
- Focus management

**Effort:** 1-2 weeks | **Impact:** ⭐⭐⭐

### High Contrast Mode

```typescript
// System preference detection
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

// WCAG AAA contrast ratios
const colors = prefersDark ? darkHighContrastPalette : lightHighContrastPalette;
```

**Effort:** 0.5 weeks | **Impact:** ⭐⭐

---

## Developer Experience

### Plugin System

**Allow custom shape types:**

```typescript
registerShapeType({
  name: 'hexagon',
  defaultProps: { size: 50 },
  render: (props) => <HexagonShape {...props} />,
  validate: hexagonSchema
});
```

**Benefits:**

- Extend without forking
- Ecosystem of third-party shapes
- Community contributions

**Effort:** 2 weeks | **Impact:** ⭐⭐⭐

### API Documentation

- OpenAPI spec for REST endpoints
- WebSocket event catalog
- TypeScript types published to NPM
- Example integrations

**Effort:** 1 week | **Impact:** ⭐⭐⭐⭐

### Example Applications

- Photo collage maker
- Whiteboard meeting notes
- UX wireframing tool
- Mind mapping application

**Effort:** 2-3 weeks each | **Impact:** ⭐⭐⭐⭐

---

## Priority Matrix

| Feature               | Impact     | Effort | Priority |
| --------------------- | ---------- | ------ | -------- |
| Production Deployment | ⭐⭐⭐⭐⭐ | 2-3w   | **1**    |
| Horizontal Scaling    | ⭐⭐⭐⭐⭐ | 1-2w   | **2**    |
| User Accounts         | ⭐⭐⭐⭐   | 2w     | **3**    |
| Rate Limiting         | ⭐⭐⭐⭐   | 0.5w   | **4**    |
| Encryption            | ⭐⭐⭐⭐⭐ | 1w     | **5**    |
| Mobile Gestures       | ⭐⭐⭐     | 1w     | **6**    |
| Undo/Redo             | ⭐⭐⭐⭐   | 1w     | **7**    |
| Comments              | ⭐⭐⭐     | 2w     | **8**    |
| Web Worker Physics    | ⭐⭐⭐     | 1w     | **9**    |
| AI Layout             | ⭐⭐       | 2w     | **10**   |

---

## Recommended Roadmap (12 Months)

**Q1**: Production infrastructure, horizontal scaling, user accounts, security hardening.  
**Q2**: Mobile support, advanced selection, undo/redo, comments.  
**Q3**: Horizontal scaling validation, performance optimization, analytics.  
**Q4**: AI features, PWA, accessibility, plugin system.

**By End of Year:** Production-ready SaaS product with team collaboration, enterprise features, and mobile support.
