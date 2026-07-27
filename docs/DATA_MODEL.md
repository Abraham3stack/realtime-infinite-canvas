# Data Model

This document reflects the implemented Prisma schema in `server/prisma/schema.prisma`.

## Overview

The server uses PostgreSQL with Prisma and six core models:

- `GuestUser`
- `GuestSession`
- `Room`
- `RoomParticipant`
- `CanvasObject`
- `RoomEvent`

## 1. GuestUser

Purpose:

- lightweight identity with display name.

Fields:

- `id` (uuid, PK)
- `displayName`
- `createdAt`
- `updatedAt`

Relations:

- one-to-many `GuestSession`

## 2. GuestSession

Purpose:

- authenticated guest access for REST and socket flows.

Fields:

- `id` (uuid, PK)
- `userId` (FK -> `GuestUser.id`)
- `sessionTokenHash` (unique, fixed-length char(64))
- `expiresAt`
- `createdAt`
- `updatedAt`

Relations:

- many-to-one `GuestUser`
- one-to-many `Room` (created rooms)
- one-to-many `RoomParticipant`
- one-to-many `RoomEvent` (actor session)

## 3. Room

Purpose:

- collaborative room identity and ordering cursor for journal events.

Fields:

- `id` (uuid, PK)
- `shareCode` (unique)
- `createdBySessionId` (FK -> `GuestSession.id`)
- `title` (nullable)
- `eventSequenceNumber` (int, default 0)
- `createdAt`
- `updatedAt`

Relations:

- many-to-one creator `GuestSession`
- one-to-many `RoomParticipant`
- one-to-many `CanvasObject`
- one-to-many `RoomEvent`

## 4. RoomParticipant

Purpose:

- room membership and last known viewport state.

Fields:

- `id` (uuid, PK)
- `roomId` (FK -> `Room.id`)
- `sessionId` (FK -> `GuestSession.id`)
- `joinedAt`
- `lastSeenAt`
- `isActive`
- `lastViewportX` (nullable)
- `lastViewportY` (nullable)
- `lastViewportZoom` (nullable)

Constraints:

- unique composite key: `@@unique([roomId, sessionId])`

## 5. CanvasObject

Purpose:

- canonical persisted state for objects on a room canvas.

Fields:

- identity and room
  - `id` (uuid, PK)
  - `roomId` (FK -> `Room.id`)
  - `createdBySessionId`
- core transform
  - `x`, `y`, `zIndex`, `rotation`
  - `width`, `height`
- lifecycle and concurrency
  - `version` (default 1)
  - `lastServerSeq` (default 0)
  - `createdAt`, `updatedAt`, `deletedAt`
- type discriminator
  - `type` (stored values include `shape`, `text`, `sticky`, `image`, `audio`, `video`)
  - `shapeType` for shape variants (`rectangle`, `circle`, `triangle`)
- text/sticky fields
  - `content`, `fontSize`, `fontFamily`, `color`
  - `backgroundColor`, `textColor`
- media metadata fields
  - `mediaUrl`, `mediaPublicId`, `mediaResourceType`, `mediaFormat`
  - `mediaWidth`, `mediaHeight`, `mimeType`, `sizeBytes`, `durationMs`, `mediaCreatedAt`

Notes:

- This is a single-table strategy with nullable type-specific columns.
- Client-facing type mapping is handled in server object handlers.

## 6. RoomEvent

Purpose:

- append-only room-scoped mutation journal for replay and traceability.

Fields:

- `id` (uuid, PK)
- `roomId` (FK -> `Room.id`)
- `sequenceNumber` (room-scoped monotonic int)
- `operationId` (client/server correlation id)
- `actorSessionId` (FK -> `GuestSession.id`)
- `actorDisplayName`
- `eventType`
- `payload` (JSON)
- `schemaVersion` (default 1)
- `createdAt`

Constraints and indexes:

- `@@unique([roomId, sequenceNumber])`
- `@@unique([roomId, operationId])`
- indexes on `(roomId, createdAt)` and `(roomId, eventType)`

## Implemented Event Types in Journal

Current event types written by server handlers:

- `object:create`
- `object:update`
- `object:delete`
- `physics:update-state`
- `physics:set-static`
- `physics:reset`
