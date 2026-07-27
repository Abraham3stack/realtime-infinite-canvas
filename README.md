# Realtime Infinite Canvas

Realtime Infinite Canvas is a collaborative canvas application built with React, Socket.IO, TypeScript, and PostgreSQL.

The implementation focuses on:

- realtime multi-user object editing,
- room-based collaboration with guest sessions,
- host-authoritative physics controls,
- append-only room event journaling,
- deterministic replay from journaled events,
- offline operation queueing for create/update/delete.

## What Is Implemented

- Infinite pan/zoom canvas with Konva
  - Zoom range: 0.1x to 5x
- Object types
  - Shapes: rectangle (including square preset), circle, triangle
  - Other: text, sticky-note, image, audio, video
- Realtime collaboration
  - Room create/join/leave
  - Live object create/update/delete broadcasts
  - Presence updates for viewport and activity status
  - Mini-map radar with collaborator viewport overlays
- Physics
  - Matter.js on the host client
  - Room-scoped physics state synchronized via server events
  - Throw momentum and attract/repel field controls in the client
- Replay
  - Event journal persisted in PostgreSQL (`RoomEvent`)
  - Replay panel that loads journal events and steps state deterministically
- Export
  - PNG export (stage raster)
  - SVG export (generated markup from canvas state)
  - JSON export (normalized object snapshot)
- Media upload
  - `POST /media/upload` with server-side validation and Cloudinary upload

## Quick Start

### Prerequisites

- Node.js >= 18
- npm >= 9
- PostgreSQL (local or hosted)

### Install

```bash
npm install
```

### Configure Environment

```bash
cp server/.env.example server/.env
```

Set at least:

- `DATABASE_URL`
- `CLIENT_ORIGIN`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

### Run

Terminal 1 (server):

```bash
npm run dev -w server
```

Terminal 2 (client):

```bash
npm run dev -w client
```

Alternative (both):

```bash
npm run dev:all
```

## Scripts

From repository root:

```bash
npm run build
npm run typecheck
npm run lint
npm test
npm run dev
npm run dev:all
```

## Technology Stack

- Frontend: React 18, TypeScript, Vite, Konva, Zustand, Socket.IO client, Matter.js
- Backend: Node.js, Express, Socket.IO server, Prisma
- Database: PostgreSQL
- Shared package: TypeScript types + validation schemas + replay engine
- Media: Cloudinary

## Validation

Current automated coverage in repository:

- 17 total tests
  - 8 replay engine tests: `shared/src/replay/engine.test.ts`
  - 3 room event journal tests: `server/src/journal/roomEvents.test.ts`
  - 6 object handler tests: `server/src/socket/handlers/objects.test.ts`

Recommended verification commands:

```bash
npm run typecheck
npm run lint
npm run build
npm test
```

## Known Limitations

- Physics authority is single-host per room (room creator)
- Conflict resolution is server-wins after reconnect (queued edits can be superseded by latest server snapshot)
- Offline queue currently handles object create/update/delete operations only
- No user account system (guest sessions only)
- No import path for exported JSON yet
- No repository `LICENSE` file is currently present

## Documentation

- [System Architecture](docs/ARCHITECTURE.md)
- [Engineering Decisions](docs/ENGINEERING_DECISIONS.md)
- [Data Model](docs/DATA_MODEL.md)
- [Socket Events](docs/SOCKET_EVENTS.md)
- [REST API](docs/API.md)
- [Submission Notes](docs/SUBMISSION_NOTES.md)
- [Future Work](docs/FUTURE_WORK.md)
- [Original Challenge Requirements](docs/VEGA_REQUIREMENT.md)
