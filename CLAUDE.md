# Folio

Resume tailoring app. A user adds a PDF or Word resume, pastes a job posting (or a link to it),
and gets the resume rewritten for that job in a clean template, as a PDF or Word file. Every
tailoring is saved under the resume it was made from.

The app lives in `folio/`. `resume-formatter/` is an older project; leave it alone.

## Run and check

```
cd folio
npm ci
npx vite --host 127.0.0.1 --port 4594   # dev server; sign-in is allow-listed for this port
npm run test:product                     # required: 605 tests, must stay green
npm run typecheck
npm run build
```

`npm run test:engine` is the older full suite with about 222 known failures (see `folio/TESTING.md`).
Do not treat those as regressions. Needs Node 22.9 or newer.

## How it is built

- React 19, Vite 8, TypeScript, pdf.js, pdf-lib, tiptap, zod.
- Routes (`folio/src/site/`): `/` landing; `/app` (Resumes), `/app/jobs`, `/app/memory` and
  `/app/tailor` are pages of the workspace (`structured/Workspace.tsx`, which owns its own
  sub-routing and the sidebar / phone tab bar); `/app/classic` the older exact-layout workspace (`App.tsx`, loaded lazily, reachable from the
  menu; it keeps the original file's layout and stores everything in the browser only),
  `/privacy`, `/terms`. Signed-in users and auth return links skip the landing page.
- Shared CSS is imported at the top of `main.tsx`, in a fixed order, before any component. Keep it
  there: the workspace relies on it, and `App.tsx` is not loaded on `/app`.
- Auth (`folio/src/auth/`): two Supabase projects, one per region. India `asjgodeofdxtncyeband`
  (ap-south-1), US `nocejvdlrazsvopyjrvo` (us-east-2). Email and Google sign-in. A user lives in
  one region; sign-in tries both. Publishable keys are in `regions.ts` and are safe in the browser.
- The workspace (`folio/src/structured/`):
  - `Workspace.tsx` is the app shell and the Resumes and Jobs pages. `StructuredStudio.tsx` is the
    tailoring page (steps: Resume, Job, Review and download), shown inside the shell.
    `MemoryPage.tsx` is Career memory.
  - Page count: the original's page count is read on upload (`plainText.ts`, `ResumeRecord.pages`)
    and `renderResumePdf` tightens type, line spacing and margins (`FITS` in `pdf.ts`, floor 7.5 pt)
    until the resume fits that count. If it cannot, `over` is set and the page says so. The Word
    file is scaled by the same `fit`.
  - Career memory (`memory.ts`): notes, documents, LinkedIn text, public GitHub repositories (read
    in the browser from GitHub's API), a web page, dictation. `memoryText` sends the items most
    relevant to the posting with `/tailor` and `/cover`. The server then allows facts from the
    resume or the memory, and can return `additions` (new bullets), `newSkills` and `newProjects`,
    each checked against the applicant's own text. Stored in IndexedDB and synced as one row in
    `public.resumes` with `schema_version` 3.
  - A new file is turned into plain text in the browser (`plainText.ts`) and read into sections by
    AI while the user pastes the job. Reading starts once, in the upload handler, never in an
    effect (React runs effects twice in development, which would spend a visitor's free try).
  - `model.ts`: `ResumeRecord` holds the resume (`base`), its template and its `jobs`. A
    `JobRecord` is saved the moment a tailoring returns: the job, the suggestions, which are applied
    (`decisions`), the applicant's own rewording of lines for that job (`edits`), a cover letter and
    an applied flag. Changes are applied by default and each can be undone.
  - `pdf.ts` renders three one-column templates (Classic, Modern, Compact) and returns where each
    editable line sits, so the preview can make lines clickable. `docx.ts` writes the Word files.
    PDFs embed Latin-only Inter subsets (`public/fonts/structured/*-Latin.ttf`, made with
    `pyftsubset`), about 58 KB per file. Text with other characters falls back to the full Inter
    files, then DejaVu (larger files). Do not turn on pdf-lib's own subsetting: it drops glyphs.
  - `store.ts`: IndexedDB `folio-resumes-v2` (records from `folio-structured-v1` are migrated once).
  - `sync.ts`: signed-in users get a copy of each resume in `public.resumes` (one row per resume,
    `schema_version` 2) in their own region. The on/off switch is stored with the account
    (`user_metadata.folio_sync`), so it holds on every device; turning it off deletes the rows.
    Signing out removes copies that are safely in the account from that browser.
- AI, server side (`supabase/functions/resume-ai/`, deployed identically to both regions with
  `verify_jwt` off because it checks the user itself): `/structure` reads resume text into
  sections, `/tailor` proposes changes for one job and returns the role and company the posting
  names, `/job` reads a posting from a link (`job-readers.mjs`), `/cover` drafts a cover letter
  (signed-in only). Job links are read only where the site offers it: the public feeds of
  Greenhouse, Lever, Ashby and SmartRecruiters, or the page itself fetched under Folio's own
  User-Agent. Do not add readers that imitate a browser, call private endpoints or route around a
  refusal (LinkedIn, Indeed, Naukri refuse): the "Send to Folio" bookmark in the Job step sends the
  posting from the person's own browser instead (`/app#job=<text>`). The server drops any suggestion that uses a number, name, term or job-posting
  word the resume does not contain (`structured.mjs`, tested in `folio/src/structured/model.test.ts`).
  Signed-in limits: 20 runs per user and 300 per region per day (`public.ai_runs`). Without an
  account: one `/structure` and one `/tailor` per address per day, 100 calls per region per day
  (`public.ai_anon_runs`, which stores only a salted hash of the address and deletes rows after
  two days). Never put the OpenAI key in code, files or chat; it is an edge function secret.
  `supabase/functions/ai/` is the older function used by the exact-layout workspace.
- Database schema: `supabase/migrations/`. Apply the same migration to both regions.
- Hosting: Cloudflare Pages project `folio-app`, live at https://folio-app-78s.pages.dev, built
  from `folio/` with `npm ci && npm run build`. Every branch gets a preview at
  `https://<branch>.folio-app-78s.pages.dev`. The AI functions only accept that domain and
  localhost:4594; a new domain must be added to `PAGES_ORIGIN` in both functions' `index.ts` and
  to both Supabase projects' redirect URLs.

## Design rules

The standard is `folio/src/ui/folio-kit-tokens.css`. Read the usage rules at its top before
changing UI. In short: neutral workspace, near-black primary actions, colour only for status,
serif only for document content and the landing headline, one primary action per screen, and copy
in the user's words (job, resume, download), not system terms (revision, pinned, evidence).

`folio/src/ui/design-pass.css` is a holding file for overrides of older styles. `styles.css` is a
legacy theme that later files override; do not add to it.

Test UI changes as a real user in a browser at desktop, tablet and phone widths, not only with
unit tests.

## Where things stand (2026-11-12)

- `main` has Phase 1, accounts and cloud AI (PR #7).
- `phase-5-structured` is the newest branch and contains everything after that: the landing page
  (PR #8, still open), the design pass, the template workspace, saved jobs, account sync, the free
  try, job links, cover letters, click-to-reword, three templates, small PDFs, page-count fitting,
  career memory and the sidebar app layout. Merging it into
  `main` makes the main Pages address live and starts the keep-awake job.
- Both regions run `resume-ai` with the same code as this branch, and both have the
  `ai_anon_runs` and `purge_anon_runs` migrations applied.

Next, in order:

1. Merge `phase-5-structured` into `main`; close PR #8.
2. Run one real tailoring on the live site, on a phone and a desktop, signed out and signed in.
3. Paid and trust items, deliberately left for later: a paid database plan (no pausing), a custom
   domain, publishing the Google sign-in screen (Testing mode, Google Cloud project
   `folio-513701`), and sign-up emails from a Folio address.
4. Not built: showing changes one by one as the AI writes them (the server returns the whole
   result at once), and text in scripts the fonts lack (for example Chinese or Japanese).

Both Supabase projects are on the free plan, which pauses a project after 7 days without
activity and breaks sign-in. `.github/workflows/keep-databases-awake.yml` pings both twice a week
(it only runs from `main`). If sign-in fails everywhere, check whether the projects are paused.

Open housekeeping: a QA user `folio-qa-us@folio.test` exists in the US database; a Cloudflare
Worker `resumeformat` and two Vercel projects also build this repo and can be turned off.
