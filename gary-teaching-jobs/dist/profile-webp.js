export const maxProfilePhotoBytes = 100 * 1024;

const metadataChunks = new Set(['ICCP', 'EXIF', 'XMP ']);

// The crop is drawn in sRGB. Keep the encoded frame and any alpha data,
// discarding the chunks that carry a color profile or other metadata.
/** @param {Uint8Array} bytes */
export function normalizeProfileWebp(bytes) {
  if (bytes.length < 20 || bytes.length > maxProfilePhotoBytes) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = offset => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  const u24 = offset => view.getUint8(offset) + 256 * view.getUint16(offset + 1, true);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WEBP' || view.getUint32(4, true) !== bytes.length - 8) return null;

  let width = 0, height = 0;
  let extended, frame, alpha;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) return null;
    const type = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + size + (size % 2);
    if (end > bytes.length || (size % 2 && bytes[end - 1] !== 0)) return null;
    const chunk = bytes.subarray(offset, end);
    offset = end;

    if (metadataChunks.has(type)) continue;
    if (type === 'ANIM' || type === 'ANMF') return null;
    if (type === 'VP8X') {
      // The only allowed flags are ICC, alpha, EXIF, and XMP.
      if (start !== 20 || size !== 10 || (view.getUint32(start) & 0xc3ffffff) !== 0) return null;
      extended = {chunk, flags: bytes[start], width: u24(start + 4) + 1, height: u24(start + 7) + 1};
    } else if (type === 'ALPH') {
      if (frame || alpha || !extended || !(extended.flags & 0x10) || !size) return null;
      alpha = chunk;
    } else if (type === 'VP8 ') {
      if (frame || size < 10 || (bytes[start] & 1) !== 0 ||
          bytes[start + 3] !== 0x9d || bytes[start + 4] !== 1 || bytes[start + 5] !== 0x2a ||
          (u24(start) >>> 5) > size - 10) return null;
      width = view.getUint16(start + 6, true) & 0x3fff;
      height = view.getUint16(start + 8, true) & 0x3fff;
      frame = chunk;
    } else if (type === 'VP8L') {
      if (frame || alpha || size < 5 || bytes[start] !== 0x2f) return null;
      const dimensions = view.getUint32(start + 1, true);
      if (dimensions >>> 29) return null;
      width = (dimensions & 0x3fff) + 1;
      height = ((dimensions >>> 14) & 0x3fff) + 1;
      frame = chunk;
    } else if (!frame) {
      // WebP permits custom ancillary chunks after the image data.
      return null;
    }
  }

  if (!frame || !width || !height || width > 512 || height > 512 ||
      (extended && (extended.width !== width || extended.height !== height))) return null;

  const chunks = alpha ? [extended.chunk, alpha, frame] : [frame];
  const size = 12 + chunks.reduce((length, chunk) => length + chunk.length, 0);
  if (size === bytes.length && (!alpha || extended.flags === 0x10)) return bytes;

  const output = new Uint8Array(size);
  output.set(bytes.subarray(0, 12));
  new DataView(output.buffer).setUint32(4, size - 8, true);
  let offset = 12;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  if (alpha) output[20] = 0x10;
  return output;
}
