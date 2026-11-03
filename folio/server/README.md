# Optional local AI adapter

Local resume import, deterministic evidence matching, editing, rendering, and PDF export do not require this server. No live account/model access or provider output quality is qualified for this published build.

## Configuration

Use Node.js 24. Manually create `server/.env.local` from the `folio/` directory using this shape, then enter your existing key in that file:

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=gpt-6.1-sol
FOLIO_AI_REQUESTS_ENABLED=false
```

The file is ignored by Git and denied by the Vite development file server. Keep the key on one line. Do not paste it into chat, browser fields, screenshots, shell commands, or a `VITE_` variable. The adapter's current supported-model check accepts exactly `gpt-6.1-sol`; this does not establish that your account can access that model.

Run from `folio/`:

```sh
npm run ai:check
npm run ai:server
```

`ai:check` prints configuration booleans only. The server binds to **127.0.0.1:4596**. In another terminal, run `npm run dev` and open **http://127.0.0.1:4594**. The frontend uses a fixed same-origin `/api/ai/` proxy. Keep the host/port pair consistent with the adapter's origin checks.

## Requests and consent

- Starting the adapter and reading `GET /api/ai/status` contact no provider. A missing key is an unavailable configuration, not an invented successful connection.
- The separate explicit `POST /api/ai/verify` action contacts the provider for account/model lookup; it does not generate wording.
- The browser requires successful explicit account/model verification before enabling tailoring. `POST /api/ai/tailor` itself checks server configuration, enabled requests, and consent to the exact current request before making paid inference.
- Only selected job-description/paragraph text and bound applicant evidence quotations enter tailoring. Original files, images, other applications, and unconfirmed extras are excluded. Browser code never receives the key.

To use real tailoring, deliberately change `FOLIO_AI_REQUESTS_ENABLED=true` in the server file, restart the adapter, and verify account/model access explicitly in the app. Enable and consent only to the request you intend to send.

The server uses loopback binding, strict host/origin checks, bounded requests, server-only credentials, and no automatic provider retry. Responses are proposals with required evidence references and text budgets. The app validates the candidate against the source layout before acceptance. The applicant must still review meaning, confirm claims, and inspect every current PDF page before download. Character limits alone do not establish glyph fit; unsupported characters, ambiguous ownership, and overflow remain refusals.

The adapter requests `store:false`; that setting alone does not establish zero provider retention. Review the provider's current data controls before sending personal text. The adapter does not invoke a ChatGPT plugin.

## Tests

```sh
npm run ai:test
```

This runs four synthetic suites: adapter, contract, HTTP, and protected claims. They do not require credentials or make live provider calls.

`npm run ai:test:historical` additionally includes older budget and native-session controls. Some require original historical evidence in `folio/output/`, which is deliberately not published. It is not a portable release check, and missing evidence must not be replaced by invented successful receipts.
