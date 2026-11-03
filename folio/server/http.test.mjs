import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { createAiAdapter } from './adapter.mjs';
import { MODEL, MAX_BODY_BYTES, consentHash, hashText } from './contract.mjs';
import { createAiServer, FRONTEND_ORIGIN } from './http.mjs';

const KEY = 'synthetic-key-http-tests-only';
const BEFORE_TEXT = 'Software development experience.';
function requestBody() {
  const body = {
    schemaVersion: 1, allowedOperations: ['replaceParagraphText'],
    requestId: 'request-http',
    context: {
      projectId: 'project-http', projectRevision: 1, draftRevision: 1,
      templateId: 'template-http', templateRevision: 1, templateHash: hashText('fictional-template'),
      baselineRevision: 1, baselineHash: hashText('fictional-baseline'), memorySnapshotId: null, memoryRevision: null, memoryHash: null,
    },
    job: { title: '', company: '', description: 'TypeScript' },
    facts: [{
      id: 'fact-http', text: 'TypeScript experience.', kind: 'resume', confirmed: false, version: 1, assertionId: null, textHash: hashText('TypeScript experience.'),
      source: { id: 'source-http', kind: 'resume', version: 1, hash: hashText('fictional-source-bytes'), quote: 'TypeScript experience.', quoteHash: hashText('TypeScript experience.'), locator: 'page 1' },
      confirmation: null,
    }],
    blocks: [{ id: 'block-http', text: BEFORE_TEXT, textHash: hashText(BEFORE_TEXT), requiredFactIds: ['fact-http'],
      layoutBudget: { version: 1, regionId: 'region-http', widthPt: 400, heightPt: 24, fontFamily: 'sans',
        fontSizePt: 10, fontWeight: 400, italic: false, lineHeightPt: 12, maxLines: 2, maxCharacters: BEFORE_TEXT.length },
    }],
  };
  return { ...body, consent: { confirmed: true, contextHash: consentHash(body) } };
}

async function withServer(t, { fetchImpl, requestsEnabled = true } = {}) {
  let calls = 0;
  const adapter = createAiAdapter({ configuration: { apiKey: KEY, model: MODEL, requestsEnabled }, fetchImpl: fetchImpl ?? (async () => {
    calls++;
    return new Response(JSON.stringify({ id: MODEL, object: 'model' }));
  }) });
  const server = createAiServer(adapter);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  async function call({ method = 'GET', path = '/api/ai/status', headers = {}, body, chunked = false } = {}) {
    const requestHeaders = { Host: '127.0.0.1:4596', ...headers };
    return await new Promise((resolve, reject) => {
      const request = httpRequest({ hostname: '127.0.0.1', port: server.address().port, method, path, headers: requestHeaders }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: response.statusCode, headers: response.headers, text, body: text ? JSON.parse(text) : null });
        });
      });
      request.on('error', reject);
      if (chunked && body) {
        for (let i = 0; i < body.length; i += 8192) request.write(body.subarray?.(i, i + 8192) ?? body.slice(i, i + 8192));
        request.end();
      } else request.end(body);
    });
  }
  return { call, calls: () => calls, adapter };
}

const post = { method: 'POST', path: '/api/ai/verify', headers: { Origin: FRONTEND_ORIGIN, 'Content-Type': 'application/json' }, body: '{}' };

test('status is local-only safe JSON and does not contact the provider', async t => {
  const { call, calls } = await withServer(t);
  const response = await call();
  assert.equal(response.status, 200);
  assert.equal(response.body.keyConfigured, true);
  assert.equal(response.body.accountModelVerified, false);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['access-control-allow-origin'], undefined);
  assert.doesNotMatch(response.text, new RegExp(KEY));
  assert.equal(calls(), 0);
});

test('exact Host and Origin checks reject rebinding, localhost aliases, absent POST Origin and foreign origins before fetch', async t => {
  const { call, calls } = await withServer(t);
  for (const host of ['evil.example:4596', 'localhost:4596', '127.0.0.1:4389', '127.0.0.1:4596.evil.example']) {
    const response = await call({ ...post, headers: { ...post.headers, Host: host } });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'forbidden_host');
  }
  for (const origin of [undefined, 'null', 'http://evil.example', 'http://localhost:4594', 'http://127.0.0.1:4596', `${FRONTEND_ORIGIN}/`]) {
    const headers = { 'Content-Type': 'application/json' };
    if (origin !== undefined) headers.Origin = origin;
    const response = await call({ ...post, headers });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'forbidden_origin');
  }
  const crossSite = await call({ ...post, headers: { ...post.headers, 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(crossSite.status, 403);
  const foreignStatus = await call({ headers: { Origin: 'http://evil.example' } });
  assert.equal(foreignStatus.status, 403);
  assert.equal(calls(), 0);
});

test('verified frontend proxy Host is accepted and verification receives no client settings', async t => {
  const { call, calls } = await withServer(t);
  const response = await call({ ...post, headers: { ...post.headers, Host: '127.0.0.1:4594' } });
  assert.equal(response.status, 200);
  assert.equal(response.body.accountModelVerified, true);
  assert.equal(calls(), 1);
  const invalid = await call({ ...post, body: '{"model":"attacker-model"}' });
  assert.equal(invalid.status, 400);
  assert.equal(calls(), 1);
});

test('JSON parsing, content type, compression, UTF8 and request byte bounds reject before fetch', async t => {
  const { call, calls } = await withServer(t);
  for (const [options, status, code] of [
    [{ ...post, body: '{invalid}' }, 400, 'invalid_json'],
    [{ ...post, headers: { Origin: FRONTEND_ORIGIN, 'Content-Type': 'text/plain' } }, 415, 'unsupported_content_type'],
    [{ ...post, headers: { ...post.headers, 'Content-Encoding': 'gzip' } }, 415, 'unsupported_content_type'],
    [{ ...post, body: Buffer.from([0xff]) }, 400, 'invalid_json'],
    [{ ...post, body: 'x'.repeat(MAX_BODY_BYTES + 1), chunked: true }, 413, 'body_too_large'],
    [{ ...post, headers: { ...post.headers, 'Content-Length': String(MAX_BODY_BYTES + 1) }, body: 'x'.repeat(MAX_BODY_BYTES + 1) }, 413, 'body_too_large'],
  ]) {
    const response = await call(options);
    assert.equal(response.status, status);
    assert.equal(response.body.error.code, code);
  }
  assert.equal(calls(), 0);
});

test('disabled paid endpoint refuses a valid consented body without fetch', async t => {
  const { call, calls } = await withServer(t, { requestsEnabled: false });
  const response = await call({ ...post, path: '/api/ai/tailor', body: JSON.stringify(requestBody()) });
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'requests_disabled');
  assert.equal(calls(), 0);
});

test('valid fixed provider response returns matching context and review-only proposals over HTTP', async t => {
  let calls = 0;
  const { call } = await withServer(t, { fetchImpl: async () => {
    calls++;
    return new Response(JSON.stringify({
      model: MODEL, status: 'completed', error: null, incomplete_details: null,
      output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ proposals: [{
        blockId: 'block-http', beforeText: BEFORE_TEXT, afterText: 'TypeScript experience.', factIds: ['fact-http'], reason: 'Uses supplied evidence.',
      }] }) }] }], usage: null,
    }));
  } });
  const body = requestBody();
  const response = await call({ ...post, path: '/api/ai/tailor', body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.context, body.context);
  assert.equal(response.body.contextHash, body.consent.contextHash);
  assert.equal(response.body.requiresReview, true);
  assert.equal(response.body.schemaVersion, 1);
  assert.equal(response.body.proposals.length, 1);
  assert.equal(response.body.proposals[0].operation, 'replaceParagraphText');
  assert.equal(response.body.proposals[0].beforeHash, hashText(body.blocks[0].text));
  assert.equal(response.body.proposals[0].factRefs[0].sourceHash, body.facts[0].source.hash);
  assert.equal(calls, 1);
});

test('provider and unexpected internal errors contain no credentials, prompts, stack traces or raw messages', async t => {
  const { call } = await withServer(t, { fetchImpl: async () => new Response(`Secret ${KEY}, prompt supplied by applicant`, { status: 500 }) });
  const response = await call(post);
  assert.equal(response.status, 502);
  assert.equal(response.body.error.code, 'provider_error');
  assert.doesNotMatch(response.text, /synthetic-key|prompt supplied|stack|Error:/);
});

test('unsupported routes, methods and preflight expose no permissive CORS', async t => {
  const { call, calls } = await withServer(t);
  for (const options of [
    { method: 'OPTIONS', path: '/api/ai/tailor', headers: { Origin: FRONTEND_ORIGIN } },
    { path: '/api/ai/verify' },
    { path: '/api/ai/status?anything=1' },
    { path: '/server/.env.local' },
    { ...post, path: '/api/ai/propose' },
  ]) {
    const response = await call(options);
    assert.equal(response.status, 404);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
  assert.equal(calls(), 0);
});
