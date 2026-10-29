# AGENTS.md

Instructions for coding agents (Claude Code, Cursor, Codex and others) working in this repository. Humans: see [README.md](README.md).

## What this is

Podium, a voice presentation agent: the chosen presenter (Ava by default, or Theo or Mira; only the name and voice differ, see `shared/src/personas.ts`) gives a six-slide talk on GLP-1 medicines, can be interrupted by holding `Space`, answers from reviewed deck facts, changes slides with a tool, and resumes from the interrupted sentence. Browser ↔ OpenAI Realtime over WebRTC; a thin Node + Hono server mints short-lived keys. React + XState in the browser.

## Read first, in this order

1. [docs/product-brief.md](docs/product-brief.md): behaviour, states, targets. Wins on product questions.
2. [docs/architecture.md](docs/architecture.md): every technical decision. Wins on technical questions.
3. [docs/decisions/](docs/decisions/): ADRs 0001–0003.
4. [docs/implementation.md](docs/implementation.md): the build order, with code and tests.

`docs/mockups/motion-mockup.html` is a visual reference only, not a spec. If two docs disagree, stop and ask.

## Commands

```bash
npm run setup          # once: install, create .env from the template, run doctor
npm run doctor         # checks setup; never prints secrets
npm run dev            # web :5173 + server :8787
npm run lint
npm run typecheck
npm test               # unit, no network
npm run test:int       # integration, no network
npm run e2e            # Playwright with fake mic + fake adapter
npm run secrets:scan
npm run build && npm start
npm run eval           # real API, costs money: only when the human asks
npm run voices:samples # real API, costs money: only when the human asks (regenerates web/public/voices/*.mp3)
```

## Hard rules

### Secrets (never break these)

- **Never open, read, print, cat, grep, summarize, paste or commit `.env`**, or any file that may hold a key. Never echo environment variables or dump `process.env`.
- If `.env` is missing, create it only with a copy of `.env.example`, then ask the human to paste their key into the file themselves. Never ask for the key in chat.
- `OPENAI_API_KEY`, `TURNSTILE_SECRET_KEY` and `STATS_TOKEN` are server only. **No `VITE_*` variable may hold a secret.** Public values reach the browser through `/api/health`.
- Tests never use a real key or the network. Inject fakes (`server/src/openai.ts` client, `FakeVoiceSession`, fake `RTCPeerConnection`).
- Log through `server/src/logger.ts` only. Never log keys, client secrets, transcripts, SDP or full IPs.
- Do not disable or bypass the secretlint pre-commit hook or CI secret checks.

### Architecture invariants

- Only the presentation controller calls `createResponse`. Adapters execute commands and normalize events; they never decide (architecture.md §4.2–4.3).
- Reserve the generation slot before sending. Track generation and playback separately; `response.done` is not playback completion.
- Every voice event carries `sessionEpoch`; reject stale epochs. Never attribute an event to "the newest response".
- One checkpoint context (`displayedSlide`, `narrationCheckpoint`, `presentationStatus`, `questionTurn`). No `returnTo` / `interruptedAt`.
- Narration is one sentence per response, advanced only after playback completes.
- Interrupt cancels at once on press. End tears down at once, with no farewell audio.
- Provider event names live only in `web/src/voice/openai/events.ts`.
- Answers come from reviewed deck facts only. Never add medical content that isn't in `shared/src/deck.ts`.
- Every tool call gets exactly one `function_call_output`.

### Working style

- Build milestones from `docs/implementation.md` **in order**. One milestone at a time, one commit per milestone, using its commit message (Conventional Commits).
- Every change comes with tests. Run lint, typecheck, unit and integration tests before committing; run e2e when the milestone says so.
- Keep to the repo layout in architecture.md §13. Don't add dependencies a milestone doesn't list without saying why.
- If a "Verify in spike" item fails, update architecture.md with the fallback and tell the human; don't silently diverge.
- Report results honestly: test counts, failures, anything skipped.

## Layout

```
shared/   deck, prompt builder, Zod schemas (imported by web, server and eval)
server/   Hono app: health, session, chat, limits, sideband
web/      React app: voice adapter, controller, machine, audio, components, e2e
eval/     golden cases, multi-turn scripts, harness, report
docs/     brief, architecture, ADRs, implementation plan
```
