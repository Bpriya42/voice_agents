# ADR 0002: Node + Hono backend for the prototype, Python for production

- **Status:** Accepted
- **Date:** 2026-10-26
- **Related:** [architecture.md](../architecture.md) §2, §11–14, [ADR 0001](0001-realtime-voice-architecture.md)

## Context

In the prototype the backend is deliberately thin. It has three routes:

- `GET /api/health`
- `POST /api/session`, which issues an ephemeral OpenAI Realtime key
- `POST /api/chat`, the fallback text answers

No voice audio passes through it, because the browser talks to OpenAI directly over WebRTC (ADR 0001). Nearly all the work and the quality risk sit in the React app: the state machine, the presentation cursor, interruption handling and audio.

The author is fluent in both Python and React + TypeScript. The priority for the take-home is **fast prototyping with high quality**, and a setup reviewers can't get wrong.

A production version for a company like Synthio Labs has different needs. Those include choosing between voice vendors (Claude for reasoning; Deepgram, Cartesia or ElevenLabs for speech), compliance controls such as recording, audit and server-side guardrails, telephony, and many concurrent sessions. The mature tools for those needs, Pipecat in particular, are Python.

## Decision

**Prototype:** Node 20 + **Hono**, written in **TypeScript**, in the same npm workspace as the frontend.

**Production:** move the backend to **Python**. The API layer becomes **FastAPI**, and a server-side voice agent runs on **Pipecat**, both behind the existing `VoiceSession` interface. The migration happens in stages, shown below, when the triggers listed under "Migration triggers" apply.

## Options considered (prototype)

| Option | For | Against |
|---|---|---|
| **Node + Hono (TypeScript)** *(chosen)* | One toolchain, so setup is `npm install` and `npm run dev`. The deck, slide ids and tool schemas are written once in `shared/` and used by both client and server, with no drift. One dev process and one production process. Easy deploy to Render, Fly or Railway. | Not the long-term production language. Server-side voice tooling (Pipecat) isn't available in Node. |
| FastAPI (Python) | The author is fluent in it. Pydantic and the automatic OpenAPI docs are good. It matches the production direction. | Reviewers need two toolchains (Node for the frontend, Python for the backend). The deck and tool schemas would be defined twice, in Pydantic and Zod, and need a contract test. A Python backend speeds up none of the critical work, which is all in the frontend. |

## Why Python for production

1. **Server-side voice pipeline.** Pipecat, a Python framework, chains speech-to-text, an LLM and text-to-speech per session. That allows any vendor for each step, including Claude for reasoning. It also handles barge-in, turn detection and telephony.
2. **Control and compliance.** The agent runs on our servers, so guardrails, recording, redaction and audit logs live where the conversation happens. This also removes the prototype's ephemeral-key limit, where a client could send its own `session.update` (ADR 0001).
3. **Ecosystem.** Evaluation, analytics, retrieval over approved medical content, and ML tooling are strongest in Python. That also suits a team that works with healthcare data.
4. **One backend language.** The API (FastAPI) and the voice agents (Pipecat) share models, config and deployment tooling.

## How it scales later

What stays the same at every stage: the React app, the session state machine, the slide data model, the `VoiceSession` interface and the UX in the product brief. Each stage replaces one layer behind a stable contract.

### Stage 0: Prototype (now)

```
Browser (React) ──WebRTC──▶ OpenAI Realtime
      │
      └──HTTP──▶ Node/Hono  (health, ephemeral key, fallback chat)
```

- One stateless process with no database.
- The browser owns the slide cursor.

### Stage 1: Python API, same voice path

```
Browser ──WebRTC──▶ OpenAI Realtime
   │
   └──HTTP──▶ FastAPI  (same 3 routes + auth, persistence)
                 │
                 └── Postgres (sessions, consented transcripts, audit)
```

- **API swap:** FastAPI replaces Hono with the **same routes and payloads**.
- **Types stay in one place:** FastAPI's OpenAPI schema becomes the source of truth. The TypeScript client types are **generated** from it with `openapi-typescript`, which keeps "one set of types" without sharing a language.
- **Deck:** `shared/deck.ts` becomes deck data served by the API (JSON first, a CMS later), with approved and versioned content for medical review.
- **Added:** SSO/auth, audit logging, OpenTelemetry traces, and per-tenant rate limits and quotas.
- **Frontend:** no changes beyond the generated types.

### Stage 2: Server-side voice agent (Pipecat)

```
Browser ──WebRTC──▶ Pipecat bot (Python, one per session)
                       ├─ STT  (e.g. Deepgram)
                       ├─ LLM  (e.g. Claude / OpenAI)
                       └─ TTS  (e.g. Cartesia / ElevenLabs)
   │
   └──HTTP──▶ FastAPI ──starts/stops bots, issues room tokens──▶ bot workers
```

- **Client:** a new `PipecatSession` adapter replaces `OpenAIRealtimeSession`. The rest of the frontend is unchanged.
- **Transport:** WebRTC through Daily or LiveKit, or Pipecat's own small WebRTC transport.
- **Tools:** `goto_slide` and `resume_presentation` become server-side, with events relayed to the client. Guardrails and redaction run on the server.
- **Vendor choice:** any component can be swapped per customer, including vendors that offer a HIPAA business associate agreement (BAA) where required.
- **Decision for this stage:** whether the slide cursor stays in the client or moves into the bot. Telephony (phone calls, where there is no screen) needs it in the bot. Record that choice in a new ADR.

### Stage 3: Horizontal scale

- **API layer:** stateless FastAPI replicas behind a load balancer, scaled on CPU and request rate.
- **Voice workers:** each active session is one bot process or container, which is CPU-bound real-time audio. They run as a worker pool on Kubernetes or ECS, or on a managed platform such as Pipecat Cloud or LiveKit Cloud. The pool scales on **concurrent sessions**, keeping warm spare capacity so a session starts in under 1 s.
- **Coordination:** Redis holds the session registry and the routing of a session to its worker, plus a queue for start requests when the pool is full.
- **Latency:** workers are deployed in several regions close to users and the speech vendors, and each session goes to the nearest region.
- **Reliability:** per-vendor fallbacks (a second speech-to-text or text-to-speech provider) and circuit breakers. The brief's "never a dead end" fallback becomes server-side too.
- **Cost and quality:** per-tenant budgets, and latency and quality dashboards (barge-in time, time to first audio, error rates). An offline evaluation harness replays recorded conversations against new prompts and models.

## Migration triggers

Move from Stage 0 to Stage 1 or Stage 2 when any of these become real requirements:

- Claude, or a specific speech vendor, is required for reasoning or voice quality.
- Compliance needs server-side recording, redaction, audit or vendor BAAs.
- Phone calls (telephony) or other channels without a browser.
- Multiple tenants, user accounts, or saved conversation history.
- Concurrency beyond what a direct browser-to-OpenAI setup with per-key rate limits can handle.

## Consequences

- The prototype stays simple: one install, one language across the codebase, and shared types.
- Production is a planned migration, not a rewrite. The frontend and the `VoiceSession` interface carry over, and the backend contract (routes and payloads) is kept stable so FastAPI can replace Hono.
- Keep the prototype backend free of anything that's hard to port: no Node-specific libraries in the API contract and no business logic outside `prompt.ts` and `deck.ts`.
