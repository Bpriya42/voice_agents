# ADR 0001: OpenAI Realtime over WebRTC, behind a provider adapter, with a client-driven slide cursor

- **Status:** Accepted
- **Date:** 2026-10-26
- **Related:** [architecture.md](../architecture.md) §3–5, [product-brief.md](../product-brief.md) §6, §9, §10

## Context

The prototype has to show an AI presenter that a reviewer can interrupt: by pressing to talk, and, as a stretch goal, just by speaking (ADR 0003). The presenter must answer, change to a relevant slide, and resume where she left off, all within tight targets: audio stops within ≤ 300 ms of barge-in, and the first answer audio arrives within ≤ 1.5 s. It must also recover from mic denial and voice-session failure without a dead end. The build must stay lightweight, so we optimise for UX polish rather than infrastructure.

Two linked decisions follow:

1. **Which voice stack.**
2. **Who drives the presentation:** the model or the client.

Synthio Labs' own stack is not public. Their positioning (clinical-grade, compliant, grounded and real-time) means a production version would need vendor flexibility, so the design should allow swapping providers even though we ship only one.

## Decision 1: voice stack

We use the **OpenAI Realtime API** (speech-to-speech model) **over WebRTC from the browser**. A small Node backend mints short-lived keys that carry the session config, after checking the hosted demo's limits ([architecture.md](../architecture.md) §3.2). On the hosted demo the browser reports the call id so the server can open a sideband connection. All provider code sits behind a `VoiceSession` adapter interface.

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
- **Session control:** a client can send its own `session.update` over the data channel. On the hosted demo a server sideband connection (`wss …/v1/realtime?call_id=…`) re-applies the server's config and enforces the session time limit ([architecture.md](../architecture.md) §3.3). Local runs accept the limitation, since the reviewer uses their own key.

## Decision 2: client-driven slide cursor

The **browser owns the presentation cursor** (slide + script sentence). The model never decides what comes next in the narration:

- The client asks the model to speak one slide's script at a time, using `response.create` with per-response instructions. On interruption, the truncated transcript (what was actually heard) tells the client which sentence was reached ([architecture.md](../architecture.md) §5.9). *Amended 2026-10-26: originally one segment per response; per slide was chosen to keep gaps between sentences inside the model's own speech.*
- The model answers questions and *requests* navigation through tools: `goto_slide(slide_id, intent)` and `resume_presentation()`. The client validates and applies them.

### Options considered

| Option | For | Against |
|---|---|---|
| **Client-driven cursor** *(chosen)* | Resume is predictable: the server truncation tells us and the model what was heard, so we know the interrupted sentence. Reconnect can re-seed from client state. Pause, arrow keys and the fallback narration (`speechSynthesis` reading the scripts) work the same way. The UI and the narration cannot drift apart. | More client logic: a narration loop, an `awaitingResume` timer, `returnTo` handling. Requires matching the output transcript to script sentences, and adds a small gap at each slide boundary. |
| Model-driven: the whole talk goes in the prompt and the model calls `goto_slide` as it goes | Less client code, and narration flows more freely. | The model may skip, reorder or improvise content, which hurts accuracy in a medical context. Resuming from the exact point depends on the model's memory. Reconnect and fallback have no reliable source of position. The slide can drift from the speech. |

### Consequences

- Scripts are stored as sentences (`shared/deck.ts`). At worst, a resume repeats one sentence, and the model bridges it.
- Narration stays close to vetted script wording, which supports the brief's grounding and science-first goals.
- Between-response gaps occur only at slide boundaries. The next slide is requested on `response_done`, which arrives before the audio finishes, so generation overlaps the tail of playback. The gap is measured against the brief's p50 ≤ 600 ms target.

## Revisit if

- Measured barge-in latency is over 300 ms, or self-interruption on speakers can't be tuned away. Then evaluate Option C's turn-taking model.
- The product needs Claude for reasoning, a HIPAA-oriented vendor setup, or telephony. Then evaluate Option D behind the same adapter.
- The model id, the event schema, or WebRTC truncation behaviour changes in ways that break the adapter.
