# Realtime Infinite Canvas

A collaborative web platform for real-time multi-user editing on an infinite 2D canvas with creative tools and interactions.

## Project Structure

```
realtime-infinite-canvas/
├── client/           # React + Vite frontend application
├── server/           # Express + Socket.IO backend service
├── shared/           # Shared TypeScript types and Zod validation schemas
├── docs/             # Architecture and requirement documentation
└── package.json      # Root workspace configuration
```

## Development Setup

### Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0
- Docker Desktop (or compatible Docker Engine + Compose plugin)

### Installation

```bash
# Install all dependencies
npm install
```

### Environment

```bash
# Server environment (local app runs outside containers)
cp server/.env.example server/.env

# Optional Docker compose overrides
cp .env.docker.example .env
```

Important variables:

- `server/.env`
  - `DATABASE_URL` (local Docker Postgres by default)
  - `PORT`
  - `CLIENT_ORIGIN`
  - `NODE_ENV`
  - `CLOUDINARY_CLOUD_NAME`
  - `CLOUDINARY_API_KEY`
  - `CLOUDINARY_API_SECRET`
  - `CLOUDINARY_UPLOAD_FOLDER`
  - `UPLOAD_MAX_FILES`
  - `UPLOAD_MAX_IMAGE_BYTES`
  - `UPLOAD_MAX_AUDIO_BYTES`
  - `UPLOAD_MAX_VIDEO_BYTES`
- `.env` (optional, for docker compose interpolation)
  - `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`
  - `SERVER_PORT`, `CLIENT_ORIGIN`
  - `DATABASE_URL_DOCKER`
  - Cloudinary and upload limit variables listed above (used by server container)

### Cloudinary Setup

1. Create a Cloudinary account and copy Cloud name, API key, and API secret.
2. Add credentials to `server/.env` when running server locally.
3. Add the same credentials to root `.env` for Docker-based backend runs.
4. Restart backend after changing environment values.

Supported upload formats:

- Images: `image/png`, `image/jpeg`, `image/webp`, `image/gif`
- Audio: `audio/mpeg`, `audio/wav`, `audio/x-wav`, `audio/ogg`, `audio/mp4`, `audio/webm`
- Video: `video/mp4`, `video/webm`, `video/quicktime`, `video/ogg`

Media binaries are stored in Cloudinary only. PostgreSQL stores metadata and canvas object state.

### Preferred Local Workflow

```bash
# 1) Start PostgreSQL + backend in Docker
docker compose up --build

# 2) Start frontend locally in another terminal
npm run dev -w client
```

Backend will wait for PostgreSQL health, apply existing Prisma migrations, push the baseline schema, then start on port `3000`.

### Development

```bash
# Start all local workspaces without Docker (requires a running Postgres instance)
npm run dev:all

# Start only frontend
npm run dev -w client

# Start only backend
npm run dev -w server
```

### Prisma Database Commands

```bash
# Generate Prisma Client
npm run prisma:generate -w server

# Apply existing migrations
npm run prisma:migrate:deploy -w server

# Show migration status
npm run prisma:status -w server

# Sync schema without creating new migrations (used for baseline setup)
npm run prisma:push -w server
```

### Build

```bash
# Build all packages
npm run build
```

### Type Checking

```bash
# Check types across all packages
npm run typecheck
```

### Linting

```bash
# Lint and format code
npm run lint
npm run format
```

### Troubleshooting

```bash
# Check container health and logs
docker compose ps
docker compose logs -f postgres
docker compose logs -f server

# Re-run Prisma setup against local Docker Postgres
npm run prisma:generate -w server
npm run prisma:migrate:deploy -w server
npm run prisma:push -w server
```

- If `DATABASE_URL` errors occur, verify `server/.env` and container ports.
- If uploads fail with Cloudinary configuration errors, verify `CLOUDINARY_*` values in the active environment file.
- If backend starts before DB in non-compose runs, start Docker Postgres first (`docker compose up postgres -d`).
- To reset local DB data, stop compose and remove the named volume: `docker compose down -v`.

## Media Upload API

The server exposes authenticated media upload endpoints:

- `POST /media/upload`
  - Auth: `Authorization: Bearer <sessionToken>`
  - Content type: `multipart/form-data`
  - Fields:
    - `expectedType`: `image` | `audio` | `video`
    - `files`: one or more media files
  - Success response:
    - `success: true`
    - `data.uploads[]` metadata:
      - `publicId`
      - `secureUrl`
      - `resourceType`
      - `width` and `height` when available
      - `duration` for audio/video
      - `format`
      - `bytes`
      - `createdAt`
      - `mimeType`
  - Error response:
    - `success: false`
    - `error.code`, `error.message`, optional `error.details`

Upload guards:

- MIME type allow-list validation
- Per-type size limits (image/audio/video)
- Maximum files per request (`UPLOAD_MAX_FILES`)
- Clean rejection for malformed multipart payloads and unsupported formats

## Export Support

Canvas toolbar includes:

- PNG export from current canvas stage
- SVG export from current canvas stage
- JSON export containing:
  - shape/text/media objects
  - position, size, z-index, rotation
  - ownership (`createdBySessionId`)
  - timestamps (`createdAt`, `updatedAt`, `mediaCreatedAt`)
  - media metadata (`publicId`, `secureUrl`, `resourceType`, `format`, `bytes`, dimensions, duration, MIME type)

SVG export uses Konva's native stage serialization, so supported shapes and text stay vector-based and scale cleanly. Image and media nodes are included when the rendering library can serialize their sources.

## Room Event Journal

The replay foundation now uses an append-only RoomEvent journal.

- Successful object and user-initiated physics mutations are recorded after validation succeeds.
- Event ordering is server-generated with room-scoped sequence numbers.
- A dedicated socket API returns ordered room history for future replay consumers.
- Current room hydration still uses the existing snapshot path; replay UI is not part of this phase.

## Replay Engine (Phase 2.2)

An isolated in-memory replay subsystem now reconstructs room state deterministically from ordered RoomEvent history.

- Rebuilds object state from `object:create`, `object:update`, and `object:delete` events only.
- Rebuilds physics replay state from user-initiated physics journal events.
- Supports deterministic stepping APIs: initialize, step forward, step backward, reset, and read current state.
- Ignores snapshot hydration for reconstruction, so replay output is event-sequence driven.
- Does not mutate live collaboration stores, socket transport, persistence flow, or offline queue behavior.

Current scope:

- Replay engine logic and deterministic tests are implemented.
- Replay UI is implemented in the client canvas layer with:
  - replay panel transport controls (play, pause, restart, step forward/backward)
  - speed controls (0.25x, 0.5x, 1x, 2x, 4x)
  - timeline scrubber with click/drag seek
  - current-event metadata display (event type, sequence, timestamp)
  - replay-mode visual indicators and toolbar state changes

Replay UI isolation behavior:

- During replay mode, live canvas mutations are blocked (create/move/resize/delete/upload).
- During replay mode, realtime emits/offline queue replay and presence emission are suppressed.
- Replay rendering uses replay-engine state only and exits cleanly back to live room state.

Final validation status:

- Replay parity validated against live room hydration snapshot using real `room:events:list` history.
- Large-journal replay validation completed with 500+ events and repeated-run deterministic output checks.
- Real-browser replay verification completed (live room vs replay-rendered state parity).
- Isolation verification completed (replay does not mutate live stores, socket transport, journal, or offline queue).
- Evidence artifacts captured at `docs/validation/evidence/replay_final_validation_2026-07-26T12-52-54-115Z/summary.json`.

## Physics System (Phase 5)

Physics mode is implemented with Matter.js and synchronized across collaborators.

- Matter.js powered rigid-body simulation for canvas objects
- Host-authoritative simulation loop (room creator is simulation authority)
- Realtime synchronized body transforms to connected participants
- Late-joiners hydrate into current room state and receive ongoing physics updates
- Persistent engine and world lifecycle during active simulation (no per-frame world reconstruction)

Physics-enabled object types:

- Rectangle
- Circle
- Text

Intentional limitations:

- Sticky note, image, audio, and video objects are not simulated as dynamic Matter bodies
- Physics controls are room-scoped and authority is single-host

## Throw Physics (Momentum) (Phase 5.7)

Throw momentum is implemented for physics-enabled drag interactions using recent pointer samples.

- Release velocity uses a short rolling pointer history window, not just drag start/end deltas
- Very small drags and near-zero release speeds are ignored to avoid accidental throws
- Velocity is clamped to a safe maximum to keep simulation stable and predictable
- Pinned objects cannot be thrown
- Release velocity metadata is propagated through existing object update synchronization so remote collaborators observe the same throw direction and speed

## Attraction & Repulsion Fields (Phase 5.8)

Temporary magnetic-style force fields are available for physics-enabled objects.

- Two modes are available: `Attract` and `Repel`
- While a mode is active, holding the pointer applies the field; releasing stops force application
- Force is strongest near the pointer and decays with distance
- Force is capped to preserve stable simulation behavior
- Pinned/static objects are ignored by field forces
- Field effects reuse Matter.js `Body.applyForce()` inside the host-authoritative simulation loop
- Followers observe matching motion through the existing physics/object synchronization pipeline

## Mini-map & Collaborator Radar (Phase 5.2)

Mini-map and radar are integrated as a canvas overlay and synchronized through existing Socket.IO room state.

- Bottom-right, collapsible mini-map overlay
- Reduced-scale rendering of all supported canvas objects
- Local viewport rectangle shown live during pan/zoom
- Click-to-navigate and drag-to-pan interactions from mini-map
- Collaborator viewport rectangles with deterministic unique colors and optional labels
- Live collaborator viewport updates using throttled presence events
- Late-join and reconnect radar hydration through room snapshots + realtime presence stream

Controls:

- `Map/Hide`: collapse or expand the mini-map overlay
- `Labels/No labels`: show or hide collaborator display-name tags
- Click inside mini-map: center the main viewport on clicked world position
- Drag local viewport rectangle inside mini-map: pan main canvas continuously

Performance characteristics:

- Geometry bounds and object-projection calculations are memoized
- Presence updates are throttled/coalesced to reduce high-frequency traffic
- Mini-map rendering is isolated from primary Konva renderer and uses lightweight DOM primitives

Known limitations:

- Radar tracks viewport positions for active participants only
- Presence viewport persistence is best-effort and optimized for active session continuity
- Offline queue replay is best-effort and waits for server echo confirmation before dequeuing

## Current Feature List

- Guest session creation and token-based Socket.IO authentication
- Room create/join/leave flows with share-code collaboration
- Realtime canvas object CRUD synchronization across connected participants
- Mandatory object types: rectangle, circle, triangle, text, sticky note, image, audio, video
- Shape creation menu with Rectangle, Square preset, Circle, and Triangle
- Inline text editing workflow (place text on click, type live, re-open via text double-click or Edit Text action)
- Cloudinary-backed media upload + metadata persistence
- PNG export and JSON export
- Matter.js host-authoritative physics simulation for supported object types
- Mini-map overlay with click-to-navigate and drag-to-pan
- Collaborator radar with presence-synchronized viewport rectangles
- Late-join room hydration for objects, participants, physics state, and presence-derived viewport metadata
- Reconnect behavior that restores room state from snapshot and resumes live synchronization
- Offline operation queue for object create/update/delete with automatic reconnect replay

## Keyboard Shortcuts

- `R`: Arm rectangle creation tool (click canvas to place)
- `C`: Arm circle creation tool (click canvas to place)
- `T`: Arm text creation tool (click canvas to place, then type inline)
- `S`: Create sticky note
- `Arrow Keys` (while mini-map is focused): Nudge viewport from mini-map keyboard navigation
- `Enter` in Create/Join form fields: Submit current action

Shortcuts are ignored while typing in input or textarea fields.

## Text Editing Workflow

- Select `Text` from the toolbar and click the canvas to place a text object.
- An inline editor opens immediately at the placed location.
- Text updates stream in real time using the existing object update synchronization path.
- Finish editing with `Enter`, by clicking outside the editor, or by switching tools.
- Re-open editing for existing text via text-object double-click or the `Edit Text` action when a text object is selected.

## Architecture Overview

- Frontend rendering: React + Konva
- Physics runtime: Matter.js inside the canvas runtime
- Realtime transport: Socket.IO
- Authority model: host-authoritative simulation, follower-side rendering and sync consumption
- Presence synchronization: collaborator viewport/status updates over room-scoped presence events
- Persistence and hydration: room/object/participant snapshot bootstrap + realtime stream convergence
- Reconnect strategy: snapshot re-hydration followed by incremental event replay/consumption
- Offline sync strategy: local optimistic mutations + persistent FIFO queue + reconnect replay

## Known Limitations

- Physics simulation is limited to rectangle, circle, and text objects
- Physics authority is single-host (room creator)
- Attraction/repulsion controls are host-driven in the current authority model
- Presence persistence is optimized for active sessions and is best-effort
- Offline queue currently stores object create/update/delete only (media uploads remain online-only)

## Technology Stack

**Frontend:**

- React 18
- TypeScript
- Vite
- Socket.IO Client
- Zustand (state management)
- Konva (canvas rendering)
- Matter.js (physics simulation)

**Backend:**

- Express
- TypeScript
- Socket.IO
- Prisma
- PostgreSQL (local Docker for development)

**Shared:**

- TypeScript
- Zod (schema validation)

## Packages

### shared

Shared types and validation schemas for client and server.

- `shared/src/types/` - TypeScript interfaces
- `shared/src/validation/` - Zod schemas

### server

Backend Express server with Socket.IO realtime support.

- `server/src/index.ts` - Entry point

### client

Frontend React application with Vite build system.

- `client/src/main.tsx` - Entry point
- `client/index.html` - HTML template

## Documentation

- [docs/VEGA_REQUIREMENT.md](docs/VEGA_REQUIREMENT.md) - Official hackathon requirements
- [docs/ROADMAP.md](docs/ROADMAP.md) - Implementation phases and milestones
- [docs/DECISIONS.md](docs/DECISIONS.md) - Architecture decisions
- [docs/SOCKET_EVENTS.md](docs/SOCKET_EVENTS.md) - Socket.IO event contract
- [docs/API.md](docs/API.md) - REST API contract
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md) - Prisma data model design

## Roadmap

- **Phase 1** - Core App and Realtime Baseline ✅
- **Phase 2** - Infinite Canvas and Mandatory Object Types ✅
- **Phase 3** - Media Pipeline and Export Verification ✅
- **Phase 4** - Performance Hardening for Judging Conditions ✅
- **Phase 5** - Creative Features (physics + mini-map/radar + offline sync) ✅
- **Phase 6** - Final Polish and Submission Readiness ✅

Current status is tracked in [docs/ROADMAP.md](docs/ROADMAP.md).

## Scripts

```bash
npm run build      # Build all packages
npm run typecheck  # Type check all packages
npm run lint       # Lint all files
npm run format     # Format all files
npm run dev        # Start dev servers
npm run validate:phase4:gates    # Run phase-4 quality gates (typecheck/lint/build/test)
npm run validate:phase4:harness  # Run executable browser harness and write evidence artifact
```

## License

Hackathon Project (2026)
