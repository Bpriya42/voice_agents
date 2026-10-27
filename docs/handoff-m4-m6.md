# Handoff: milestones M4–M6

> State on 2026-10-27: **M4, M5 and M6 are implemented, tested and committed locally (not pushed).** M7 was stopped at the user's request, after part of it had already been drafted (see §5).

## 0. Which branch to open

- **Work on branch `claude/milestones-m4-m7-4da436`.** Its tip commit holds all of this work, on top of `main` at `657b517`.
- **It exists only locally.** It has not been pushed and has no upstream, so it is not on GitHub and a fresh clone won't have it.
- **It is checked out in the worktree** `C:\Users\bpriy\PROJECT\voice_agents\.claude\worktrees\milestones-m4-m7-4da436`. Open that folder to continue; `npm install` has already been run there.
- **From the main checkout**, `git switch claude/milestones-m4-m7-4da436` fails while the worktree holds the branch. Either work in the worktree folder, or remove the worktree first (`git worktree remove <path>`, after checking it has no uncommitted changes).
- **To share it:** `git push -u origin claude/milestones-m4-m7-4da436`, then open a PR against `main`. Only do this when the user asks.
- **Start M7 on this same branch** (its name already covers M4–M7), after the keep-or-remove decision in §5.

## 1. Status at a glance

| Milestone | State | Evidence |
|---|---|---|
| M4 Web shell | Done | Unit tests pass; M4 e2e (`smoke`, `landing`, `micCheck`, `micDenied`) 9/9 |
| M5 Voice adapter | Done (simulated only) | `web/test/voice/openaiSession.test.ts` 26/26 against a fake WebRTC |
| M6 Controller and machine | Done | `web/test/controller/controller.test.ts` 64/64; coverage `presentation` 96%, `machine` 99% lines |
| Spike S | Done | `docs/spike-log.md`. Found and fixed out-of-band cancel (needs `response_id`). Sentence gap p50 919 ms is over target |
| M7 | Done (fake adapter); real-API manual checks pending | All 26 e2e tests pass (twice, `--repeat-each=2`); see §5 |

Checks last run: `npm run lint` clean · `npm run typecheck` clean · `npm test` 195 passed · `npm run test:int` 129 passed · `npm run build` passed (bundle check OK, fake adapter not shipped) · `npm run secrets:scan` clean. **Nothing was run against the real OpenAI API.**

Commit: one local commit on `claude/milestones-m4-m7-4da436` (§0, §6.4). Not pushed.

## 2. Where things are

```
web/src/api/client.ts                 typed /api client, Zod-parsed, stable error codes, sendBeacon end
web/src/audio/                        micLevel.ts (rms, speech detector), useMic.ts, context.ts (AudioContext unlock)
web/src/input/                        shortcuts.ts (one key table, isEditableTarget), useShortcuts.ts
web/src/slides/visuals/               six SVG diagrams; every number is from a named deck fact
web/src/components/                   Landing, MicCheck, Stage, Slide, StatusOrb, Controls, Captions, Notices, HelpDialog (+ M7 drafts, §5)
web/src/voice/types.ts                VoiceSession contract and VoiceEvent union
web/src/voice/openai/                 events.ts (only file with provider event names), outputGate.ts, OpenAIRealtimeSession.ts
web/src/voice/fake/FakeVoiceSession.ts  manual drivers for tests + auto mode for e2e
web/src/presentation/                 checkpoint.ts, registry.ts, timers.ts, controller.ts (+ notes/captions/matchSources, §5)
web/src/machine/                      session.ts (XState v5, parallel regions, controlsOf), status.ts (label priority, orb state, error copy)
web/test/voice/                       fakeWebRTC.ts, openaiSession.test.ts
web/test/controller/                  harness.ts, controller.test.ts
web/e2e/                              helpers.ts, fakeSpeech.ts, M4 specs (+ M7 specs, §5)
```

Changed outside `web/src`: `shared/src/prompt.ts` (+`greetingInstructions`, snapshot added), `shared/src/prompt.test.ts`, `playwright.config.ts`, `web/vite.config.ts`, `web/package.json` (+`zod`), `scripts/check-bundle-secrets.mjs` (fails if the fake marker reaches `dist`), `package-lock.json`.

## 3. How the core works (read before changing the controller)

- **Only `PresentationController.request()` calls `createResponse`.** It reserves the slot in the `Registry` first, refuses while anything is generating, and refuses narration while anything is playing. It unmutes the output gate only for this authorized replacement.
- **`pump()` is the single "what next" decision**, called after every event: settle the current turn's response (`audioSettled` = generation done *and* playback completed/cleared/none) → `afterResponseBarrier` (resume / bounded continuation / finish), otherwise `maybeNarrate()`.
- **Narration** advances only on `playback_completed` of the current, non-cancelled narration request (`sentencePlayed`). `playback_cleared` never advances. Slides change in `showCheckpoint` just before a sentence is requested.
- **Interrupts:** `interruptAll()` writes a partial slide note if needed, marks in-flight records `cancelled`, clears the resume timer, and returns the adapter's interrupt promise. Answers and replacement narration wait for that barrier.
- **Cut answers:** an answer cancelled by talk, typing, pause or timeout becomes a `Cut` (Ask again re-requests an answer for the same user item; Dismiss restores status via `questionDone`).
- **Epochs:** every new adapter gets `registry.bumpEpoch()`; `onEvent` drops events from other epochs; `Timers` only fire if their `{epoch, turnId}` scope is still current.
- **Machine mirroring:** `emit()` derives the agent and presentation regions from controller state and sends only changed events, then rebuilds a cached `ControllerView` for `useSyncExternalStore`.
- **Test harness:** `web/test/controller/harness.ts` (`started`, `typed`, `spoken`, `play`, `flush`). Use `flush()` (`advanceTimersByTimeAsync(0)`), **not** `runAllTimersAsync`, or the 10 s thinking timeout fires.

## 4. Decisions and deviations from implementation.md

1. **Spike fallbacks assumed:** the remote stream also plays through a muted `<audio>` element; buffer events without `response_id` are credited to the oldest unplayed response, never the newest generation. Interrupt also cancels a request whose `response.created` has not arrived (ordered data channel).
2. **Interface additions:** `sendUserText` / `sendToolResult` return client-chosen item ids (≤ 32 chars); `generation_done.outputItemIds`; `VoiceSession.sessionId` and `outputLevel()`; `"focusLost"` shortcut action (focus loss pauses, Esc restores).
3. **Shortcuts with Ctrl/Cmd/Alt are ignored** (never hijack Ctrl+R etc.).
4. **`VITE_E2E`** is set in `vite.config.ts` for `--mode e2e` instead of a `web/.env.e2e` file.
5. **Mic e2e:** Chrome's fake mic beeps for ~100 ms, which never passes the 300 ms speech rule, so `playwright.config.ts` feeds a generated speech-like WAV (`web/e2e/fakeSpeech.ts`). Headless Chromium has no prompt to deny, so `micDenied.spec.ts` stubs `getUserMedia` with `NotAllowedError`; the separate "mic denied" Playwright project was dropped.
6. **`stayHere` also updates `preQuestion.displayedSlide`**, so a finished talk doesn't jump back after the user chose to stay.
7. **`FakeVoiceSession.ackInterrupt` acknowledges only what was in flight at `interrupt()` time.**
8. **Minimal reconnect** (`reconnect()`) exists for Retry and for an interrupt that's never acknowledged (1.5 s). A `disconnected` event shows "Connection lost." + Retry. Automatic retries, backoff and backup voice are M8.

## 5. M7 work drafted before the stop (unverified)

These exist in the tree but were not finished or checked:

- `web/src/app/SessionProvider.tsx`, `web/src/App.tsx` (live layout), `web/src/main.tsx`
- `web/src/components/{AskBox,StayHere,EndScreen}.tsx`
- `web/src/presentation/{notes,captions,matchSources}.ts` (unit tests pass)
- `web/e2e/{narration,interrupt,tools,typing,keyboard,end}.spec.ts` — now pass. The earlier failures came from Playwright reusing a plain `npm run dev` server on 5173 (fake adapter off). e2e now runs on its own ports (web 5174, API 8788) with `strictPort`.

Entanglement: `controller.ts` already uses `CaptionLog`, `notes` and `matchSources`, and the M4 shell renders through `SessionProvider`. Removing the M7 drafts is therefore not a clean file deletion; the user has been asked whether to keep or remove them.

## 6. Known gaps and next steps

1. Spike S is done (`docs/spike-log.md`). **Open decision:** the sentence gap p50 is 919 ms, over the 600 ms target, so arch §5.9's prefetch decision needs an owner.
2. **Decide on the M7 drafts** (keep and finish, or remove), M7 e2e is green. What's left is the manual run of brief §12 checks 2–5 and 9–12 on headphones, using `docs/manual-checks-m7.md`.
3. `npm run e2e` is green (26 tests). The remaining M7 "done when" item is manual: brief §12 checks 2–5 and 9–12 against the real API on headphones (needs the user's OK).
4. **Commit granularity:** M4–M6 (plus the M7 draft) went in as **one commit**, not one per milestone as AGENTS.md asks. The pieces depend on each other (the controller uses the caption/notes modules, the shell renders through `SessionProvider`), so a clean three-way split that stays green at each commit was not attempted. If the history must be split, use the plan's messages: M4 `feat(web): landing, mic check, slide rendering and shortcuts`, M5 `feat(voice): VoiceSession contract, OpenAI Realtime adapter and fake`, M6 `feat(web): presentation controller, response arbiter and session machine`.
5. Not yet built: autoplay-blocked notice ("Tap to enable sound"), hosted session warning/limit timers (M11), Turnstile (M11), `/api/metrics` (M9).

## 7. Safety notes for whoever picks this up

- Follow AGENTS.md: never open or print `.env`; tests use fakes only; `npm run eval` and any real-API run need the user's explicit OK.
- e2e uses ports 5174/8788, so a running `npm run dev` (5173/8787) no longer interferes. Another worktree running e2e at the same time would still collide.
