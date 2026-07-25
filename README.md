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

### Installation

```bash
# Install all dependencies
npm install
```

### Development

```bash
# Start frontend dev server (port 5173)
npm run dev

# Or individually:
cd client
npm run dev

# And in another terminal:
cd server
npm run dev
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
- Prisma (coming in M1.C)
- Neon PostgreSQL (coming in M1.C)

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
