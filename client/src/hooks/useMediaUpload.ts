export type MediaUploadType = 'image' | 'audio' | 'video';

export interface UploadedMedia {
  publicId: string;
  secureUrl: string;
  resourceType: MediaUploadType;
  width?: number;
  height?: number;
  duration?: number;
  format: string;
  bytes: number;
  createdAt: string;
  mimeType: string;
  originalFilename: string;
}

interface UploadResponse {
  success: boolean;
  data?: {
    uploads: UploadedMedia[];
  };
  error?: {
    code: string;
    message: string;
  };
}

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/**
 * Uploads one or more media files and returns normalized metadata used for
 * canvas object creation.
 *
 * Uses XMLHttpRequest instead of fetch because upload progress events are needed
 * for responsive UI feedback during potentially large audio/video uploads.
 */
export async function uploadMediaFiles(params: {
  files: File[];
  expectedType: MediaUploadType;
  sessionToken: string;
  onProgress?: (percent: number) => void;
}): Promise<UploadedMedia[]> {
  const { files, expectedType, sessionToken, onProgress } = params;

  const formData = new FormData();
  formData.append('expectedType', expectedType);
  files.forEach((file) => formData.append('files', file));

  const response = await new Promise<UploadResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/media/upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${sessionToken}`);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onerror = () => reject(new Error('Network error while uploading media'));

    xhr.onload = () => {
      let parsed: UploadResponse | null = null;
      try {
        parsed = JSON.parse(xhr.responseText) as UploadResponse;
      } catch {
        reject(new Error(`Upload failed with status ${xhr.status}`));
        return;
      }

      if (xhr.status < 200 || xhr.status >= 300 || !parsed.success || !parsed.data) {
        reject(new Error(parsed.error?.message || `Upload failed with status ${xhr.status}`));
        return;
      }

      resolve(parsed);
    };

    xhr.send(formData);
  });

  return response.data?.uploads ?? [];
}
