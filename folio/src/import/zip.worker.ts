import { inflateBoundedArchive } from './zipCodec';
import { FolioError } from '../core/errors';

self.onmessage = async (event: MessageEvent<Uint8Array>) => {
  try {
    const parts = await inflateBoundedArchive(event.data);
    const values = Array.from(parts.entries());
    self.postMessage({ parts: values }, { transfer: values.map(([, bytes]) => bytes.buffer) });
  } catch (error) {
    self.postMessage({ error: error instanceof FolioError ? { code: error.code, message: error.message } : { code: 'ARCHIVE_INVALID', message: 'The archive is corrupt or unsupported. Choose a valid document or project backup.' } });
  }
};
