// Error types and codes

export const ErrorCodes = {
  // Validation errors
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  VALIDATION_FAILED: 'VALIDATION_FAILED',

  // Session errors
  SESSION_CREATE_FAILED: 'SESSION_CREATE_FAILED',
  SESSION_INVALID: 'SESSION_INVALID',
  SESSION_EXPIRED: 'SESSION_EXPIRED',

  // Room errors
  ROOM_CREATE_FAILED: 'ROOM_CREATE_FAILED',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_JOIN_DENIED: 'ROOM_JOIN_DENIED',

  // Participant errors
  PARTICIPANT_NOT_FOUND: 'PARTICIPANT_NOT_FOUND',
  PARTICIPANT_ALREADY_JOINED: 'PARTICIPANT_ALREADY_JOINED',

  // Object errors
  OBJECT_NOT_FOUND: 'OBJECT_NOT_FOUND',
  OBJECT_TYPE_INVALID: 'OBJECT_TYPE_INVALID',
  OBJECT_VALIDATION_FAILED: 'OBJECT_VALIDATION_FAILED',
  DUPLICATE_OPERATION: 'DUPLICATE_OPERATION',
  VERSION_CONFLICT: 'VERSION_CONFLICT',

  // Media errors
  MEDIA_VALIDATION_FAILED: 'MEDIA_VALIDATION_FAILED',
  MEDIA_UPLOAD_FAILED: 'MEDIA_UPLOAD_FAILED',

  // Physics errors
  PHYSICS_NOT_ENABLED: 'PHYSICS_NOT_ENABLED',
  OBJECT_NOT_PHYSICS_ELIGIBLE: 'OBJECT_NOT_PHYSICS_ELIGIBLE',

  // Sync errors
  RATE_LIMITED: 'RATE_LIMITED',
  SEQ_OUT_OF_RANGE: 'SEQ_OUT_OF_RANGE',

  // Generic errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    public message: string,
    public details?: unknown,
    public recoverable: boolean = false
  ) {
    super(message);
    this.name = 'AppError';
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}
