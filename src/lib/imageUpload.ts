import { supabase } from '@/lib/supabase';

// Shared by SellProductPage and EditProductPage so the compression/
// validation/upload pipeline lives in exactly one place instead of being
// copy-pasted across both forms.

export const MAX_IMAGES = 5;
export const MAX_ORIGINAL_FILE_SIZE = 20 * 1024 * 1024; // 20MB - generous, since we compress before upload anyway
export const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

export type ImageStatus = 'compressing' | 'uploading' | 'done' | 'error';

export interface ImageUploadItem {
  id: string;
  file: File;
  previewUrl: string;
  status: ImageStatus;
  uploadedUrl?: string;
  error?: string;
}

// Browsers (other than Safari, inconsistently) generally cannot decode
// HEIC/HEIF via an <img> element at all - this is the single most common
// real-world cause of "some images fail to upload" for a marketplace app:
// photos taken directly on an iPhone are HEIC by default. There's no
// reliable client-side decode path without a heavy WASM library, so we
// detect it upfront and give an honest, specific, actionable message
// instead of letting it fail deep inside canvas decoding with a vague error.
export function validateImageFile(file: File): string | null {
  if (file.size > MAX_ORIGINAL_FILE_SIZE) {
    return `File is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 20MB.`;
  }
  if (file.type === 'image/heic' || file.type === 'image/heif' || /\.hei[cf]$/i.test(file.name)) {
    return 'HEIC photos from iPhone aren\u2019t supported yet. Please use JPEG, PNG, or WEBP (in your iPhone camera settings, switch Formats to "Most Compatible").';
  }
  if (!SUPPORTED_TYPES.includes(file.type) && file.type !== '') {
    return `Unsupported file type (${file.type || 'unknown'}). Please use JPEG, PNG, or WEBP.`;
  }
  return null;
}

// Downscales and re-encodes an image client-side before it ever hits the
// network - keeps uploads fast and storage usage sane instead of shipping
// raw phone-camera photos (often 5-10MB each).
export function compressImage(file: File, maxDimension = 1600, quality = 0.8): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      URL.revokeObjectURL(objectUrl);
      if (!ctx) {
        reject(new Error('Canvas not supported in this browser'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Image compression failed'))),
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not read image file'));
    };
    img.src = objectUrl;
  });
}

// Compresses + uploads a single image to the product-images bucket under
// the given user's own folder (required by the "own folder" storage RLS
// policies), returning its public URL. Throws on any failure - callers are
// responsible for catching and reflecting that in their own per-item state.
export async function uploadProductImage(file: File, userId: string, itemId: string): Promise<string> {
  const validationError = validateImageFile(file);
  if (validationError) {
    throw new Error(validationError);
  }

  const compressed = await compressImage(file);
  const path = `${userId}/${itemId}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from('product-images')
    .upload(path, compressed, { contentType: 'image/jpeg', upsert: true });

  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from('product-images').getPublicUrl(path);
  return publicUrlData.publicUrl;
}

// Best-effort deletion of an uploaded file from Storage. Never throws -
// an orphaned file in Storage is a minor cleanup issue, not something that
// should block the UI (e.g. removing an image from a form that hasn't been
// submitted yet).
export async function deleteProductImage(userId: string, itemId: string): Promise<void> {
  try {
    await supabase.storage.from('product-images').remove([`${userId}/${itemId}.jpg`]);
  } catch (err) {
    console.error('[imageUpload] Failed to delete storage object:', err);
  }
}
