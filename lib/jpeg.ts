// Accept only small JPEGs with a valid square frame; SVG and original uploads are never stored.
export function jpegSize(bytes: Uint8Array): number | null {
  if (bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset++] !== 255) return null;
    const marker = bytes[offset++];
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return null;
    if ([192, 193, 194].includes(marker)) {
      const height = bytes[offset + 3] * 256 + bytes[offset + 4];
      const width = bytes[offset + 5] * 256 + bytes[offset + 6];
      return width === height && width >= 32 && width <= 512 ? width : null;
    }
    offset += length;
  }
  return null;
}
