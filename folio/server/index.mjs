import { readServerConfiguration } from './config.mjs';
import { createAiAdapter } from './adapter.mjs';
import { BACKEND_HOST, BACKEND_PORT, createAiServer } from './http.mjs';

const server = createAiServer(createAiAdapter({ configuration: readServerConfiguration() }));
server.on('error', () => {
  console.error(`The local Folio AI service could not start. Check that port ${BACKEND_PORT} is available.`);
  process.exitCode = 1;
});
server.listen(BACKEND_PORT, BACKEND_HOST, () => {
  console.log(`Folio AI service listening on http://${BACKEND_HOST}:${BACKEND_PORT}. No OpenAI requests run on startup.`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  server.close();
  server.closeAllConnections();
});
