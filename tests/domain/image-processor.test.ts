import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  detectImageFormat,
  MAX_DIMENSION,
  MAX_UPLOAD_BYTES,
  processImage,
  VARIANTS,
} from '@/infra/images/processor';

/**
 * Image upload security.
 *
 * Every test here feeds the processor something a hostile uploader might send
 * and asserts the specific protection holds. These are the controls promised
 * in docs/08-security-architecture.md, exercised against the real sharp build
 * rather than described.
 */

async function jpeg(width = 200, height = 150): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#3a7' } })
    .jpeg()
    .toBuffer();
}

async function jpegWithGps(): Promise<Buffer> {
  const base = await jpeg();
  // sharp's Exif type does not declare a GPS IFD, but libvips writes whatever
  // it is given. The cast expresses the case we actually care about: location
  // data reaching a published photo.
  const exif = {
    IFD0: { Copyright: 'Seller Home Address' },
    GPS: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'W' },
  } as Record<string, Record<string, string>>;

  return sharp(base).withExif(exif).jpeg().toBuffer();
}

describe('format detection by magic bytes', () => {
  it('identifies real formats', async () => {
    expect(detectImageFormat(await jpeg())).toBe('jpeg');
    expect(
      detectImageFormat(
        await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } })
          .png()
          .toBuffer(),
      ),
    ).toBe('png');
    expect(
      detectImageFormat(
        await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } })
          .webp()
          .toBuffer(),
      ),
    ).toBe('webp');
  });

  it('does not trust a filename or Content-Type', () => {
    // A `.jpg` name on an HTML document proves nothing.
    expect(detectImageFormat(Buffer.from('<html><body>hello there</body></html>'))).toBeNull();
    expect(detectImageFormat(Buffer.from('%PDF-1.7 trailer startxref'))).toBeNull();
    expect(detectImageFormat(Buffer.from('PK archive content here'))).toBeNull();
  });

  it('returns null for something too short to identify', () => {
    expect(detectImageFormat(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});

describe('processImage', () => {
  it('accepts a real image and produces every derivative', async () => {
    const result = await processImage(await jpeg(1200, 900));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.detectedFormat).toBe('jpeg');
    expect(result.width).toBe(1200);
    expect(result.variants.map((v) => v.name)).toEqual(VARIANTS.map((v) => v.name));
    // Everything is re-encoded to WebP, regardless of what came in.
    for (const variant of result.variants) {
      expect(variant.contentType).toBe('image/webp');
      expect(detectImageFormat(variant.body)).toBe('webp');
    }
  });

  it('STRIPS EXIF, including GPS', async () => {
    // A seller photographing an item at home must not publish their location.
    const original = await jpegWithGps();
    expect((await sharp(original).metadata()).exif).toBeDefined();

    const result = await processImage(original);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const variant of result.variants) {
      expect((await sharp(variant.body).metadata()).exif).toBeUndefined();
    }
  });

  it('DESTROYS a payload appended to a valid image', async () => {
    // The polyglot: valid JPEG bytes with script bolted on the end.
    const payload = '<script>alert(document.cookie)</script>';
    const polyglot = Buffer.concat([await jpeg(), Buffer.from(payload)]);

    const result = await processImage(polyglot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const variant of result.variants) {
      expect(variant.body.includes(Buffer.from(payload))).toBe(false);
    }
  });

  it('REJECTS SVG, a document format that can carry script', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><script>alert(1)</script></svg>',
    );
    const result = await processImage(svg);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported_format');
  });

  it('rejects HTML, PDF and archives named as images', async () => {
    for (const bytes of [
      Buffer.from('<html><script>alert(1)</script></html>'),
      Buffer.from('%PDF-1.7 trailer'),
      Buffer.from('PK'),
      Buffer.from('#!/bin/sh rm -rf /'),
    ]) {
      const result = await processImage(bytes);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects an empty upload', async () => {
    const result = await processImage(Buffer.alloc(0));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('empty');
  });

  it('rejects a file above the size cap', async () => {
    const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0xff);
    oversized[0] = 0xff;
    oversized[1] = 0xd8;
    oversized[2] = 0xff;
    const result = await processImage(oversized);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too_large');
  });

  it('rejects dimensions beyond the cap', async () => {
    const huge = await sharp({
      create: { width: MAX_DIMENSION + 10, height: 10, channels: 3, background: '#fff' },
    })
      .jpeg()
      .toBuffer();
    const result = await processImage(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('dimensions_too_large');
  });

  it('rejects truncated bytes that merely start like a JPEG', async () => {
    const truncated = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(200, 0)]);
    const result = await processImage(truncated);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unreadable');
  });

  it('does not enlarge a small image', async () => {
    const result = await processImage(await jpeg(100, 80));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const variant of result.variants) {
      expect(variant.width).toBeLessThanOrEqual(100);
    }
  });

  it('produces a stable checksum of the original', async () => {
    const bytes = await jpeg();
    const first = await processImage(bytes);
    const second = await processImage(Buffer.from(bytes));
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(first.checksumSha256).toBe(second.checksumSha256);
  });
});
