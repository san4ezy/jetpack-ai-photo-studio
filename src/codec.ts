export const SUPPORTED_IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.bmp',
  '.tiff',
] as const;

export interface DecodedEnvelope<TMeta> {
  meta: TMeta;
  binary: Uint8Array;
}

export function isSupportedImageFilename(filename: string): boolean {
  const trimmed = filename.trim();
  if (!trimmed || trimmed.startsWith('.')) return false;
  const dot = trimmed.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = trimmed.slice(dot).toLowerCase();
  return (SUPPORTED_IMAGE_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Decodes `[4-byte uint32 LE meta_len] + [UTF-8 JSON meta] + [raw binary bytes]`
 * using zero-copy `Uint8Array.subarray` slicing.
 */
export function decodeEnvelope<TMeta>(payload: Uint8Array): DecodedEnvelope<TMeta> {
  if (payload.byteLength < 4) {
    throw new Error(`Corrupt worker envelope: expected >= 4 bytes, got ${payload.byteLength}`);
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const metaLen = view.getUint32(0, true);
  if (4 + metaLen > payload.byteLength) {
    throw new Error(
      `Corrupt worker envelope: meta length ${metaLen} exceeds payload ${payload.byteLength}`
    );
  }
  const metaSlice = payload.subarray(4, 4 + metaLen);
  const metaJson = new TextDecoder().decode(metaSlice);
  const meta = JSON.parse(metaJson) as TMeta;
  const binary = payload.subarray(4 + metaLen);
  return { meta, binary };
}

export function sliceToUint8Array(
  binary: Uint8Array,
  offset: number,
  length: number
): Uint8Array {
  if (offset < 0 || length < 0 || offset + length > binary.byteLength) {
    throw new Error(
      `Binary slice out of bounds: offset=${offset}, length=${length}, total=${binary.byteLength}`
    );
  }
  return binary.subarray(offset, offset + length);
}

export function uint8ArrayToBlob(bytes: Uint8Array, mimeType: string): Blob {
  const copySafe =
    bytes.buffer instanceof ArrayBuffer
      ? (bytes as Uint8Array<ArrayBuffer>)
      : bytes.slice();
  return new Blob([copySafe], { type: mimeType });
}

export function sliceToBlobUrl(
  binary: Uint8Array,
  offset: number,
  length: number,
  mimeType: string
): string {
  const slice = sliceToUint8Array(binary, offset, length);
  return URL.createObjectURL(uint8ArrayToBlob(slice, mimeType));
}
