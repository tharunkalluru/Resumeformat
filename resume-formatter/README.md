# ResumeForge

Paste resume text, then edit the entire formatted document on a rich canvas. The canvas supports paragraphs, headings, bold, italic, underline, bullets, numbered lists, undo/redo, and keyboard shortcuts. Every field, including contact and education, can be edited. Long documents grow in the editor and export across PDF pages without clipping.

## Run locally

```bash
cd resume-formatter
npm ci
npm run dev
```

Open http://localhost:3000. `npm run check`, `npm run test`, and `npm run build` are the verification commands.

The profile in `lib/profile.ts` supplies this repository's initial contact and education values. Share-link email variants remain in `lib/shareLinks.ts` and the share page.

## PDF API

`POST /api/resume/pdf` accepts JSON containing exactly one of:

- `text`: raw resume text with recognizable section headings.
- `resume`: structured `experience`, `startups`, and `skills` arrays, plus optional `targetCompany`.
- `document`: the canvas's TipTap JSON document with paragraphs, headings, bullet/numbered lists, and bold/italic/underline text.

An optional `filename` may accompany any mode. Successful requests return `application/pdf`; `GET /api/resume/pdf` describes the current contract. Example:

```bash
curl -X POST http://localhost:3000/api/resume/pdf \
  -H 'Content-Type: application/json' \
  -d '{"resume":{"experience":[{"title":"Engineer","company":"Acme","bullets":["Improved reliability by 40%."]}]}}' \
  --output resume.pdf
```

Set `RESUME_API_KEY` to require `Authorization: Bearer <key>` or `X-API-Key: <key>` for POST requests. Without it, the API is open. Never put the key in browser code. Browser PDF export runs locally through the same document renderer and works independently of API authentication.

The API rejects malformed or ambiguous input, non-JSON requests, bodies over 250,000 bytes, text over 100,000 characters, and unsupported canvas nodes. `text` and `resume` use the compact one-page template and return `422 RESUME_TOO_LONG` when the content cannot fit readably. `document` supports multiple PDF pages. Errors have the form `{ "error": { "code": "...", "message": "..." } }`.

The PDF contains selectable text. Carlito is embedded in both the browser and API exports from `public/fonts`.
