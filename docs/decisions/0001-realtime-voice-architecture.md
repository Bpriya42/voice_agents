# ADR 0001: OpenAI Realtime over WebRTC, behind a provider adapter, with a client-driven slide cursor

- **Status:** Accepted
- **Date:** 2026-10-26
- **Related:** [architecture.md](../architecture.md) §3–6, [product-brief.md](../product-brief.md) §6, §9, §10

## Context

The prototype has to show an AI presenter that a reviewer can interrupt: by pressing to talk, and, as a stretch goal, just by speaking (ADR 0003). The presenter must answer, change to a relevant slide, and resume where she left off, all within tight targets: audio stops within ≤ 300 ms of barge-in, and the first answer audio arrives within ≤ 1.5 s. It must also recover from mic denial and voice-session failure without a dead end. The build must stay lightweight, so we optimise for UX polish rather than infrastructure.

Two linked decisions follow:

1. **Which voice stack.**
2. **Who drives the presentation:** the model or the client.

Synthio Labs' own stack is not public. Their positioning (clinical-grade, compliant, grounded and real-time) means a production version would need vendor flexibility, so the design should allow swapping providers even though we ship only one.

## Decision 1: voice stack

We use the **OpenAI Realtime API** (speech-to-speech model) **over WebRTC from the browser**. A small Node backend mints ephemeral keys and holds the session config. All provider code sits behind a `VoiceSession` adapter interface.

### Options considered

| Option | For | Against |
|---|---|---|
| **A. OpenAI Realtime, WebRTC** *(chosen)* | One speech-to-speech model, so no extra transcription and synthesis steps add latency. Server-side voice activity detection (VAD) handles barge-in, and the server truncates the agent's message to the audio actually played. Function calling for slide changes and input transcription for captions are built in. WebRTC gives echo cancellation, jitter buffering and a short media path, and no media server is needed. | Single vendor. Usage is relatively expensive. Model ids and event names change between releases. |
| B. Gemini Live API | Similar architecture at lower cost. | Interruption quality depends on client-side buffer handling, so our top-priority interaction carries more risk. The browser tooling is less mature. |
| C. ElevenLabs Agents | Best voice quality, a dedicated turn-taking model, browser-side tools and a React SDK. Can use Claude or another model for reasoning. | Agent config lives in a vendor dashboard, so reviewers can't reproduce it as easily from the repo. Less control over truncating the agent's message and over response-level instructions, which the client-driven cursor needs. |
| D. Pipecat or LiveKit Agents chaining speech-to-text → LLM (for example Claude) → text-to-speech | Most control. Any component can be swapped, which is the closest to a production clinical stack. | Needs a Python service and media infrastructure. Chaining adds roughly 300–800 ms. Tuning time competes with UX polish in a take-home. |

### Consequences

- Fastest route to a polished interruption experience with the fewest moving parts: one SPA, one small server, one API key.
- The `VoiceSession` interface keeps Options C and D open. A future `ElevenLabsSession` or `PipecatSession` would replace only `web/src/voice/<provider>/`.
- The interface also lets us ship a `FallbackSpeechSession` (`/api/chat` + browser `speechSynthesis`) for outages and a `FakeVoiceSession` for tests.
- Model id and voice are environment variables, and event names are pinned in one file, so API churn means small fixes.
- **Known limitation:** a client holding an ephemeral key can send its own `session.update`. That's acceptable for a prototype. In production, a server-side sideband connection would control the session.

## Decision 2: client-driven slide cursor

The **browser owns the presentation cursor** (slide + script segment). The model never decides what comes next in the narration:

- The client asks the model to speak one short scripted segment at a time, using `response.create` with per-response instructions.
- The model answers questions and *requests* navigation through tools: `goto_slide(slide_id, intent)` and `resume_presentation()`. The client validates and applies them.

### Options considered

| Option | For | Against |
|---|---|---|
| **Client-driven cursor** *(chosen)* | Resume is predictable: we know the interrupted segment, and the server truncation tells the model what was heard. Reconnect can re-seed from client state. Pause, arrow keys and the fallback narration (`speechSynthesis` reading the scripts) work the same way. The UI and the narration cannot drift apart. | More client logic: a narration loop, an `awaitingResume` timer, `returnTo` handling. Requires short segments, and a one-request-per-segment rhythm adds a small gap between segments. |
| Model-driven: the whole talk goes in the prompt and the model calls `goto_slide` as it goes | Less client code, and narration flows more freely. | The model may skip, reorder or improvise content, which hurts accuracy in a medical context. Resuming from the exact point depends on the model's memory. Reconnect and fallback have no reliable source of position. The slide can drift from the speech. |

### Consequences

- Scripts are written in 1–2 sentence segments (`shared/deck.ts`). At worst, a resume repeats part of one segment, and the model bridges it.
- Narration stays close to vetted script wording, which supports the brief's grounding and science-first goals.
- The 350 ms pause between segments must be checked during QA. If it sounds choppy, we can queue the next segment's `response.create` as soon as the current audio is nearly finished.

## Revisit if

- Measured barge-in latency is over 300 ms, or self-interruption on speakers can't be tuned away. Then evaluate Option C's turn-taking model.
- The product needs Claude for reasoning, a HIPAA-oriented vendor setup, or telephony. Then evaluate Option D behind the same adapter.
- The model id, the event schema, or WebRTC truncation behaviour changes in ways that break the adapter.
