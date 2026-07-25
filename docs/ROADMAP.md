# Realtime Infinite Canvas Roadmap

## Purpose

This roadmap defines the execution plan from architecture sign-off to a production-quality hackathon submission.

Rule: No phase is complete until every validation gate in that phase passes.

## Global Validation Gate Checklist (Mandatory for every phase)

- Build passes
- Lint passes
- Typecheck passes
- Unit tests pass
- Integration tests pass
- Browser smoke test passes
- Two-browser realtime validation passes
- No console errors
- No runtime errors
- No UI overlap or responsive regressions
- Documentation updated

## Phase Status Template (Living Documentation)

Update this section after each completed phase.

- ✅ Completed:
- ⚠️ Remaining:
- 🚧 Known Issues:
- 📌 Next Phase:
- 🧪 Validation Results:
- 📝 Technical Debt:

---

## Phase 0 - Foundation Readiness and Contracts

### Goal

Establish shared technical contracts and engineering guardrails before coding.

### Deliverables

- Confirmed architecture decisions and scope boundaries
- Finalized Socket.IO event contract
- Finalized data model contract
- Finalized implementation roadmap and acceptance definitions

### Acceptance Criteria

- All architecture and API contracts are documented and approved
- Scope boundaries for MVP vs stretch features are explicit
- Every mandatory requirement from the requirement document has a mapped acceptance check

### Risks

- Ambiguous requirements causing rework
- Contract drift between frontend and backend
- Hidden scope growth before implementation begins

### Estimated Time

- 2 to 3 hours

### Dependencies

- Requirement document approved as single source of truth
- Architecture review sign-off

### Validation Gates

- Build passes: N/A (documentation-only phase)
- Lint passes: N/A (documentation-only phase)
- Typecheck passes: N/A (documentation-only phase)
- Unit tests pass: N/A (documentation-only phase)
- Integration tests pass: N/A (documentation-only phase)
- Browser smoke test passes: N/A (documentation-only phase)
- Two-browser realtime validation passes: N/A (documentation-only phase)
- No console errors: N/A (documentation-only phase)
- No runtime errors: N/A (documentation-only phase)
- No UI overlap or responsive regressions: N/A (documentation-only phase)
- Documentation updated: Required and must pass

---

## Phase 1 - Core App and Realtime Baseline

### Goal

Create a working vertical slice with room creation/join and realtime synchronization for basic object operations.

### Execution Strategy

Phase 1 is organized into **6 milestone-driven chunks**, each ending with a working vertical slice:

1. **M1.A: Build System & Type Safety** (1-2h) - Monorepo scaffolding, shared types
2. **M1.B: Backend & Frontend Shells** (1-2h) - Pre-database server and client booting
3. **M1.C: Database Integration & Auth** (1-2h) - Neon + Prisma + guest sessions
4. **M1.D: Room Lifecycle** (2-3h) - Room creation, join, presence tracking
5. **M1.E: Canvas & Objects** (3-4h) - Infinite canvas, object CRUD, sync
6. **M1.F: Validation & Testing** (2-3h) - Error handling, comprehensive testing

**Total Estimated Time**: 12-16 hours (fits comfortably within day 1 if distributed)

### Deliverables

- Monorepo with independent client, server, shared packages (M1.A)
- Backend Express server booting without database (M1.B)
- Frontend React + Vite dev server booting (M1.B)
- Neon PostgreSQL integrated via Prisma (M1.C)
- Guest session creation and validation (M1.C)
- Room creation, join via shareable link (M1.D)
- Presence tracking and participant awareness (M1.D)
- Infinite-style canvas with pan/zoom (M1.E)
- Object CRUD with realtime synchronization (M1.E)
- Conflict resolution via last-write-wins (M1.E)
- Validation and error handling (M1.F)
- Comprehensive two-browser acceptance tests (M1.F)

### Acceptance Criteria

- Two users can join same room and see each other's objects in realtime
- Objects persist across page reloads
- Reconnect restores room state without manual intervention
- Event contracts are enforced with validation
- All 6 two-browser test scenarios pass
- Sync latency < 500ms
- Canvas remains smooth with 50+ objects

### Risks

- Realtime conflict or ordering issues
- Session mismatch between tabs
- Event payload incompatibility between client and server
- Canvas performance degradation
- Database connectivity issues during early development

### Estimated Time

- Total: 12-16 hours
- Per milestone: see detailed plan in docs/ROADMAP_PHASE1_MILESTONES.md

### Dependencies

- Phase 0 documentation complete
- Shared event contracts available for implementation
- Neon database credentials available (needed for M1.C)

### Milestone Exit Checklist (Mandatory for each milestone)

Every milestone must pass ALL of these gates before proceeding to the next:

- Build passes
- Lint passes
- Typecheck passes
- Unit tests pass (where applicable)
- Integration tests pass (where applicable)
- Browser smoke test passes (frontend only)
- Two-browser realtime validation passes (where applicable)
- No console errors
- No runtime errors
- No UI overlap or responsive regressions
- Documentation updated
- Git commit completed

### Validation Gates

- M1.A: `npm run typecheck` passes, all packages build
- M1.B: Backend and frontend dev servers start without errors
- M1.C: `prisma db push` succeeds, POST /auth/guest works
- M1.D: Two-browser test shows users joining same room and seeing each other
- M1.E: Two-browser test shows objects syncing in realtime
- M1.F: All 6 comprehensive two-browser test scenarios pass

### Notes

- Detailed task breakdown and per-milestone guidance available in session planning documents.
- RoomEvent table is excluded from MVP schema (reserved for time travel bonus feature).
- Database dependency is introduced in M1.C; M1.A and M1.B work without it.

---

## Phase Status: M1.A - Build System & Type Safety

**Status**: ✅ COMPLETE

### ✅ Completed

- Root package.json with npm workspaces configuration
- TypeScript configuration (root + client + server + shared)
- ESLint and Prettier configuration
- .gitignore and .npmrc
- Client: Vite config, React setup, entry points (index.html, main.tsx, App.tsx, index.css)
- Server: Express placeholder (index.ts)
- Shared package structure:
  - Types: session.ts, room.ts, canvas.ts, events.ts, errors.ts (5 files, 100% complete)
  - Validation: session.ts, room.ts, canvas.ts, events.ts (4 files with Zod schemas)
  - Index file with selective re-exports
- npm install: 304 packages installed successfully

### ⚠️ Remaining

- None - M1.A complete

### 🚧 Known Issues

- None for M1.A scope

### 📌 Next Phase

- M1.B - Backend & Frontend Shells (pending approval)

### 🧪 Validation Results

All validation gates passed:
- ✅ `npm run typecheck` - **PASS** (0 errors)
- ✅ `npm run build` - **PASS** (all packages compiled)
- ✅ `npm run lint` - **PASS** (0 errors, 0 warnings)
- ✅ `npm install` - **PASS** (304 packages, workspace linking verified)

### 📝 Technical Debt

- None for M1.A scope

### 📝 Issues Resolved

1. **Workspace Protocol Error** → Fixed by using `file:../shared` instead of `workspace:*`
2. **TypeScript Config Error** → Fixed by removing unsupported `exactOptionalPropertyInitialization` option
3. **Zod API Mismatches** → Fixed all instances of `.non_negative()` → `.nonnegative()` (Zod v3)
4. **Missing Schema Exports** → Added `export` to ViewportSchema and RoomParticipantStatusSchema
5. **Discriminated Union Incompatibility** → Manually constructed ObjectCreatePayloadSchema without `.omit()`

---

## Phase 2 - Infinite Canvas and Mandatory Object Types

### Goal

Deliver mandatory canvas interactions and all required object types for MVP.

### Deliverables

- Infinite-style 2D canvas interaction model
- Smooth pan and zoom interactions
- Object types: text, shapes, sticky notes, images, audio recordings
- Drag, move, resize baseline interactions
- Persist and hydrate canvas objects from backend

### Acceptance Criteria

- Canvas remains smooth while navigating and editing
- All mandatory object types can be created, updated, deleted, and reloaded
- Multi-user edits remain consistent across connected clients

### Risks

- Rendering slowdowns from frequent rerenders
- Object schema mismatch across types
- Audio object behavior introducing edge-case failures

### Estimated Time

- 8 to 10 hours

### Dependencies

- Phase 1 realtime baseline complete
- Shared object schema contract complete

### Validation Gates

- Build passes
- Lint passes
- Typecheck passes
- Unit tests pass
- Integration tests pass
- Browser smoke test passes
- Two-browser realtime validation passes
- No console errors
- No runtime errors
- No UI overlap or responsive regressions
- Documentation updated

---

## Phase 3 - Media Pipeline and Responsive UX Completion

### Goal

Implement production-safe media upload lifecycle and complete responsive UX requirements.

### Deliverables

- Cloudinary signed upload flow for images and audio
- Persist metadata and URLs only in database
- Media object playback/rendering across sessions
- Responsive layout hardening for desktop and mobile breakpoints
- Error handling for failed uploads and invalid media

### Acceptance Criteria

- Image and audio uploads succeed and persist reliably
- Media objects rehydrate and function after reload
- No layout overlap or critical UX breakage on small screens

### Risks

- Upload signature flow bugs
- Cloudinary response mismatch with object payload schema
- Mobile UI interaction conflicts on canvas controls

### Estimated Time

- 4 to 6 hours

### Dependencies

- Phase 2 object lifecycle complete
- Cloudinary credentials/configuration available

### Validation Gates

- Build passes
- Lint passes
- Typecheck passes
- Unit tests pass
- Integration tests pass
- Browser smoke test passes
- Two-browser realtime validation passes
- No console errors
- No runtime errors
- No UI overlap or responsive regressions
- Documentation updated

---

## Phase 4 - Performance Hardening for Judging Conditions

### Goal

Reach stable performance and correctness with realistic judging load.

### Deliverables

- Performance tuning for 100+ objects
- Realtime event throttling/coalescing for high-frequency updates
- Presence/cursor update optimization
- Stability improvements for reconnect and event deduplication

### Acceptance Criteria

- Smooth pan/zoom with 100+ objects in active room
- Stable collaboration with 6 to 15 concurrent users target
- No regressions in object correctness under concurrent edits

### Risks

- Performance tuning causing behavior regressions
- Over-throttling realtime updates and reducing perceived sync quality
- Uncaught edge cases under multi-user stress

### Estimated Time

- 5 to 7 hours

### Dependencies

- Phases 1 to 3 complete
- Test fixtures for multi-user and high object counts

### Validation Gates

- Build passes
- Lint passes
- Typecheck passes
- Unit tests pass
- Integration tests pass
- Browser smoke test passes
- Two-browser realtime validation passes
- No console errors
- No runtime errors
- No UI overlap or responsive regressions
- Documentation updated

---

## Phase 5 - Creative Features (Priority Order)

### Goal

Implement high-scoring creative features in strict priority order after MVP stability is achieved.

### Deliverables

- Physics interactions (Matter.js) for selected object classes
- Mini-map and radar with collaborator location indicators
- Offline sync stretch implementation only if prior items are stable

### Acceptance Criteria

- Physics interactions are demo-ready and stable
- Mini-map/radar accurately reflects viewport and user location
- Offline stretch only accepted if it does not degrade core realtime correctness

### Risks

- Physics destabilizing interaction performance
- Radar introducing high-frequency update overhead
- Offline sync complexity creating regressions in conflict handling

### Estimated Time

- Physics: 3 to 5 hours
- Mini-map + radar: 2 to 3 hours
- Offline stretch: 3 to 5 hours (only if schedule allows)

### Dependencies

- Phase 4 performance gate complete
- Stable object lifecycle and event model

### Validation Gates

- Build passes
- Lint passes
- Typecheck passes
- Unit tests pass
- Integration tests pass
- Browser smoke test passes
- Two-browser realtime validation passes
- No console errors
- No runtime errors
- No UI overlap or responsive regressions
- Documentation updated

---

## Phase 6 - Final Polish, Regression, and Submission Readiness

### Goal

Deliver a polished, reliable submission with clear demo flow and no critical defects.

### Deliverables

- Full regression pass on mandatory requirements
- Final bug fixes and UX polish
- Updated documentation and known limitations
- Demo script and fallback scenarios

### Acceptance Criteria

- All mandatory requirements pass acceptance checks
- No P0/P1 defects remain
- Demo flow can be executed cleanly end-to-end

### Risks

- Last-minute regressions while polishing
- Time loss to non-critical cosmetic changes
- Incomplete verification under real demo conditions

### Estimated Time

- 4 to 6 hours

### Dependencies

- Phases 1 to 5 complete or consciously deferred per scope policy

### Validation Gates

- Build passes
- Lint passes
- Typecheck passes
- Unit tests pass
- Integration tests pass
- Browser smoke test passes
- Two-browser realtime validation passes
- No console errors
- No runtime errors
- No UI overlap or responsive regressions
- Documentation updated

---

## Scope Protection Rules

- Do not start stretch features before all mandatory MVP acceptance criteria pass.
- Offline sync is stretch-only and can be dropped without harming MVP score.
- If time pressure appears, drop features in this order: offline sync, export beyond JSON, advanced physics tuning.

## Completion Definition

A phase is complete only when all listed acceptance criteria are met and every applicable validation gate passes.
