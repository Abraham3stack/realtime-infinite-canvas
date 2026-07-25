# Socket.IO Event Contract

This document defines the Socket.IO API contract between client and server.

Contract rules:

- All payloads are validated with Zod on server entry.
- Mutating events include operationId for idempotency.
- Mutating events include roomId and clientTs.
- Server responses include serverTs and sequence/version where applicable.
- Unknown or invalid payloads must return structured errors.

## Error Object Format

All error responses should follow a common shape:

- code: machine-readable error code
- message: human-readable message
- details: optional validation or domain details
- requestId: optional trace ID

---

## Event: room:create

### Direction

Client -> Server

### Payload

- displayName: string

### Validation

- displayName required
- displayName length within accepted range
- displayName sanitized for disallowed content

### Expected Response

Server -> Client: room:created

- roomId
- shareCode
- session
- participant
- initialState

### Error Conditions

- INVALID_PAYLOAD
- SESSION_CREATE_FAILED
- ROOM_CREATE_FAILED

---

## Event: room:join

### Direction

Client -> Server

### Payload

- roomId or shareCode
- displayName (required if no existing guest session)
- sessionToken (optional if already issued)

### Validation

- room identifier required
- session token validity checked if provided
- displayName required for new session

### Expected Response

Server -> Client: room:stateSnapshot

- room metadata
- participants
- canvasObjects
- latestServerSeq

Server -> Room: room:userJoined

- participant summary

### Error Conditions

- INVALID_PAYLOAD
- ROOM_NOT_FOUND
- SESSION_INVALID
- ROOM_JOIN_DENIED

---

## Event: room:leave

### Direction

Client -> Server

### Payload

- roomId

### Validation

- roomId required
- caller must be current participant

### Expected Response

Server -> Room: room:userLeft

- participantId
- roomId

Server -> Client: sync:ack

- event: room:leave
- success: true

### Error Conditions

- INVALID_PAYLOAD
- ROOM_NOT_FOUND
- PARTICIPANT_NOT_FOUND

---

## Event: presence:update

### Direction

Client -> Server

### Payload

- roomId
- viewport: x, y, zoom
- status: active or idle

### Validation

- roomId required
- viewport numeric fields required and finite
- status must be accepted enum value

### Expected Response

Server -> Room: presence:updated

- participantId
- viewport
- status
- serverTs

### Error Conditions

- INVALID_PAYLOAD
- ROOM_NOT_FOUND
- PARTICIPANT_NOT_FOUND

---

## Event: cursor:update (optional MVP plus for collaborator awareness)

### Direction

Client -> Server

### Payload

- roomId
- cursor: x, y

### Validation

- roomId required
- cursor coordinates required and finite
- event rate-limited per participant

### Expected Response

Server -> Room: cursor:updated

- participantId
- cursor
- serverTs

### Error Conditions

- INVALID_PAYLOAD
- RATE_LIMITED
- ROOM_NOT_FOUND

---

## Event: object:create

### Direction

Client -> Server

### Payload

- operationId
- roomId
- clientTs
- object: id, type, payload, transform, style, zIndex

### Validation

- operationId unique for participant session scope
- roomId required
- object type allowed enum: text, shape, sticky, image, audio, video
- payload schema must match object type

### Expected Response

Server -> Room: object:created

- operationId
- object (canonical)
- version
- serverSeq
- serverTs

Server -> Client: sync:ack

- operationId
- success: true

### Error Conditions

- INVALID_PAYLOAD
- DUPLICATE_OPERATION
- ROOM_NOT_FOUND
- OBJECT_TYPE_INVALID
- OBJECT_VALIDATION_FAILED

---

## Event: object:update

### Direction

Client -> Server

### Payload

- operationId
- roomId
- clientTs
- objectId
- patch: partial object update
- baseVersion (optional)

### Validation

- operationId required
- objectId required
- patch must only include allowed mutable fields
- patch payload must remain valid for object type

### Expected Response

Server -> Room: object:updated

- operationId
- objectId
- patchApplied
- newVersion
- serverSeq
- serverTs

Server -> Client: sync:ack

- operationId
- success: true

### Error Conditions

- INVALID_PAYLOAD
- ROOM_NOT_FOUND
- OBJECT_NOT_FOUND
- VERSION_CONFLICT
- OBJECT_VALIDATION_FAILED

---

## Event: object:delete

### Direction

Client -> Server

### Payload

- operationId
- roomId
- clientTs
- objectId

### Validation

- operationId required
- objectId required
- object must exist in target room

### Expected Response

Server -> Room: object:deleted

- operationId
- objectId
- serverSeq
- serverTs

Server -> Client: sync:ack

- operationId
- success: true

### Error Conditions

- INVALID_PAYLOAD
- ROOM_NOT_FOUND
- OBJECT_NOT_FOUND

---

## Event: objects:bulkSyncRequest

### Direction

Client -> Server

### Payload

- roomId
- lastKnownServerSeq

### Validation

- roomId required
- lastKnownServerSeq required and non-negative

### Expected Response

Server -> Client: room:stateSnapshot or sync:deltaBatch

- full snapshot if gap too large
- delta batch if gap is recoverable

### Error Conditions

- INVALID_PAYLOAD
- ROOM_NOT_FOUND
- SEQ_OUT_OF_RANGE

---

## Event: media:register

### Direction

Client -> Server

### Payload

- operationId
- roomId
- clientTs
- objectId
- mediaType: image, audio, or video
- mediaUrl
- mediaPublicId
- mimeType
- sizeBytes
- durationMs (required for audio/video when known)

### Validation

- mediaUrl required and valid URL
- mediaType allowed enum
- required metadata present per mediaType

### Expected Response

Server -> Client: sync:ack

- operationId
- success: true

Server -> Room: object:updated or object:created

- canonical media metadata included

### Error Conditions

- INVALID_PAYLOAD
- MEDIA_VALIDATION_FAILED
- OBJECT_NOT_FOUND
- ROOM_NOT_FOUND

---

## Event: physics:applyImpulse (creative feature)

### Direction

Client -> Server

### Payload

- operationId
- roomId
- clientTs
- objectId
- impulse: x, y

### Validation

- object type must support physics
- impulse values finite and within max range

### Expected Response

Server -> Room: object:updated or physics:state

- updated transform/velocity state
- serverSeq
- serverTs

### Error Conditions

- INVALID_PAYLOAD
- OBJECT_NOT_FOUND
- PHYSICS_NOT_ENABLED
- OBJECT_NOT_PHYSICS_ELIGIBLE

---

## Event: miniMap:viewportUpdate (creative feature)

### Direction

Client -> Server

### Payload

- roomId
- viewport: x, y, zoom, width, height

### Validation

- required viewport fields are finite numbers
- event is throttled

### Expected Response

Server -> Room: miniMap:radarUpdate

- participant positions/viewport outlines
- serverTs

### Error Conditions

- INVALID_PAYLOAD
- RATE_LIMITED
- ROOM_NOT_FOUND

---

## Event: room:created

### Direction

Server -> Client

### Payload

- roomId
- shareCode
- session
- participant
- initialState

### Validation

- Must include canonical room and session identifiers

### Expected Response

Client stores session and transitions to active room state.

### Error Conditions

- CLIENT_STATE_REJECTED (client-side handling)

---

## Event: room:stateSnapshot

### Direction

Server -> Client

### Payload

- room
- participants
- canvasObjects
- latestServerSeq

### Validation

- latestServerSeq required
- object payloads must match defined object types

### Expected Response

Client hydrates state and resumes incremental sync.

### Error Conditions

- SNAPSHOT_PARSE_FAILED (client-side)

---

## Event: room:userJoined

### Direction

Server -> Room

### Payload

- participant summary
- serverTs

### Validation

- participant identifiers required

### Expected Response

Clients update presence list.

### Error Conditions

- CLIENT_STATE_UPDATE_FAILED (client-side)

---

## Event: room:userLeft

### Direction

Server -> Room

### Payload

- participantId
- roomId
- serverTs

### Validation

- participantId required

### Expected Response

Clients remove or mark participant inactive.

### Error Conditions

- CLIENT_STATE_UPDATE_FAILED (client-side)

---

## Event: object:created

### Direction

Server -> Room

### Payload

- operationId
- object canonical payload
- version
- serverSeq
- serverTs

### Validation

- canonical object includes required fields for object type

### Expected Response

Clients add object and acknowledge local reconciliation.

### Error Conditions

- CLIENT_OBJECT_APPLY_FAILED (client-side)

---

## Event: object:updated

### Direction

Server -> Room

### Payload

- operationId
- objectId
- patchApplied or canonical object
- newVersion
- serverSeq
- serverTs

### Validation

- objectId required
- version increment required

### Expected Response

Clients apply patch and resolve optimistic state.

### Error Conditions

- CLIENT_OBJECT_APPLY_FAILED (client-side)

---

## Event: object:deleted

### Direction

Server -> Room

### Payload

- operationId
- objectId
- serverSeq
- serverTs

### Validation

- objectId required

### Expected Response

Clients remove object from local scene.

### Error Conditions

- CLIENT_OBJECT_APPLY_FAILED (client-side)

---

## Event: presence:updated

### Direction

Server -> Room

### Payload

- participantId
- viewport
- status
- serverTs

### Validation

- participantId and viewport required

### Expected Response

Clients update participant presence and optional radar markers.

### Error Conditions

- CLIENT_PRESENCE_APPLY_FAILED (client-side)

---

## Event: cursor:updated

### Direction

Server -> Room

### Payload

- participantId
- cursor
- serverTs

### Validation

- participantId required
- cursor finite coordinates required

### Expected Response

Clients render collaborator cursor.

### Error Conditions

- CLIENT_CURSOR_APPLY_FAILED (client-side)

---

## Event: sync:ack

### Direction

Server -> Client

### Payload

- operationId or event name
- success
- serverSeq (optional)
- serverTs

### Validation

- success boolean required

### Expected Response

Client clears pending state for acknowledged operation.

### Error Conditions

- ACK_MISMATCH (client-side)

---

## Event: sync:error

### Direction

Server -> Client

### Payload

- operationId (optional)
- error object
- recoverable boolean

### Validation

- error object required

### Expected Response

Client shows error, retries if recoverable, or requests resync.

### Error Conditions

- Not applicable (this event is the error response)

---

## Contract Governance

- Any event contract change must update this document before implementation.
- Event name changes are breaking changes and require synchronized client and server updates.
- New event fields must be additive and backward-compatible unless a full version bump is documented.
