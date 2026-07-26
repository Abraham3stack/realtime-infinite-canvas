import { Router, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { ErrorCodes } from '@realtime-canvas/shared';
import { uploadBufferToCloudinary, getResourceTypeFromMimeType, type MediaResourceType } from '../media/cloudinary.js';

const router = Router();

const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

const AUDIO_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/mp4',
  'audio/webm',
]);

const VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/ogg',
]);

const UploadRequestSchema = z.object({
  expectedType: z.enum(['image', 'audio', 'video']).optional(),
});

const parseEnvInt = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const UPLOAD_MAX_IMAGE_BYTES = parseEnvInt('UPLOAD_MAX_IMAGE_BYTES', 10 * 1024 * 1024);
const UPLOAD_MAX_AUDIO_BYTES = parseEnvInt('UPLOAD_MAX_AUDIO_BYTES', 20 * 1024 * 1024);
const UPLOAD_MAX_VIDEO_BYTES = parseEnvInt('UPLOAD_MAX_VIDEO_BYTES', 80 * 1024 * 1024);
const UPLOAD_MAX_FILES = parseEnvInt('UPLOAD_MAX_FILES', 10);

const GLOBAL_FILE_SIZE_LIMIT = Math.max(
  UPLOAD_MAX_IMAGE_BYTES,
  UPLOAD_MAX_AUDIO_BYTES,
  UPLOAD_MAX_VIDEO_BYTES
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: GLOBAL_FILE_SIZE_LIMIT,
    files: UPLOAD_MAX_FILES,
  },
});

/**
 * Uniform API error shape for media endpoints.
 * Keeping this centralized prevents transport-level inconsistency across
 * validation, Cloudinary, and multer failure paths.
 */
function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown
) {
  res.status(status).json({
    success: false,
    error: {
      code,
      message,
      details,
    },
  });
}

function assertSupportedMimeType(mimeType: string): MediaResourceType {
  if (IMAGE_MIME_TYPES.has(mimeType)) return 'image';
  if (AUDIO_MIME_TYPES.has(mimeType)) return 'audio';
  if (VIDEO_MIME_TYPES.has(mimeType)) return 'video';
  throw new Error(`Unsupported media MIME type: ${mimeType}`);
}

/**
 * Validates user-provided file metadata before network upload.
 * This intentionally fails fast to avoid wasting Cloudinary quota and latency
 * on files that can never be accepted.
 */
function validateFile(file: Express.Multer.File, expectedType?: MediaResourceType) {
  const detectedType = assertSupportedMimeType(file.mimetype);
  if (expectedType && detectedType !== expectedType) {
    throw new Error(`MIME type ${file.mimetype} does not match expected type ${expectedType}`);
  }

  const byteLimit =
    detectedType === 'image'
      ? UPLOAD_MAX_IMAGE_BYTES
      : detectedType === 'audio'
        ? UPLOAD_MAX_AUDIO_BYTES
        : UPLOAD_MAX_VIDEO_BYTES;

  if (file.size > byteLimit) {
    throw new Error(`File ${file.originalname} exceeds max size for ${detectedType}`);
  }
}

router.post('/upload', (req, res) => {
  upload.array('files', UPLOAD_MAX_FILES)(req, res, async (multerError: unknown) => {
    if (multerError) {
      const err = multerError as { code?: string; message?: string };
      sendError(
        res,
        400,
        ErrorCodes.MEDIA_VALIDATION_FAILED,
        err.code === 'LIMIT_FILE_SIZE'
          ? 'One or more files exceed allowed upload size'
          : 'Invalid upload payload',
        { message: err.message }
      );
      return;
    }

    const parseResult = UploadRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, ErrorCodes.INVALID_PAYLOAD, 'Invalid upload request', parseResult.error.flatten());
      return;
    }

    const expectedType = parseResult.data.expectedType;
    const files = (req.files || []) as Express.Multer.File[];

    if (!Array.isArray(files) || files.length === 0) {
      sendError(res, 400, ErrorCodes.MEDIA_VALIDATION_FAILED, 'At least one file is required');
      return;
    }

    try {
      const uploads = [];

      for (const file of files) {
        validateFile(file, expectedType);

        const metadata = await uploadBufferToCloudinary(file);
        const resourceTypeFromMime = getResourceTypeFromMimeType(file.mimetype);
        uploads.push({
          publicId: metadata.publicId,
          secureUrl: metadata.secureUrl,
          resourceType: resourceTypeFromMime,
          width: metadata.width,
          height: metadata.height,
          duration: metadata.durationMs,
          format: metadata.format,
          bytes: metadata.bytes,
          createdAt: metadata.createdAt,
          mimeType: metadata.mimeType,
          originalFilename: metadata.originalFilename,
        });
      }

      res.status(201).json({
        success: true,
        data: {
          uploads,
          limits: {
            maxFiles: UPLOAD_MAX_FILES,
            imageBytes: UPLOAD_MAX_IMAGE_BYTES,
            audioBytes: UPLOAD_MAX_AUDIO_BYTES,
            videoBytes: UPLOAD_MAX_VIDEO_BYTES,
          },
        },
      });
    } catch (error) {
      const err = error as { code?: string; message?: string };
      const isUnsupportedMime = typeof err.message === 'string' && err.message.includes('Unsupported media MIME type');
      const isTypeMismatch = typeof err.message === 'string' && err.message.includes('does not match expected type');
      const isOversize = typeof err.message === 'string' && err.message.includes('exceeds max size');
      const isConfigError = err.code === ErrorCodes.MEDIA_VALIDATION_FAILED && err.message?.startsWith('Missing Cloudinary environment variables');

      // Error mapping keeps client UX actionable: user-fixable payload issues are
      // 4xx, upstream Cloudinary failures are surfaced as 502.
      const status = isConfigError ? 500 : (isUnsupportedMime || isTypeMismatch || isOversize ? 400 : 502);
      const code = isUnsupportedMime || isTypeMismatch || isOversize || isConfigError
        ? ErrorCodes.MEDIA_VALIDATION_FAILED
        : ErrorCodes.MEDIA_UPLOAD_FAILED;

      sendError(res, status, code, err.message || 'Media upload failed');
    }
  });
});

export default router;
