# REST API

## Authentication

### POST /auth/guest

Creates a guest user and an expiring session.

Implementation note:

- Session expiry is currently 24 hours from issuance.

Request body:

- displayName: string (1-50 chars)

Success `201`:

- sessionToken
- sessionId
- userId
- displayName
- expiresAt

Failure:

- `400` INVALID_PAYLOAD
- `500` SESSION_CREATE_FAILED

### POST /auth/validate

Validates an existing guest session token.

Request body:

- sessionToken: string

Success `200`:

- valid: true
- sessionId
- userId
- displayName
- expiresAt

Failure:

- `400` INVALID_PAYLOAD
- `401` SESSION_INVALID

## Media

### POST /media/upload

Uploads one or more media files to Cloudinary and returns normalized metadata.

Auth:

- Required: `Authorization: Bearer <sessionToken>`

Content type:

- `multipart/form-data`

Form fields:

- expectedType: `image` | `audio` | `video` (optional but recommended)
- files: one or more files

Supported MIME types:

- image: `image/png`, `image/jpeg`, `image/webp`, `image/gif`
- audio: `audio/mpeg`, `audio/wav`, `audio/x-wav`, `audio/ogg`, `audio/mp4`, `audio/webm`
- video: `video/mp4`, `video/webm`, `video/quicktime`, `video/ogg`

Configurable limits (environment variables):

- UPLOAD_MAX_FILES
- UPLOAD_MAX_IMAGE_BYTES
- UPLOAD_MAX_AUDIO_BYTES
- UPLOAD_MAX_VIDEO_BYTES

Success `201`:

- success: true
- data.uploads[]:
  - publicId
  - secureUrl
  - resourceType
  - width (when available)
  - height (when available)
  - duration (audio/video, milliseconds)
  - format
  - bytes
  - createdAt
  - mimeType
  - originalFilename

Failure `4xx`/`5xx`:

- success: false
- error:
  - code
  - message
  - details (optional)

Typical error codes:

- MEDIA_VALIDATION_FAILED
- MEDIA_UPLOAD_FAILED
- SESSION_INVALID
- INVALID_PAYLOAD

## Health

### GET /health

Simple availability endpoint.

Success `200`:

- status: `ok`
- timestamp: ISO string

## Notes

- Binary media files are stored in Cloudinary only.
- PostgreSQL stores metadata and canvas object state only.
- Canvas object creation/sync still occurs through Socket.IO object events.
