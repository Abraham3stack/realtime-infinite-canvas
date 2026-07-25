import { v2 as cloudinary } from 'cloudinary';
import { ErrorCodes } from '@realtime-canvas/shared';

export type MediaResourceType = 'image' | 'audio' | 'video';

export interface CloudinaryUploadResult {
  publicId: string;
  secureUrl: string;
  resourceType: MediaResourceType;
  width?: number;
  height?: number;
  durationMs?: number;
  format: string;
  bytes: number;
  createdAt: string;
  originalFilename: string;
  mimeType: string;
}

interface CloudinaryEnv {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  folder: string;
}

let configured = false;

function getCloudinaryEnv(): CloudinaryEnv {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const folder = process.env.CLOUDINARY_UPLOAD_FOLDER || 'realtime-infinite-canvas';

  if (!cloudName || !apiKey || !apiSecret) {
    const missing = [
      !cloudName ? 'CLOUDINARY_CLOUD_NAME' : null,
      !apiKey ? 'CLOUDINARY_API_KEY' : null,
      !apiSecret ? 'CLOUDINARY_API_SECRET' : null,
    ].filter((v): v is string => v !== null);

    const err = new Error(`Missing Cloudinary environment variables: ${missing.join(', ')}`);
    (err as Error & { code?: string }).code = ErrorCodes.MEDIA_VALIDATION_FAILED;
    throw err;
  }

  return { cloudName, apiKey, apiSecret, folder };
}

function ensureCloudinaryConfigured(): CloudinaryEnv {
  const env = getCloudinaryEnv();
  if (!configured) {
    cloudinary.config({
      cloud_name: env.cloudName,
      api_key: env.apiKey,
      api_secret: env.apiSecret,
      secure: true,
    });
    configured = true;
  }
  return env;
}

export function getResourceTypeFromMimeType(mimeType: string): MediaResourceType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  throw new Error(`Unsupported MIME type: ${mimeType}`);
}

export async function uploadBufferToCloudinary(
  file: Express.Multer.File
): Promise<CloudinaryUploadResult> {
  const env = ensureCloudinaryConfigured();
  const resourceType = getResourceTypeFromMimeType(file.mimetype);

  const uploaded = await new Promise<{
    public_id: string;
    secure_url: string;
    resource_type: string;
    width?: number;
    height?: number;
    duration?: number;
    format: string;
    bytes: number;
    created_at: string;
    original_filename?: string;
  }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: env.folder,
        resource_type: resourceType === 'image' ? 'image' : 'video',
        use_filename: false,
        unique_filename: true,
      },
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error('Cloudinary upload returned empty result'));
          return;
        }
        resolve(result as {
          public_id: string;
          secure_url: string;
          resource_type: string;
          width?: number;
          height?: number;
          duration?: number;
          format: string;
          bytes: number;
          created_at: string;
          original_filename?: string;
        });
      }
    );

    stream.end(file.buffer);
  });

  return {
    publicId: uploaded.public_id,
    secureUrl: uploaded.secure_url,
    resourceType,
    width: typeof uploaded.width === 'number' ? uploaded.width : undefined,
    height: typeof uploaded.height === 'number' ? uploaded.height : undefined,
    durationMs: typeof uploaded.duration === 'number' ? Math.round(uploaded.duration * 1000) : undefined,
    format: uploaded.format,
    bytes: uploaded.bytes,
    createdAt: uploaded.created_at,
    originalFilename: uploaded.original_filename ?? file.originalname,
    mimeType: file.mimetype,
  };
}
