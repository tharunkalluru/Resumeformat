import JSZip from 'jszip';
import { FolioError } from '../core/errors';

const MAX_ENTRIES = 512;
const MAX_TOTAL = 50 * 1024 * 1024;
const MAX_XML = 8 * 1024 * 1024;
const MAX_ENTRY = 20 * 1024 * 1024;
interface Entry { name: string; size: number; compressed: number; crc: number }
const fail = (message = 'The archive is corrupt or uses an unsupported ZIP feature. Choose a valid document or project backup.') => new FolioError('ARCHIVE_INVALID', message);
const decoder = new TextDecoder('utf-8', { fatal: true });
export function safePartName(name: string): boolean {
  return !!name && !name.startsWith('/') && !name.includes('\\') && !name.includes('\0') && !name.includes(':') && name.split('/').every(part => part !== '..' && part !== '.');
}
export function inspectZip(bytes: Uint8Array): Entry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  if (end < 0) throw fail();
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== view.getUint16(end + 10, true)) throw fail();
  const count = view.getUint16(end + 10, true), centralSize = view.getUint32(end + 12, true), start = view.getUint32(end + 16, true);
  if (!count || count > MAX_ENTRIES || start + centralSize !== end) throw fail('The archive exceeds the supported ZIP entry or metadata limits.');
  const names = new Set<string>(), entries: Entry[] = [];
  let pos = start, total = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || view.getUint32(pos, true) !== 0x02014b50) throw fail();
    const flags = view.getUint16(pos + 8, true), method = view.getUint16(pos + 10, true);
    const compressed = view.getUint32(pos + 20, true), size = view.getUint32(pos + 24, true), nameSize = view.getUint16(pos + 28, true);
    const extra = view.getUint16(pos + 30, true), comment = view.getUint16(pos + 32, true), offset = view.getUint32(pos + 42, true);
    if (flags & 1 || flags & 0x40) throw new FolioError('ENCRYPTED_DOCUMENT', 'Encrypted archives are not supported. Save an unencrypted copy first.');
    if (![0, 8].includes(method) || [compressed, size, offset].includes(0xffffffff) || view.getUint16(pos + 34, true)) throw fail();
    if (pos + 46 + nameSize + extra + comment > end) throw fail();
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameSize));
    if (!safePartName(name) || names.has(name)) throw fail('The archive has unsafe or duplicate ZIP paths.');
    names.add(name);
    // Exact owned portable profile paths are bounded before JSZip/worker inflation.
    if (/^(?:colors\/0\.icc|projects\/[0-9]+\/colors\/0\.icc)$/.test(name) && size > 65536) throw fail('The portable color profile exceeds its 64 KiB decompression limit.');
    total += size;
    if (size > (name.endsWith('.xml') || name.endsWith('.rels') ? MAX_XML : MAX_ENTRY) || total > MAX_TOTAL || (size > 1024 * 1024 && size > Math.max(1, compressed) * 200))
      throw fail('The archive exceeds safe decompression limits.');
    if (offset + 30 > start || view.getUint32(offset, true) !== 0x04034b50) throw fail();
    const localName = view.getUint16(offset + 26, true), localExtra = view.getUint16(offset + 28, true);
    if (offset + 30 + localName + localExtra + compressed > start || view.getUint16(offset + 8, true) !== method || view.getUint16(offset + 6, true) !== flags || decoder.decode(bytes.subarray(offset + 30, offset + 30 + localName)) !== name) throw fail();
    entries.push({ name, size, compressed, crc: view.getUint32(pos + 16, true) });
    pos += 46 + nameSize + extra + comment;
  }
  if (pos !== end) throw fail();
  return entries;
}
const crcTable = new Uint32Array(256).map((_, value) => {
  let crc = value; for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; return crc >>> 0;
});
function crc32(bytes: Uint8Array): number { let crc = 0xffffffff; for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]; return (crc ^ 0xffffffff) >>> 0; }
export async function inflateBoundedArchive(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const started = performance.now();
  const entries = inspectZip(bytes);
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes, { createFolders: false, checkCRC32: false }); } catch { throw fail(); }
  const parts = new Map<string, Uint8Array>();
  let total = 0;
  for (const entry of entries) {
    if (performance.now() - started > 15000) throw fail('Archive decompression exceeded 15 seconds.');
    const file = zip.file(entry.name);
    if (entry.name.endsWith('/')) continue;
    if (!file) throw fail();
    const data = await new Promise<Uint8Array>((resolve, reject) => {
      const chunks: Uint8Array[] = []; let size = 0, settled = false;
      // Public documented JSZip API omitted from its type declarations.
      const stream = (file as JSZip.JSZipObject & { internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array> }).internalStream('uint8array');
      const timer = setTimeout(() => { settled = true; stream.pause(); reject(fail('Archive decompression took too long.')); }, 15000);
      stream.on('data', chunk => {
        if (settled) return;
        size += chunk.length;
        if (size > entry.size || size + total > MAX_TOTAL) { settled = true; clearTimeout(timer); stream.pause(); reject(fail('The archive exceeds actual decompression limits.')); return; }
        chunks.push(chunk);
      });
      stream.on('error', () => { if (!settled) { settled = true; clearTimeout(timer); reject(fail()); } });
      stream.on('end', () => {
        if (settled) return; settled = true; clearTimeout(timer);
        if (size !== entry.size) { reject(fail()); return; }
        const result = new Uint8Array(size); let pos = 0;
        for (const chunk of chunks) { result.set(chunk, pos); pos += chunk.length; }
        if (crc32(result) !== entry.crc) { reject(fail()); return; }
        resolve(result);
      });
      stream.resume();
    });
    total += data.length; parts.set(entry.name, data);
  }
  return parts;
}
