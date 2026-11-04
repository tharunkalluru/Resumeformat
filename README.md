# Folio

A local resume workspace for keeping source documents, reviewing their layout, building reusable Career Memory, and preparing job-specific applications with evidence you can inspect.

The current application is in **[`folio/`](folio/)**, built with React, TypeScript, Vite, PDF.js, pdf-lib, and IndexedDB. The earlier Next.js formatter remains in [`resume-formatter/`](resume-formatter/) with its own setup instructions.

## Features

| Area | What is implemented |
| --- | --- |
| Resume import | Import text PDFs and DOCX files; retain the original document alongside the reconstructed template. Resume limits: 10 MiB, 32 pages, and 100,000 extracted characters. |
| Template inspection | Compare the source and output side by side, in an overlay, or with a difference view. Inspect each page and navigate from import observations and overflow diagnostics to the affected content. |
| Document editing | Edit supported text inside source-bound frames while preserving fixed layout constraints. Check fonts, character coverage, spacing, page geometry, images, and passive hyperlinks. Unsupported or ambiguous spans stay read-only. |
| Resume groups | Keep reusable source/template groups and create separate applications without overwriting the source resume. Rebuild an inaccurate template into a separate group while retaining earlier work. |
| Career Memory | Add supporting files and notes, search saved wording and original sources, review repeated text, confirm evidence, record corrections, and control which details are eligible for future applications. |
| Job matching | Paste a job description with optional role/company details. Local analysis shows exact matching terms and linked applicant evidence. This is a deterministic aid, not an ATS score. |
| Application workspace | Save job-specific drafts with pinned resume and Career Memory snapshots. Review original/current wording, linked evidence, versions, comparisons, and activity history. |
| PDF export | Export the exact PDF bytes inspected in the current preview after the saved revision, approved template, supported fit, page review, and claim-confirmation checks pass. Later edits invalidate the relevant review. |
| Recovery and portability | Browser autosave/recovery journals, validated project backups, resume-group ZIP backup/restore, version restoration, private preferences, and scoped deletion controls. |
| Optional dictation | Local dictation when the browser verifies installed on-device speech recognition support. There is no automatic cloud fallback or language-pack download. |
| Optional AI tailoring | The application requests evidence-bound wording through a separate loopback adapter after configuration, account/model verification, and consent to the exact request. Responses are validated for source support and document fit before acceptance. |

## Run locally

Use **Node.js 22 or newer** and npm. Install the locked dependencies from the current app directory:

```sh
git clone https://github.com/tharunkalluru/Resumeformat.git
cd Resumeformat/folio
npm ci
npm run dev
```

Open **http://127.0.0.1:4594**. The port is fixed (`strictPort`): stop your own conflicting process or change both the frontend and adapter configuration deliberately. Local import, matching, editing, preview, and PDF export work without an AI key or adapter.

For a production build and local preview:

```sh
npm run build
npm run preview
```

The output is `folio/dist/`. Preview also uses `127.0.0.1:4594`. These instructions cover local operation. Hosting integrations already connected to the GitHub repository may run on pushes; their configuration is managed separately.

## Typical workflow

1. Import a PDF or DOCX and inspect every page against the source. Approve the template only when its appearance is accurate.
2. Optionally add Career Memory and confirm the source wording you want available to future applications.
3. Add a job description, inspect local term matches and saved evidence, then open an application draft.
4. Edit supported text or explicitly request optional AI proposals. Review the meaning, source evidence, and fit of every change.
5. Resolve export diagnostics, confirm claims, inspect every page of the current PDF, and download.

A generated proposal, confirmed applicant claims, and a recorded download are separate states. Rendering a page is not applicant approval.

## Optional AI setup

See **[`folio/server/README.md`](folio/server/README.md)** for the configuration and request contract. The adapter listens at `127.0.0.1:4596`; the frontend proxies `/api/ai/` to it.

Create an ignored `folio/server/.env.local` manually with an existing API key. The current adapter accepts `OPENAI_MODEL=gpt-6.1-sol`; start with `FOLIO_AI_REQUESTS_ENABLED=false`. Credentials belong only on the server. Never use a `VITE_` variable for a secret.

```sh
# From folio/
npm run ai:check
npm run ai:server
```

Configuration checks and the local readiness endpoint do not contact the provider. Explicit account verification contacts the provider; tailoring sends a paid inference request after all gates pass. Live account/model access and AI output quality have **not been qualified for this published build**. The application cannot invoke a ChatGPT ResumeGPT plugin and does not substitute a fake successful response when AI is unavailable.

## Checks

Run these from `folio/`:

```sh
npm run typecheck
npm run build
npm test
npm run ai:test
```

`npm test` runs the frontend/domain/import/render/storage regression suites using bundled fictional or attributed public fixtures. Renderer tests use the native canvas dependency included through PDF.js; do not omit optional npm dependencies. Some optional private regression cases require explicitly supplied external inputs and are skipped by default. Passing fixtures do not establish fidelity for every resume.

`npm run ai:test` runs four synthetic adapter, contract, HTTP, and protected-claim suites without a real provider request. `npm run ai:test:historical` preserves older controls that require unshipped historical evidence under `folio/output/`; it is not a portable release check. Private applicant corpora, personal exports, credentials, and historical output packets are excluded from this repository.

**Validation on November 3, 2026:** fresh installation, type checking, production build, production HTTP/asset smoke checks, 327 focused product tests, and 40 synthetic adapter tests passed. The broader `npm test` run reported failures in historical import/reconstruction/recovery suites and is **not green**. See [the verification record](folio/VERIFICATION.md) for the exact focused command and limits. These results do not qualify arbitrary resumes or live AI.

## Privacy and data storage

- Originals, resume groups, applications, and Career Memory stay in IndexedDB for the current browser origin. The app does **not** encrypt them.
- A different host or port has a separate store. Back up your work before clearing browser data or moving origins. A Git clone does not migrate browser data.
- Resume-group ZIPs contain retained originals, context, and application snapshots; treat those downloaded archives as personal data. Project backups have a narrower scope. Restore validates archives and creates separate records.
- Local import, matching, rendering, and PDF export do not send uploaded content to a model. Optional AI sends only selected text and bound source quotations after explicit consent.
- The adapter requests `store:false`; this alone is not a guarantee of zero provider retention.

## Limits and current status

- A PDF is positioned drawing instructions, not an editable Word template. Preserving its original appearance does not prove that all its text can be safely rewritten.
- Editing depends on font coverage, transforms, text ownership, and supported source structures. Original Type 1 sources have limited verified editing paths; unrestricted tailoring is not available for them.
- Text does not silently shrink or move later sections to make a change fit. Overflow and unsupported glyphs remain visible and block strict export.
- DOCX uses an approximate browser reference. For a stronger visual comparison, export a reference PDF from Word. Complex tables, unusual fonts, unsupported features, encryption, and scans may need a corrected or simpler source.
- OCR, legacy `.doc`/`.docm` import, editable Word export, hosted accounts, encrypted cloud storage, and cross-device sync are not implemented.
- This is a local application with bounded regression evidence, not universal resume-fidelity certification. AI is optional and remains unqualified as described above.

## Code map

| Path | Responsibility |
| --- | --- |
| `folio/src/core` | Validated records, template/content ownership, approvals, evidence, and export commands |
| `folio/src/import` | Bounded PDF/DOCX parsing, source preservation, and recovery |
| `folio/src/layout`, `folio/src/render` | Source geometry, font/glyph constraints, overflow, and PDF generation |
| `folio/src/storage` | IndexedDB, recovery journals, backups, restore, and private preferences |
| `folio/src/tailoring` | Local matching and validated optional provider proposals |
| `folio/src/ui`, `folio/src/input` | Editor, inspection/review flows, Career Memory, and optional local dictation |
| `folio/server` | Optional server-only AI configuration, HTTP adapter, and synthetic tests |
| `folio/public`, `folio/tests/fixtures` | Runtime fonts/PDF.js assets and fictional or attributed public fixtures |
| `resume-formatter` | Earlier standalone Next.js formatter, preserved separately |

Application package metadata is `UNLICENSED`. Bundled third-party fonts, PDF.js assets, reference data, and public fixtures retain their accompanying license and attribution notices.
