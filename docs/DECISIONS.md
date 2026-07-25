# Architectural Decisions Log

This document records final architecture decisions for the realtime infinite canvas project.

## Decision 1 - Frontend Stack

### Decision

Use React + TypeScript + Vite for the client application.

### Alternatives Considered

- Next.js
- Vue + Vite
- SvelteKit

### Why Rejected

- Next.js adds SSR routing complexity not required for this hackathon.
- Vue and SvelteKit require stack context switching and reduce team velocity if React is primary familiarity.

### Tradeoffs

- React requires careful render control for canvas-heavy UI.
- Vite provides fast iteration but leaves deployment conventions to team setup.

### Final Justification

Fastest, lowest-risk path to ship a stable interactive app with strong TypeScript ergonomics.

---

## Decision 2 - Backend Stack

### Decision

Use Node.js + Express + TypeScript for API and realtime host.

### Alternatives Considered

- Fastify
- NestJS
- Serverless-only architecture

### Why Rejected

- Fastify performance gains are not the bottleneck in this scope.
- NestJS introduces additional abstraction and structure overhead.
- Serverless-only adds complexity for long-lived Socket.IO connections.

### Tradeoffs

- Express requires manual conventions for structure and typing.
- Slightly less built-in guardrails than opinionated frameworks.

### Final Justification

Most familiar and efficient setup for implementing REST plus Socket.IO in a 2-day timeline.

---

## Decision 3 - Realtime Transport and Sync

### Decision

Use Socket.IO with server-authoritative sequencing and last-write-wins conflict resolution.

### Alternatives Considered

- Native WebSocket protocol
- Yjs/CRDT collaboration framework
- WebRTC mesh collaboration

### Why Rejected

- Native WebSocket increases custom protocol/reconnect burden.
- CRDT introduces significant conceptual and implementation overhead for hackathon scope.
- WebRTC mesh adds NAT/signaling complexity and unstable scaling behavior.

### Tradeoffs

- Last-write-wins is simple but can overwrite simultaneous edits.
- Requires explicit event versioning and deduplication logic.

### Final Justification

Best balance of delivery speed, reliability, and acceptable collaboration correctness for MVP goals.

---

## Decision 4 - Database and ORM

### Decision

Use PostgreSQL with Prisma ORM.

### Alternatives Considered

- Supabase full stack
- MongoDB + Mongoose
- Raw SQL without ORM

### Why Rejected

- Supabase adds optional service surface not required for this scoped architecture.
- MongoDB weakens relational modeling for room/session/event consistency.
- Raw SQL slows development and increases schema migration risk.

### Tradeoffs

- Prisma introduces generated client layer and migration workflow overhead.
- Requires disciplined schema changes to avoid churn.

### Final Justification

Reliable relational consistency with high developer velocity and type-safe database access.

---

## Decision 5 - Validation Layer

### Decision

Use Zod for payload validation and schema sharing.

### Alternatives Considered

- Joi
- Yup
- Class-validator

### Why Rejected

- Joi and Yup have weaker type inference ergonomics for shared TypeScript contracts.
- Class-validator pushes decorator pattern and class modeling overhead.

### Tradeoffs

- Duplicate care needed to align Zod schemas and Prisma data shape semantics.

### Final Justification

Strong TypeScript inference and straightforward runtime validation for client/server contracts.

---

## Decision 6 - Canvas Rendering Technology

### Decision

Use React Konva as the canvas engine.

### Alternatives Considered

- tldraw SDK
- Fabric.js
- PixiJS

### Why Rejected

- tldraw SDK is powerful but introduces model constraints and customization overhead for custom object/event flow.
- Fabric.js offers slower React integration and higher state synchronization friction.
- PixiJS has higher raw performance but significantly higher engineering cost for editor-like interactions.

### Tradeoffs

- React Konva has lower performance ceiling than PixiJS at very large scales.
- Requires disciplined rerender control for smooth interaction.

### Final Justification

Lowest implementation risk with sufficient performance for 100+ objects and fastest path to mandatory feature delivery.

---

## Decision 7 - Media Storage Architecture

### Decision

Use Cloudinary for image and audio file storage. Store only metadata and URLs in Postgres.

### Alternatives Considered

- Local filesystem storage
- S3-compatible custom bucket pipeline
- Database binary blob storage

### Why Rejected

- Local filesystem is unsuitable for cloud-hosted distributed deployment.
- Custom S3 integration is valid but slower to configure than Cloudinary in this timeline.
- Binary blobs in database increase complexity and cost with little advantage.

### Tradeoffs

- External service dependency and potential vendor constraints.
- Requires signed upload flow and asset lifecycle management.

### Final Justification

Fastest reliable path for media upload, CDN delivery, and simplified backend storage responsibilities.

---

## Decision 8 - Authentication Scope

### Decision

Guest username only with lightweight guest session.

### Alternatives Considered

- OAuth providers
- Email/password authentication
- Magic link authentication

### Why Rejected

- All alternatives add implementation and UX complexity outside hackathon MVP requirements.

### Tradeoffs

- Minimal identity assurance.
- Reduced account persistence and security controls.

### Final Justification

Directly satisfies requirement while minimizing risk and preserving implementation time.

---

## Decision 9 - Creative Feature Ordering

### Decision

Implement creative features in this strict order: Physics (Matter.js), Mini-map + Radar, Offline Sync (stretch).

### Alternatives Considered

- Offline first
- Mini-map first
- Parallel implementation of all three

### Why Rejected

- Offline-first is highest complexity and highest regression risk.
- Mini-map first has lower judge impact than physics.
- Parallel implementation increases context switching and defect risk.

### Tradeoffs

- If schedule slips, offline support may be dropped.

### Final Justification

Maximizes judging impact while protecting mandatory MVP completion and system stability.

---

## Decision 10 - Repository Structure

### Decision

Use a simple multi-folder structure:

- client
- server
- shared
- docs

### Alternatives Considered

- Single app folder with merged client/server
- Full monorepo tooling with workspace orchestrators

### Why Rejected

- Single merged folder increases coupling and contract drift risk.
- Heavy monorepo tooling introduces setup overhead not needed for a 2-day hackathon.

### Tradeoffs

- Requires basic coordination across folders for shared contracts and scripts.

### Final Justification

Simple, maintainable, and fast to navigate while preserving clear boundaries.

---

## Decision Control

Any new architectural decision that changes delivery risk, data flow, or contract shape must be added to this document before implementation proceeds.
