import type { ImageAsset } from '../core/model';
import { FolioError } from '../core/errors';

export function imageMime(bytes: Uint8Array): ImageAsset['mime'] | undefined {
  if (bytes.length >= 24 && bytes[0] === 137 && new TextDecoder('ascii').decode(bytes.subarray(1, 4)) === 'PNG' && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16), height = view.getUint32(20);
    if (!width || !height || width * height > 20_000_000) throw new FolioError('IMAGE_LIMIT', 'An image exceeds the 20 megapixel limit. Resize the image and save a fresh document.');
    return 'image/png';
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    let pos = 2;
    while (pos + 4 <= bytes.length) {
      if (bytes[pos++] !== 255) break;
      while (bytes[pos] === 255) pos++;
      const marker = bytes[pos++]; if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      const length = (bytes[pos] << 8) | bytes[pos + 1];
      if (length < 2 || pos + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
        const height = (bytes[pos + 3] << 8) | bytes[pos + 4], width = (bytes[pos + 5] << 8) | bytes[pos + 6];
        if (!width || !height || width * height > 20_000_000) throw new FolioError('IMAGE_LIMIT', 'An image exceeds the 20 megapixel limit. Resize the image and save a fresh document.');
        return 'image/jpeg';
      }
      pos += length;
    }
  }
  return undefined;
}
