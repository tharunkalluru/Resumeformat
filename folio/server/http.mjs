import { createServer } from 'node:http';
import { z } from 'zod';
import { SafeAiError } from './adapter.mjs';
import { MAX_BODY_BYTES } from './contract.mjs';

export const FRONTEND_ORIGIN = 'http://127.0.0.1:4594';
export const BACKEND_HOST = '127.0.0.1';
export const BACKEND_PORT = 4596;
const ALLOWED_HOSTS = new Set(['127.0.0.1:4594', '127.0.0.1:4596']);
const VERIFY_SCHEMA = z.object({}).strict();

class SafeHttpError extends Error {
  constructor(code, status, message) { super(message); this.code = code; this.status = status; }
}

function checkRequestOrigin(request) {
  const countHeader = name => request.rawHeaders.filter((_, index) => index % 2 === 0 && request.rawHeaders[index].toLowerCase() === name).length;
  if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress) ||
      countHeader('host') !== 1 || !ALLOWED_HOSTS.has(request.headers.host)) {
    throw new SafeHttpError('forbidden_host', 403, 'Use the approved local Folio address.');
  }
  const origin = request.headers.origin;
  if (countHeader('origin') > 1 || (origin !== undefined && origin !== FRONTEND_ORIGIN) ||
      (request.method === 'POST' && origin !== FRONTEND_ORIGIN)) {
    throw new SafeHttpError('forbidden_origin', 403, 'This request must come from the local Folio workspace.');
  }
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new SafeHttpError('forbidden_origin', 403, 'This request must come from the local Folio workspace.');
}

async function readJson(request) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '') ||
      request.headers['content-encoding'] !== undefined) {
    throw new SafeHttpError('unsupported_content_type', 415, 'Send an uncompressed JSON request.');
  }
  const declared = request.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    throw new SafeHttpError('body_too_large', 413, 'The request exceeds the allowed size.');
  }
  const chunks = [];
  let bytes = 0;
  // Event listeners allow a safe 413 response without destroying the socket.
  return await new Promise((resolve, reject) => {
    let settled = false;
    const fail = error => { if (!settled) { settled = true; reject(error); } };
    request.on('data', chunk => {
      if (settled) return;
      bytes += chunk.byteLength;
      if (bytes > MAX_BODY_BYTES) { fail(new SafeHttpError('body_too_large', 413, 'The request exceeds the allowed size.')); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)))); }
      catch { reject(new SafeHttpError('invalid_json', 400, 'Send a valid JSON request.')); }
    });
    request.on('error', () => fail(new SafeHttpError('invalid_json', 400, 'The request body could not be read.')));
    request.on('aborted', () => fail(new SafeHttpError('invalid_json', 400, 'The request body was interrupted.')));
  });
}

function sendJson(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", Connection: 'close',
  });
  response.end(JSON.stringify(body));
}

/** Only serves API JSON; no static files, request logging, or permissive CORS. */
export function createAiServer(adapter) {
  const server = createServer(async (request, response) => {
    try {
      checkRequestOrigin(request);
      if (request.method === 'GET' && request.url === '/api/ai/status') {
        sendJson(response, 200, adapter.status()); return;
      }
      if (request.method === 'POST' && request.url === '/api/ai/verify') {
        const body = await readJson(request);
        if (!VERIFY_SCHEMA.safeParse(body).success) throw new SafeHttpError('invalid_request', 400, 'The verification request is invalid.');
        sendJson(response, 200, await adapter.verify()); return;
      }
      if (request.method === 'POST' && request.url === '/api/ai/tailor') {
        sendJson(response, 200, await adapter.tailor(await readJson(request))); return;
      }
      throw new SafeHttpError('not_found', 404, 'The requested API route was not found.');
    } catch (error) {
      if (error instanceof SafeAiError || error instanceof SafeHttpError) {
        sendJson(response, error.status, { error: { code: error.code, message: error.message } });
      } else sendJson(response, 500, { error: { code: 'internal_error', message: 'The local AI service could not complete the request.' } });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 1000;
  server.maxHeadersCount = 32;
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  return server;
}
