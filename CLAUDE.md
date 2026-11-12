# Folio

Resume tailoring app. A user uploads a PDF or Word resume, pastes a job description, reviews
suggested wording, and downloads a PDF that keeps their original layout.

The app lives in `folio/`. `resume-formatter/` is an older project; leave it alone.

## Run and check

```
cd folio
npm ci
npx vite --host 127.0.0.1 --port 4594   # dev server; sign-in is allow-listed for this port
npm run test:product                     # required: 586 tests, must stay green
npm run typecheck
npm run build
```

`npm run test:engine` is the older full suite with about 222 known failures (see `folio/TESTING.md`).
Do not treat those as regressions. Needs Node 22.9 or newer.

## How it is built

- React 19, Vite 8, TypeScript, pdf.js, pdf-lib, tiptap, zod. Resumes and drafts are stored in the
  browser (IndexedDB) only. Account sync is not built yet.
- Routes (`folio/src/site/`): `/` landing, `/app` workspace, `/privacy`, `/terms`. Signed-in users
  and auth return links skip the landing page.
- Auth (`folio/src/auth/`): two Supabase projects, one per region. India `asjgodeofdxtncyeband`
  (ap-south-1), US `nocejvdlrazsvopyjrvo` (us-east-2). Email and Google sign-in. A user lives in
  one region; sign-in tries both. Publishable keys are in `regions.ts` and are safe in the browser.
- AI (`supabase/functions/ai/`): one edge function deployed identically to both regions. It holds
  the OpenAI key as a secret, requires a signed-in user, enforces 20 runs per user and 300 per
  region per day, and logs each run in `public.ai_runs`. The client is `folio/src/tailoring/ai.ts`.
  Never put the OpenAI key in code, files or chat.
- Template mode (`folio/src/structured/`, server `supabase/functions/resume-ai/`): the default for
  signed-in users. The resume's text is read into sections by AI (`/structure`), rendered with a
  reflowing template (`pdf.ts`, `docx.ts`), and tailored per job (`/tailor`: rewrite, reorder, cut).
  The server drops any suggestion that uses a number, name, term or job-posting word the resume
  does not already contain (`structured.mjs`, tested in `model.test.ts`). It works from plain text,
  so it also handles files the exact-layout importer rejects. Data is in IndexedDB
  `folio-structured-v1`. The exact-layout engine is the "Keep my exact layout" alternative.
  Template PDFs embed full Inter fonts (about 550 KB per file) because pdf-lib's subsetter drops
  Inter glyphs; do not turn subsetting back on without checking the rendered output.
- Database schema: `supabase/migrations/`. Apply the same migration to both regions.
- Hosting: Cloudflare Pages project `folio-app`, live at https://folio-app-78s.pages.dev, built
  from `folio/` with `npm ci && npm run build`. Every branch gets a preview at
  `https://<branch>.folio-app-78s.pages.dev`. The AI function only accepts that domain and
  localhost:4594; a new domain must be added to `PAGES_ORIGIN` in `functions/ai/index.ts` and to
  both Supabase projects' redirect URLs.

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
- `phase-4-design` is the newest branch. It contains the landing page (PR #8, still open), the
  wording updates and the design pass. Merging it into `main` covers all three and makes the main
  Pages address live.

Next, in order:

1. Merge `phase-5-structured` (it contains `phase-4-design`) into `main`; close PR #8.
   Template mode still to do: show template resumes in Applications and the sidebar, editing for
   education/projects/extras, two more templates, streaming suggestions.
2. Account sync: back up resumes and applications to the user's region so they follow the user to
   another device. Idea: reuse `backupProject` / `restoreBackup` ZIP blobs in a storage bucket.
3. Publish the Google sign-in screen (currently Testing mode, Google Cloud project `folio-513701`)
   using the live homepage and `/privacy`.
4. Run a real AI tailoring on the live site, desktop and phone.
5. Design proposals not yet done: remove the browser-style tab strip, trim the sidebar, group
   Career Memory by role, pin the Compose action, consolidate the CSS.

Both Supabase projects are on the free plan, which pauses a project after 7 days without
activity and breaks sign-in. `.github/workflows/keep-databases-awake.yml` pings both twice a week
(it only runs from `main`). If sign-in fails everywhere, check whether the projects are paused.

Open housekeeping: a QA user `folio-qa-us@folio.test` exists in the US database; a Cloudflare
Worker `resumeformat` and two Vercel projects also build this repo and can be turned off.
