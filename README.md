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
- JSON export containing:
  - shape/text/media objects
  - position, size, z-index, rotation
  - ownership (`createdBySessionId`)
  - timestamps (`createdAt`, `updatedAt`, `mediaCreatedAt`)
  - media metadata (`publicId`, `secureUrl`, `resourceType`, `format`, `bytes`, dimensions, duration, MIME type)

## Technology Stack

**Frontend:**

- React 18
- TypeScript
- Vite
- Socket.IO Client
- Zustand (state management)

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

- **M1.A** - Build System & Type Safety ✅
- **M1.B** - Backend & Frontend Shells (in progress)
- **M1.C** - Database Integration & Auth
- **M1.D** - Room Lifecycle
- **M1.E** - Canvas & Objects
- **M1.F** - Validation & Testing

## Scripts

```bash
npm run build      # Build all packages
npm run typecheck  # Type check all packages
npm run lint       # Lint all files
npm run format     # Format all files
npm run dev        # Start dev servers
```

## License

Hackathon Project (2026)
