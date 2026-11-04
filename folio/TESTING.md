# Testing

## Suites

| Command | What it covers | Runs in CI |
| --- | --- | --- |
| `npm run typecheck` | TypeScript across the app | Required |
| `npm run build` | Production bundle | Required |
| `npm run test:product` | Workspace, applications, Career Memory, storage, tailoring, AI client, DOCX import, download flow (`vitest.product.config.ts`) | Required |
| `npm run ai:test` | Synthetic AI adapter, contract, HTTP and protected-claim tests | Required |
| `npm run test:engine` | Every test, including the historical exact-layout engine suites | Runs on every change, does not block (see below) |

Set `VITEST_MAX_WORKERS=2` (or higher) to run test files in parallel. The default is one file at a time, because the PDF-heavy suites use a lot of memory.

## Engine suite triage (November 4, 2026)

A full run on the original code reported **222 failing tests out of 3,083, in 47 of 170 files**. This run used 6 parallel workers on a 2-core machine, so many timeouts are load-related.

| Cause | Tests | What it means | Proposed action |
| --- | --- | --- | --- |
| Timed out (20 s limit) | 105 | Mostly heavy PDF suites starved for CPU in a parallel run | Re-run on the CI runner with 2 workers; raise per-file timeouts only where a suite is still slow |
| Assertion mismatch | 66 | Historical expectations no longer match importer output (spacing ownership, grouping, image paint) | Review per file: fix if the current behavior is a regression, otherwise update or retire |
| Engine refused a historical proof | 18 | Older composite/scoped paint fixtures now rejected by stricter proof contracts | Likely retire with the historical contract, or regenerate fixtures |
| Error code changed | 11 | Example: expected `CORRUPT_PDF`, now `CORRUPT_DOCUMENT` | Update expectations (renamed codes) |
| Version string changed | 9 | Renderer and baseline contract versions were bumped | Update expectations |
| Missing historical data (`TypeError`) | 9 | Fixtures expect fields from unpublished historical evidence | Retire or move behind the historical flag |
| Schema mismatch | 3 | Stored-record fixtures predate a schema change | Regenerate fixtures |
| Worker out of memory | 1 | Parallel run on a small machine | Fixed by running fewer workers |

Most failures are in the frozen exact-layout engine: `src/import/pdf-*`, `src/render/source-*` and `src/storage/*Proof*`. The product suite does not depend on them.

**Decision needed before deleting anything:** retiring a test removes coverage. The files proposed for retirement will be listed for approval, file by file.

## Known flaky tests

`src/ui/App.integration-controls.test.ts` has timing-dependent tests around held persistence and the Home tab. They fail intermittently on the original code too. The product config retries them up to 2 times.
