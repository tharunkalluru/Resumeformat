# Folio application

The current local resume workspace. See the [repository README](../README.md) for the full feature list, workflow, privacy details, and limitations.

Requires Node.js 24 and npm:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:4594. No AI configuration is needed for local import, matching, editing, preview, or PDF export.

```sh
npm run typecheck
npm run build
npm test
npm run ai:test
```

`npm run preview` serves the production build locally. Optional AI adapter setup is in [server/README.md](server/README.md).

The source is the latest verified local product upgrade from October 15, 2026. Machine-specific launchers, private applicant corpora, local dependency symlinks, browser data, generated build outputs, and historical review packets are intentionally absent. The earlier formatter remains in `../resume-formatter/`.
