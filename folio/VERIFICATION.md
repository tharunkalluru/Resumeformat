# Publication verification — November 3, 2026

The published application source is the latest local October 15 product upgrade. Its production code is copied without behavioral changes. Private corpus probes, local configuration, dependency symlinks, generated outputs, and personal data are excluded; public fixture attribution is retained.

Environment: macOS, Node.js `24.13.1`, npm `11.8.0`, Vitest `5.0.3`.

| Check | Result |
| --- | --- |
| `npm ci` | Passed with a fresh dependency installation |
| `npm run typecheck` | Passed |
| `npm run build` | Passed; existing large-chunk and ineffective dynamic-import warnings remain |
| `npm run preview -- --port 4673` | Temporary production preview returned HTTP 200 for the document, linked JS/CSS, font, PDF.js WASM, and favicon assets; process stopped afterward |
| Focused product regression command below | 25 files / 327 tests passed |
| `npm run ai:test` | 40 synthetic tests passed; no live provider request |
| `npm run ai:check` | No key/model configured, paid requests disabled, account/model unverified; no provider request |
| Broad `npm test` | Stopped after four reported files showed 23 failures; incomplete and not a passing release qualification |
| `npm run ai:test:historical` | Not run; depends in part on intentionally unshipped historical evidence |

The sandbox initially blocked npm registry access and temporary HTTP test listeners. Fresh installation and HTTP tests passed with the necessary network/loopback access. The broad test runner also received process access; its reported regression failures must not be treated as passing because focused suites passed.

The four reported failing files were `src/import/pdf-scoped-source.test.ts` (8 failures), `src/import/import.test.ts` (7), `src/import/pdf-v6.test.ts` (1), and `src/import/recovery.test.ts` (7). Those files reported 69 passes, 23 failures, and 1 skip; these are **partial file results, not overall suite totals**. The run was stopped before a final summary. Bounded reruns confirmed an expected `CORRUPT_PDF` versus actual `CORRUPT_DOCUMENT` error-code mismatch, and a legacy optional-content restore test encountering `PDF_VISIBLE_LAYERS`. Other reported failures include historical spacing ownership and recovery expectations. They were not repaired as part of publishing this source snapshot.

## Reproduce the focused product checks

Run from `folio/` after `npm ci`:

```sh
./node_modules/.bin/vitest run --pool=threads \
  src/core/careerMemory.test.ts \
  src/core/applications.test.ts \
  src/core/composerSources.test.ts \
  src/core/activity.test.ts \
  src/core/templateRepair.test.ts \
  src/storage/draftJournal.test.ts \
  src/storage/composerPreferences.test.ts \
  src/storage/defaultBridge.integration-controls.test.ts \
  src/tailoring/local.test.ts \
  src/tailoring/flow.test.ts \
  src/tailoring/ai.test.ts \
  src/ui/workspace-review.test.ts \
  src/ui/WorkspaceUpgrade.test.ts \
  src/ui/memoryInsights.test.ts \
  src/ui/memoryUpgrade.test.ts \
  src/ui/workspacePresentation.test.ts \
  src/ui/previewReview.test.ts \
  src/ui/export-readiness-ui.test.ts \
  src/ui/App.integration-controls.test.ts \
  src/ui/useAiReadiness.test.ts \
  src/ui/templateDiagnostics.test.ts \
  src/ui/reviewDecisions.test.ts \
  src/ui/versionDifferences.test.ts \
  src/ui/history.test.ts \
  src/ui/historyPresentation.test.ts
```

These checks cover Career Memory, applications, workspace review, preview invalidation, export UI, asynchronous integration ownership, storage journals/preferences, and synthetic tailoring clients. They do not qualify the historical renderer suite, arbitrary resume fidelity, browser visual behavior, or live AI.
