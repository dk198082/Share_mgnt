import { useRequestUploadUrl } from '@workspace/api-client-react';

export const DOC_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain'];
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_BYTES = 10 * 1024 * 1024;

export function validateFile(file: File, allowed: string[]): string | null {
  if (!allowed.includes(file.type)) {
    return `${file.name}: unsupported type. Allowed: ${allowed === IMAGE_TYPES ? 'JPEG, PNG, WebP' : 'PDF, JPEG, PNG, WebP, plain text'}.`;
  }
  if (file.size > MAX_BYTES) return `${file.name}: exceeds the 10 MB limit.`;
  if (file.size < 1) return `${file.name}: file is empty.`;
  return null;
}

/** Two-step upload: request signed URL via API, then PUT bytes directly to storage. */
export function useUploader() {
  const req = useRequestUploadUrl();
  return async (file: File): Promise<string> => {
    const { uploadURL, objectPath } = await req.mutateAsync({
      data: { name: file.name, size: file.size, contentType: file.type },
    });
    const res = await fetch(uploadURL, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    });
    if (!res.ok) throw new Error(`Storage rejected ${file.name} (${res.status}).`);
    return objectPath;
  };
}
