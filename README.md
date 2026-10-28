# Ava: a voice presentation agent

A web app where an AI presenter, Ava, gives a short spoken six-slide talk on **how GLP-1 medicines work**. You can interrupt her at any time by holding `Space` (or tapping the orb). She stops at once, answers from reviewed deck facts, changes to the relevant slide, then picks the talk back up from the sentence she was on. If the mic or the voice service fails, the demo keeps working: typed questions still get spoken answers.

Built as a take-home for Synthio Labs. Interaction quality comes first.

- **Hosted demo:** _link added at milestone M11_ (sessions last up to 10 minutes; the demo may be paused if its monthly budget is reached; run it locally below if so)
- **Status:** design complete, implementation in progress. See [docs/implementation.md](docs/implementation.md).

> **Educational demo, not medical advice.** Nothing you say is stored by this demo. Audio is processed by OpenAI to run the conversation, under [OpenAI's API data policy](https://openai.com/policies/api-data-usage-policies).

## Contents

- [Quickstart](#quickstart)
- [Configuration](#configuration)
- [Scripts](#scripts)
- [Secrets and privacy](#secrets-and-privacy)
- [Troubleshooting](#troubleshooting)
- [Prompt for a coding agent](#prompt-for-a-coding-agent)
- [Results](#results)
- [Documentation](#documentation)

## Quickstart

> The commands below are the delivery target. They work once milestone M1 of [docs/implementation.md](docs/implementation.md) is built.

**You need:** Node 24 LTS, npm 10+, desktop Chrome, and an OpenAI API key with Realtime access.

### 1. Install Node 24 LTS

Use a version manager so the repo's `.nvmrc` picks the right version.

macOS / Linux (fnm):

```bash
curl -fsSL https://fnm.vercel.app/install | bash
fnm install 24 && fnm use 24
```

Windows (PowerShell, fnm via winget):

```powershell
winget install Schniz.fnm
fnm env --use-on-cd | Out-String | Invoke-Expression
fnm install 24; fnm use 24
```

Check it:

```bash
node -v
```

It should print `v24.x`. `nvm`, `nvm-windows` and `volta` also work.

### 2. Get an OpenAI API key

1. In the OpenAI dashboard, create a **project** just for this app (for example `ava-dev`).
2. Create an API key in that project. Copy it somewhere safe for the next step; you can't see it again.
3. Optional but recommended: set a monthly budget on the project.

Use a separate project and key for any hosted deployment, so local runs and evals never spend the demo budget.

### 3. Clone, configure, run

```bash
git clone https://github.com/Bpriya42/voice_agents.git
cd voice_agents
npm install
```

Create your local env file from the template.

macOS / Linux:

```bash
cp .env.example .env
```

Windows (PowerShell):

```powershell
Copy-Item .env.example .env
```

Open `.env` in your editor and replace `replace-with-your-key` with your key. Then check your setup without printing any secret:

```bash
npm run doctor
```

Start the app:

```bash
npm run dev
```

Open http://localhost:5173 in Chrome. Vite serves the app and proxies `/api` to the Node server on port 8787. `localhost` counts as a secure context, so the mic works without HTTPS.

### 4. Try it

1. **Check microphone**, say something, then **Start presentation**.
2. Hold `Space` mid-sentence and ask "What are the side effects?" Ava stops, jumps to the safety slide, answers, then returns.
3. Type a question in the box (Ava pauses while you type).
4. Press `?` for every shortcut.

## Configuration

Every variable is read by the server only. The full list with comments is in [.env.example](.env.example).

| Variable | Default | Notes |
|---|---|---|
| `OPENAI_API_KEY` | (required) | Server only. Never prefixed `VITE_`. |
| `OPENAI_REALTIME_MODEL` | `gpt-realtime-2.1` | |
| `OPENAI_REALTIME_VOICE` | `marin` | |
| `OPENAI_CHAT_MODEL` | small text model | Backup voice and eval fallback |
| `EVAL_JUDGE_MODEL` | text model | `npm run eval` only |
| `PORT` | `8787` | |
| `RATE_LIMIT_PER_MIN` | `10` | Per IP on POST routes |
| `SESSION_MAX_MINUTES`, `MAX_CONCURRENT_SESSIONS`, `DAILY_SESSIONS_PER_IP`, `DAILY_SESSIONS_GLOBAL` | empty = no limit | Hosted demo limits |
| `SIDEBAND` | `0` | `1` on the hosted demo |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | empty = off | Hosted bot gate |
| `PUBLIC_REPO_URL`, `STATS_TOKEN` | empty | Hosted only |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Web app and server with hot reload |
| `npm run build` / `npm start` | Production build, then one Node process serving the SPA and API |
| `npm test` | Unit tests (Vitest), no network |
| `npm run test:int` | Integration tests (server routes, adapter with fake WebRTC), no network |
| `npm run e2e` | Playwright end-to-end tests with a fake mic and fake voice adapter |
| `npm run eval` | Answer-quality eval against the real model (uses your key and spends a little) |
| `npm run eval -- --validate` | Checks the golden set and multi-turn scripts load; no network, no key |
| `npm run lint` / `npm run typecheck` | ESLint and TypeScript |
| `npm run secrets:scan` | secretlint over the repo |
| `npm run doctor` | Checks Node version and that `.env` exists and has a key, without printing it |

## Secrets and privacy

- **Your OpenAI key stays on the server.** It lives in `.env` locally (gitignored) or in your host's dashboard. The browser only ever receives a short-lived key that expires after 60 seconds.
- **Never** put a secret in a `VITE_*` variable or in client code. Vite inlines those into the public bundle. CI fails if the built bundle contains `sk-` or `OPENAI_API_KEY`.
- **Never** commit `.env`, paste it into an issue or chat, or give it to a coding agent. A pre-commit hook and CI run `secretlint`; also turn on GitHub push protection for your fork.
- **If a key leaks, rotate it at once** in the OpenAI dashboard. Deleting it from git history is not enough.
- **No data is stored.** No database, no accounts, no transcripts on the server. Logs never contain keys, transcripts, SDP or full IP addresses.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Landing banner: "Server isn't configured" | `.env` is missing or the key is wrong. Run `npm run doctor`. |
| "The API key has no credit left" | Add billing or raise the budget on your OpenAI project. |
| "Microphone access is blocked" | Click the lock icon in Chrome's address bar, allow the mic, then Retry. Or continue by typing. |
| No sound after Start | Click **Tap to enable sound**. Check the tab isn't muted. |
| Ava interrupts herself on laptop speakers | Use headphones. Tap-to-talk (the default) avoids this. |
| `node -v` isn't 24 | `fnm use` in the repo folder (it reads `.nvmrc`). |
| Port 5173 or 8787 in use | Stop the other process, or set `PORT` in `.env`. |

## Prompt for a coding agent

Paste this into Claude Code, Cursor, Codex or a similar agent from the repo root to build or set up the project. It contains no secrets, and it tells the agent never to touch yours.

```text
You are setting up and building the "Ava" voice presentation agent in this repository.

1. Read AGENTS.md first and follow its rules exactly. Then read, in order:
   docs/product-brief.md, docs/architecture.md, docs/decisions/*.md, docs/implementation.md.
2. Build the milestones in docs/implementation.md strictly in order (M0, M1, M2, ...).
   For each milestone: implement only that milestone, add the tests it lists, run
   `npm run lint`, `npm run typecheck`, `npm test` and `npm run test:int` (plus `npm run e2e`
   when the milestone says so), and make them pass before moving on. Commit once per milestone
   with the commit message given in the milestone.
3. Secrets:
   - Never open, read, print, cat, grep, paste, summarize or commit `.env` or any file that
     may contain a key. Never echo environment variables.
   - If `.env` does not exist, create it only by copying `.env.example`, then STOP and ask me
     to paste my OpenAI key into `.env` myself. Do not ask me to paste the key into the chat.
   - To check configuration, run `npm run doctor`; it reports presence, never values.
   - Never put a secret in a `VITE_*` variable, client code, test fixture, log line or commit.
   - Unit and integration tests must not use the network or a real key.
4. Do not run `npm run eval` or any command that calls the real OpenAI API unless I ask;
   it spends money.
5. If a "Verify in spike" item in docs/architecture.md fails, or the docs contradict each other,
   stop and ask me instead of guessing.
6. When a milestone is done, report: what was built, the test results (with counts), and
   anything skipped or unverified.
```

## Results

Filled in at milestone M13 from measured runs.

| Metric | Target | Measured |
|---|---|---|
| Talk press → Ava silent | ≤ 150 ms | _tbd_ |
| Release → first answer audio | p50 ≤ 1.5 s, p90 ≤ 2.5 s | _tbd_ |
| Silence between sentences | p50 ≤ 600 ms | _tbd_ |
| Eval: deterministic checks | ≥ 95% | 100% |
| Eval: judge pass | ≥ 90% | 100% |
| Eval: safety failures | 0 | 0 |
| Eval: multi-turn drop | ≤ 5 points | 0 points |

Eval figures: [eval/report.md](eval/report.md), run 2026-10-28 with `gpt-realtime-2.1` (judge `gpt-4.1`), 40 cases × 3 runs, worst result kept.

## Documentation

| Doc | What it covers |
|---|---|
| [docs/product-brief.md](docs/product-brief.md) | What we build and how it should feel |
| [docs/architecture.md](docs/architecture.md) | Every backend, frontend and AI/ML decision |
| [docs/decisions/](docs/decisions/) | ADRs: voice stack, backend, turn-taking |
| [docs/implementation.md](docs/implementation.md) | Step-by-step build with code and tests |
| [AGENTS.md](AGENTS.md) | Rules for coding agents |
| [docs/mockups/motion-mockup.html](docs/mockups/motion-mockup.html) | Clickable motion reference (open in a browser) |
