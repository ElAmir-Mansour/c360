/**
 * Client-side avatar preparation. A chosen image is validated, cover-cropped to a
 * square, and downscaled to {@link AVATAR_OUTPUT_SIZE}px, then exported as a WebP
 * (PNG fallback) base64 data URL. Doing this in the browser keeps the uploaded
 * payload tiny (tens of KB) regardless of the source file, and matches how the
 * backend stores avatars (a validated data URL on users.avatar_url).
 *
 * The server independently re-validates MIME + magic bytes + a hard size cap, so
 * this is a UX optimization, never the security boundary.
 */

/** Output edge length. A 256px square is crisp on every avatar surface we render. */
const AVATAR_OUTPUT_SIZE = 256;

/** Reject source files larger than this before we even decode them. */
export const AVATAR_MAX_SOURCE_BYTES = 5 * 1024 * 1024; // 5 MB

/** `accept` attribute for the file input — the raster types the server allows. */
export const AVATAR_ACCEPT_ATTR = 'image/png,image/jpeg,image/webp';

export type AvatarErrorCode = 'not-image' | 'too-large' | 'decode-failed' | 'process-failed';

/** Typed error so the calling component can map to a localized message. */
export class AvatarProcessingError extends Error {
  constructor(public readonly code: AvatarErrorCode) {
    super(code);
    this.name = 'AvatarProcessingError';
  }
}

async function loadDrawable(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      // `from-image` honors EXIF orientation so portrait photos aren't sideways.
      return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    } catch {
      // Fall through to the <img> path (older engines / unsupported options).
    }
  }
  return await new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new AvatarProcessingError('decode-failed'));
    };
    img.src = url;
  });
}

/**
 * Validate, square-crop, and downscale an image file into a data URL suitable for
 * `updateAvatar`. Throws {@link AvatarProcessingError} with a code the UI localizes.
 */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new AvatarProcessingError('not-image');
  }
  if (file.size > AVATAR_MAX_SOURCE_BYTES) {
    throw new AvatarProcessingError('too-large');
  }

  const source = await loadDrawable(file);
  const sw = source.width;
  const sh = source.height;
  if (!sw || !sh) {
    throw new AvatarProcessingError('decode-failed');
  }

  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_OUTPUT_SIZE;
  canvas.height = AVATAR_OUTPUT_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new AvatarProcessingError('process-failed');
  }

  // Cover-crop: scale so the shorter side fills the square, center the overflow.
  const scale = Math.max(AVATAR_OUTPUT_SIZE / sw, AVATAR_OUTPUT_SIZE / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, (AVATAR_OUTPUT_SIZE - dw) / 2, (AVATAR_OUTPUT_SIZE - dh) / 2, dw, dh);
  if ('close' in source && typeof source.close === 'function') {
    source.close(); // release the ImageBitmap
  }

  // Prefer WebP (smaller); fall back to PNG where toDataURL ignores the WebP type.
  const webp = canvas.toDataURL('image/webp', 0.85);
  if (webp.startsWith('data:image/webp')) {
    return webp;
  }
  const png = canvas.toDataURL('image/png');
  if (!png.startsWith('data:image/')) {
    throw new AvatarProcessingError('process-failed');
  }
  return png;
}
