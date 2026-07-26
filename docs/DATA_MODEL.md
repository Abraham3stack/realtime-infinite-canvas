# Data Model (Prisma Design Contract)

This document defines the minimum Prisma data model required for MVP delivery.

Design principles:

- Keep schema minimal and hackathon-safe.
- Favor flexibility over early deep normalization.
- Store media binaries in Cloudinary, not in database.
- Store only metadata and URLs for media objects.

## Model: GuestUser

### Purpose

Represents a lightweight guest identity based on a display name.

### Relationships

- One GuestUser can have many GuestSessions.

### Fields

- id: unique identifier
- displayName: guest username shown in room
- createdAt: creation timestamp
- updatedAt: optional update timestamp

### Constraints

- displayName required
- displayName length bounded

---

## Model: GuestSession

### Purpose

Represents an active lightweight session for a guest user.

### Relationships

- Many GuestSessions belong to one GuestUser.
- One GuestSession can join many RoomParticipants.
- One GuestSession may create many Rooms.

### Fields

- id: unique identifier
- userId: foreign key to GuestUser
- sessionTokenHash: hashed token or opaque session identifier reference
- expiresAt: session expiration timestamp
- createdAt: creation timestamp
- updatedAt: optional update timestamp

### Constraints

- userId required and must reference existing GuestUser
- session token must be unique
- expired sessions are not valid for write operations

### Relationships

- One GuestSession can author many RoomEvents.

---

## Model: Room

### Purpose

Represents a collaborative canvas room.

### Relationships

- One Room has many RoomParticipants.
- One Room has many CanvasObjects.
- One Room is created by one GuestSession.

### Fields

- id: unique identifier
- shareCode: human-shareable code or slug
- createdBySessionId: foreign key to GuestSession
- title: optional room title
- eventSequenceNumber: server-owned monotonic counter for RoomEvent ordering
- createdAt: creation timestamp
- updatedAt: update timestamp

### Constraints

- shareCode unique
- createdBySessionId required
- eventSequenceNumber required for deterministic journal sequencing

---

## Model: RoomParticipant

### Purpose

Tracks membership and presence state of a session inside a room.

### Relationships

- Many RoomParticipants belong to one Room.
- Many RoomParticipants belong to one GuestSession.

### Fields

- id: unique identifier
- roomId: foreign key to Room
- sessionId: foreign key to GuestSession
- joinedAt: timestamp when participant joined
- lastSeenAt: heartbeat timestamp
- isActive: active or disconnected marker
- lastViewportX: optional latest viewport x
- lastViewportY: optional latest viewport y
- lastViewportZoom: optional latest viewport zoom

### Constraints

- roomId required
- sessionId required
- unique roomId + sessionId pair to prevent duplicate active membership rows

---

## Model: CanvasObject

### Purpose

Stores canonical object state for each item rendered on the collaborative canvas.

### Relationships

- Many CanvasObjects belong to one Room.
- Many CanvasObjects are created by one GuestSession.

### Fields

- id: unique identifier
- roomId: foreign key to Room
- createdBySessionId: foreign key to GuestSession
- type: object type enum (text, shape, sticky, image, audio, video)
- x: position x
- y: position y
- width: optional width
- height: optional height
- rotation: optional rotation angle
- zIndex: layering order
- version: monotonic version for conflict handling
- mediaUrl: Cloudinary secure URL (image/audio/video)
- mediaPublicId: Cloudinary public identifier
- mediaResourceType: Cloudinary resource type
- mediaFormat: detected media format
- mediaWidth: optional media width
- mediaHeight: optional media height
- mimeType: uploaded MIME type
- sizeBytes: uploaded file size
- durationMs: optional duration for audio/video
- mediaCreatedAt: Cloudinary creation timestamp
- deletedAt: optional soft-delete timestamp
- createdAt: creation timestamp
- updatedAt: update timestamp

### Constraints

- roomId required
- type must be one of accepted object enums
- version required and incremented on each mutation

---

## Model: RoomEvent (Bonus Feature Only - Time Travel)

**MVP Status: IMPLEMENTED AS REPLAY FOUNDATION**

RoomEvent is the append-only journal used as the replay foundation.

It stores ordered event history for session replay support while current room hydration remains snapshot-based.

### Relationships

- Many RoomEvents belong to one Room.
- Many RoomEvents are authored by one GuestSession.

### Fields

- id: unique identifier
- roomId: foreign key to Room
- sequenceNumber: room-scoped monotonic ordering key
- operationId: client/server correlation id
- actorSessionId: foreign key to GuestSession
- actorDisplayName: actor display name captured at write time
- eventType: mutation category
- payload: minimal event payload required to reconstruct the action
- schemaVersion: journal payload schema version
- createdAt: write timestamp

### Constraints

- RoomEvent entries are immutable and append-only.
- sequenceNumber is unique per room and assigned server-side.
- operationId is unique per room to prevent duplicate journal entries.
- Event writes do not replace the existing CanvasObject snapshot path.

---

## Model: MediaAsset (Recommended Minimal Table)

### Purpose

Tracks Cloudinary media metadata separately for lifecycle management and cleanup.

### Relationships

- Many MediaAssets belong to one Room.
- Many MediaAssets can be referenced by one CanvasObject over time (if object is updated).
- Many MediaAssets are uploaded by one GuestSession.

### Fields

- id: unique identifier
- roomId: foreign key to Room
- objectId: optional foreign key to CanvasObject
- uploadedBySessionId: foreign key to GuestSession
- mediaType: enum (image, audio, video)
- url: Cloudinary delivery URL
- publicId: Cloudinary public identifier
- mimeType: MIME type
- sizeBytes: file size in bytes
- durationMs: optional duration for audio/video
- width: optional width for image/video
- height: optional height for image/video
- createdAt: upload timestamp
- deletedAt: optional soft-delete timestamp

### Constraints

- url required
- publicId required and unique
- mediaType required

---

## Notes on Constraints and Simplicity (MVP)

- Use soft delete fields where practical to reduce accidental data loss during live collaboration.
- Keep media binaries in Cloudinary and only metadata in PostgreSQL.
- Avoid creating per-object subtype tables during MVP.
- Avoid role/permission tables until requirements demand them.
- RoomEvent traceability is now the foundation for future session replay.
- MediaAsset is optional for MVP; implemented metadata currently lives directly on CanvasObject columns.

## Migration and Evolution Guidance

- Start with the models above only.
- Add fields only when a concrete feature needs them.
- Any schema change must update this document before implementation.

## Data Integrity Expectations (MVP)

- Every write operation must validate payload shape before persistence.
- Every room-scoped operation must verify room membership.
- CanvasObject version and updatedAt fields track change history for LWW conflict resolution.
- RoomEvent-based traceability is implemented as the replay foundation.
