import { createHash } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';

/**
 * Image validation and re-encoding.
 *
 * Everything here treats the uploaded bytes as hostile:
 *
 *   - The client's Content-Type and filename are IGNORED. Format is decided by
 *     magic bytes, because a `.jpg` name proves nothing.
 *   - SVG is rejected outright: it is a document format that can carry script,
 *     and no marketplace listing needs it.
 *   - Every accepted image is FULLY RE-ENCODED. That strips EXIF (including
 *     GPS — a seller photographing an item at home must not publish their
 *     coordinates) and destroys any payload appended to a valid image.
 *   - Dimensions and pixel count are capped, so a small file that decompresses
 *     to gigabytes cannot exhaust memory.
 *
 * Verified against the installed sharp: an appended `<script>` does not survive
 * re-encoding, and EXIF is absent afterwards (tests/domain/image-processor.test.ts).
 */

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
export const MAX_DIMENSION = 6000;
/** Guards against decompression bombs: a tiny file claiming vast dimensions. */
export const MAX_PIXELS = 40_000_000;

/** Formats accepted from users, by DETECTED type. */
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'gif']);

export interface ImageVariantSpec {
  readonly name: string;
  readonly width: number;
  readonly quality: number;
}

/** Derivatives generated for every accepted image. */
export const VARIANTS: readonly ImageVariantSpec[] = [
  { name: 'thumb', width: 320, quality: 72 },
  { name: 'card', width: 720, quality: 78 },
  { name: 'full', width: 1600, quality: 82 },
];

export type ImageRejection =
  | 'too_large'
  | 'unreadable'
  | 'unsupported_format'
  | 'dimensions_too_large'
  | 'too_many_pixels'
  | 'empty';

export interface ProcessedVariant {
  readonly name: string;
  readonly body: Buffer;
  readonly width: number;
  readonly height: number;
  readonly contentType: 'image/webp';
}

export type ImageProcessingResult =
  | {
      readonly ok: true;
      readonly detectedFormat: string;
      readonly width: number;
      readonly height: number;
      readonly byteSize: number;
      readonly checksumSha256: string;
      readonly variants: readonly ProcessedVariant[];
    }
  | { readonly ok: false; readonly reason: ImageRejection; readonly detail?: string };

/**
 * Detects format from the leading bytes.
 *
 * Independent of sharp so the decision to reject happens BEFORE handing
 * attacker-controlled bytes to a decoder.
 */
export function detectImageFormat(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii');
    if (brand.startsWith('avif') || brand.startsWith('avis') || brand.startsWith('mif1'))
      return 'avif';
  }
  const gif = buffer.subarray(0, 6).toString('ascii');
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'gif';

  return null;
}

export async function processImage(buffer: Buffer): Promise<ImageProcessingResult> {
  if (buffer.length === 0) return { ok: false, reason: 'empty' };
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: 'too_large', detail: `${buffer.length} bytes` };
  }

  const detectedFormat = detectImageFormat(buffer);
  if (detectedFormat === null || !ACCEPTED_FORMATS.has(detectedFormat)) {
    // Covers SVG, HTML, PDF, archives, and anything merely NAMED .jpg.
    return { ok: false, reason: 'unsupported_format', detail: detectedFormat ?? 'unrecognised' };
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(buffer, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch (error) {
    return { ok: false, reason: 'unreadable', detail: (error as Error).message.slice(0, 120) };
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width === 0 || height === 0) return { ok: false, reason: 'unreadable' };

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    return { ok: false, reason: 'dimensions_too_large', detail: `${width}x${height}` };
  }
  if (width * height > MAX_PIXELS) {
    return { ok: false, reason: 'too_many_pixels', detail: `${width * height}` };
  }

  // sharp reports the format it actually decoded; if that disagrees with the
  // magic bytes, something is lying and the upload is refused.
  if (metadata.format !== undefined && metadata.format !== detectedFormat) {
    return {
      ok: false,
      reason: 'unsupported_format',
      detail: `${detectedFormat}/${metadata.format}`,
    };
  }

  const variants: ProcessedVariant[] = [];
  for (const spec of VARIANTS) {
    const pipeline = sharp(buffer, { limitInputPixels: MAX_PIXELS })
      // Applies the EXIF orientation, then discards the metadata with it.
      .rotate()
      .resize({ width: Math.min(spec.width, width), withoutEnlargement: true })
      .webp({ quality: spec.quality });

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    variants.push({
      name: spec.name,
      body: data,
      width: info.width,
      height: info.height,
      contentType: 'image/webp',
    });
  }

  return {
    ok: true,
    detectedFormat,
    width,
    height,
    byteSize: buffer.length,
    checksumSha256: createHash('sha256').update(buffer).digest('hex'),
    variants,
  };
}
