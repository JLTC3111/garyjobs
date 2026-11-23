import {Image} from 'imagescript';

export const maxImageBytes = 4 * 1024 * 1024;
const webpQualities = [88, 75, 60, 45, 30];

export function imageType(value) {
  const type = (value || '').split(';', 1)[0].trim().toLowerCase();
  return ['image/jpeg', 'image/png', 'image/webp'].includes(type) ? type : '';
}

function pngSize(bytes, view) {
  if (bytes.length < 45 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a ||
      view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) return;
  const width = view.getUint32(16), height = view.getUint32(20);
  let hasData = false;
  for (let offset = 33; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset), type = view.getUint32(offset + 4);
    offset += length + 12;
    if (offset > bytes.length || type === 0x6163544c) return; // Reject truncated chunks and APNG.
    if (type === 0x49444154 && length > 0) hasData = true;
    if (type === 0x49454e44) return hasData && length === 0 && offset === bytes.length ? {width, height} : undefined;
  }
}

function jpegSize(bytes, view) {
  if (bytes.length < 20 || view.getUint16(0) !== 0xffd8 || view.getUint16(bytes.length - 2) !== 0xffd9) return;
  let size;
  for (let offset = 2; offset + 4 < bytes.length;) {
    if (bytes[offset++] !== 0xff) return;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (offset + 2 > bytes.length) return;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length - 2) return;
    if (marker === 0xda) return size && length >= 6 && offset + length < bytes.length - 2 ? size : undefined;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (length < 11) return;
      size = {height: view.getUint16(offset + 3), width: view.getUint16(offset + 5)};
    }
    offset += length;
  }
}

function webpSize(bytes, view) {
  if (bytes.length < 26 || view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x57454250 ||
      view.getUint32(4, true) + 8 !== bytes.length) return;
  let canvas, size, offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = view.getUint32(offset), length = view.getUint32(offset + 4, true), start = offset + 8;
    offset = start + length + length % 2;
    if (offset > bytes.length || type === 0x414e494d || type === 0x414e4d46) return; // Still images only.
    if (type === 0x56503858) {
      if (length !== 10 || bytes[start] & 2) return;
      const dimension = index => 1 + bytes[index] + (bytes[index + 1] << 8) + (bytes[index + 2] << 16);
      canvas = {width: dimension(start + 4), height: dimension(start + 7)};
    } else if (type === 0x56503820 && length > 10 && !(bytes[start] & 1) &&
               bytes[start + 3] === 0x9d && view.getUint16(start + 4) === 0x012a) {
      size = {width: view.getUint16(start + 6, true) & 0x3fff, height: view.getUint16(start + 8, true) & 0x3fff};
    } else if (type === 0x5650384c && length > 5 && bytes[start] === 0x2f) {
      const bits = view.getUint32(start + 1, true);
      if (bits >>> 29) return;
      size = {width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1};
    }
  }
  if (offset !== bytes.length || !size || canvas && (canvas.width !== size.width || canvas.height !== size.height)) return;
  return size;
}

export function inspectImage(bytes, type) {
  if (!bytes.length || bytes.length > maxImageBytes) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = type === 'image/png' ? pngSize(bytes, view) :
    type === 'image/jpeg' ? jpegSize(bytes, view) : type === 'image/webp' ? webpSize(bytes, view) : undefined;
  if (!size || size.width < 1 || size.height < 1 || size.width > 4096 || size.height > 4096 ||
      size.width * size.height > 12000000) return;
  return size;
}

function pixelLimits(width, height) {
  return width >= 1 && height >= 1 && width <= 4096 && height <= 4096 && width * height <= 12000000;
}

// JPEG and PNG are stored once as lossy WebP. Camera orientation is applied, which can swap
// width and height, and the pixels are not scaled. An existing WebP is stored unchanged.
export async function storedVacancyImage(bytes, type, encode) {
  const source = inspectImage(bytes, type);
  if (!source) return {error: 'invalid_file'};
  if (type === 'image/webp') return {bytes, type, width: source.width, height: source.height};
  let image;
  try { image = await Image.decode(bytes); } catch { return {error: 'invalid_file'}; }
  const width = image?.width, height = image?.height;
  if (!pixelLimits(width, height) || typeof image.encodeWebP !== 'function') return {error: 'invalid_file'};
  const encodeWebP = encode || (quality => image.encodeWebP({quality, threads: 1}));
  try {
    for (const quality of webpQualities) {
      const encoded = new Uint8Array(await encodeWebP(quality));
      if (encoded.byteLength > maxImageBytes) continue;
      const size = inspectImage(encoded, 'image/webp');
      if (!size || size.width !== width || size.height !== height) return {error: 'invalid_file'};
      return {bytes: encoded, type: 'image/webp', width, height};
    }
  } catch { return {error: 'invalid_file'}; }
  return {error: 'file_size'};
}

export async function boundedImageBody(request) {
  if (!request.body || Number(request.headers.get('content-length')) > maxImageBytes) return;
  const reader = request.body.getReader(), chunks = [];
  let length = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxImageBytes) { await reader.cancel(); return; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
