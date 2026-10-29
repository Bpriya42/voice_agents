# Ava: a voice presentation agent

Ava is an AI presenter who gives a short spoken talk on **how GLP-1 medicines work**, across six slides. You can cut in at any time:

- **Interrupt** by holding `Space` (or tapping the orb). Ava stops at once and listens.
- **Ask anything.** She answers from reviewed deck facts only, and says so when a question is outside her material.
- **Slides follow the conversation.** Ask about side effects and she moves to the safety slide while she answers.
- **She picks up where she left off**, from the start of the sentence you interrupted.
- **Nothing dead-ends.** If the mic or the voice connection fails, you can type questions and still get spoken answers.

Built as a take-home for Synthio Labs. Interaction quality comes first.

**Try it now: [voice-agents-ucv7.onrender.com](https://voice-agents-ucv7.onrender.com/)** (desktop Chrome, headphones recommended). Sessions last up to 10 minutes, and the demo may pause if its monthly budget runs out; if it does, run it locally below.

> **Educational demo, not medical advice.** Nothing you say is stored. Audio is processed by OpenAI under its [API data policy](https://openai.com/policies/api-data-usage-policies).

## Run it locally

**You need:** [Node 24 LTS](https://nodejs.org/), desktop Chrome, and an OpenAI API key with Realtime access.

```bash
git clone https://github.com/Bpriya42/voice_agents.git
cd voice_agents
npm run setup
```

`npm run setup` ([scripts/setup.mjs](scripts/setup.mjs)) checks your Node version, installs dependencies, creates `.env` from [.env.example](.env.example) and checks the result. It never prints your key.

Then:

1. Open `.env` in your editor and replace `replace-with-your-key` with your OpenAI API key.
2. Run `npm run dev` and open http://localhost:5173 in Chrome.

That's it. `localhost` is a secure context, so the mic works without HTTPS.

<details>
<summary>Don't have Node 24?</summary>

The repo's `.nvmrc` pins Node 24. With [fnm](https://github.com/Schniz/fnm):

```bash
# macOS / Linux
curl -fsSL https://fnm.vercel.app/install | bash
fnm install 24 && fnm use 24
```

```powershell
# Windows (PowerShell)
winget install Schniz.fnm
fnm env --use-on-cd | Out-String | Invoke-Expression
fnm install 24; fnm use 24
```

`nvm`, `nvm-windows` and `volta` work too.

</details>

### Try it

1. Click **Check microphone**, say something, then **Start presentation**.
2. While Ava is speaking, hold `Space` and ask _"What are the side effects?"_ She stops, moves to the safety slide, answers, then returns to where she was.
3. Type a question in the box instead. Ava pauses as soon as you start typing.
4. Press `?` to see every keyboard shortcut.

### Troubleshooting

| Symptom | Fix |
|---|---|
| "Server isn't configured" banner | The key in `.env` is missing or wrong. Run `npm run doctor`. |
| "The API key has no credit left" | Add billing to your OpenAI project. |
| "Microphone access is blocked" | Allow the mic from the lock icon in Chrome's address bar, then Retry. Or carry on by typing. |
| No sound after Start | Click the **Tap to enable sound** notice and check the tab isn't muted. |
| Ava hears herself on laptop speakers | Use headphones. |
| Port 5173 or 8787 in use | Stop the other process, or set `PORT` in `.env`. |

## How it works

```
Browser (React + XState)  ── WebRTC audio + data channel ──►  OpenAI Realtime
        │
        └── POST /api/session ──►  Node + Hono server  (mints a 60-second key)
```

- **The browser talks to OpenAI directly** over WebRTC for low latency. The server only mints short-lived keys, so your real key never leaves it.
- **One controller makes every decision.** A presentation controller decides when Ava speaks; the voice adapter only executes commands and reports events. This keeps interruption, slide changes and resume predictable and testable.
- **Narration is one sentence at a time**, advanced only when that sentence has actually finished playing, so an interruption always has an exact place to resume from.
- **Answers are grounded.** The six slides and their facts live in [shared/src/deck.ts](shared/src/deck.ts); the prompt allows answers from those facts only.

Full reasoning is in [docs/architecture.md](docs/architecture.md) and the [ADRs](docs/decisions/).

## Quality

| Check | Result |
|---|---|
| Unit tests (Vitest, no network) | 285 passing |
| Integration tests (server routes, adapter with fake WebRTC) | 207 passing |
| End-to-end (Playwright, fake mic and fake voice adapter) | 41 passing |
| Answer-quality eval: deterministic checks / judge pass / safety failures | 100% / 100% / 0 |

Eval details: [eval/report.md](eval/report.md) (40 golden questions × 3 runs, worst result kept, plus 10/20/40-turn conversations to check quality doesn't drift).

**Known limitations**

- Turn-taking is press-to-talk. Hands-free interruption (just start speaking) was a stretch goal and isn't built.
- The pause between narrated sentences measured about 0.9 s (p50) in the spike, above the 0.6 s target. Prefetching the next sentence would close it; see [architecture.md §5.9](docs/architecture.md).
- Tested in desktop Chrome only.

## Development

```bash
npm run dev          # web on :5173 and API on :8787, with hot reload
npm run lint         # ESLint
npm run typecheck    # TypeScript project references
npm test             # unit tests
npm run test:int     # integration tests
npm run e2e          # Playwright (first time: npx playwright install chromium)
npm run build        # production build, then fails if any secret reached the bundle
npm start            # serve the build: one Node process for the SPA and API
npm run eval         # answer-quality eval against the real API (costs a little)
```

How the project was built:

- **Design before code.** A [product brief](docs/product-brief.md), an [architecture decision record](docs/architecture.md) and three [ADRs](docs/decisions/) came first, then a milestone-by-milestone [implementation plan](docs/implementation.md). A [day-1 spike](docs/spike-log.md) checked provider behaviour against the real API before the adapter was built on it.
- **Small, reviewed changes.** Work landed milestone by milestone through pull requests, with [Conventional Commits](https://www.conventionalcommits.org/).
- **CI on every push** ([.github/workflows/ci.yml](.github/workflows/ci.yml)): secret scan, lint, typecheck, unit tests with coverage, integration tests, build with a bundle secret check, and the full e2e suite.
- **Secrets kept out by design.** The key is server-only; no `VITE_*` variable holds a secret; a secretlint pre-commit hook and CI block keys from the repo; logs never contain keys, transcripts, SDP or full IPs. Tests use fakes and never touch the network.

Every server setting, with comments, is in [.env.example](.env.example). Rules for coding agents working in this repo are in [AGENTS.md](AGENTS.md).

## Repository layout

```
shared/   deck content, prompt builder and Zod schemas (used by web, server and eval)
server/   Hono app: health, session, backup chat, rate limits
web/      React app: voice adapter, presentation controller, state machine, UI, e2e tests
eval/     golden questions, multi-turn scripts, LLM judge and report
docs/     product brief, architecture, ADRs, implementation plan, spike log
scripts/  setup, doctor and the bundle secret check
```

## License

[MIT](LICENSE)
