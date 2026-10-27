# ADR 0002: Node + Hono now; Python/Pipecat only when justified

- **Status:** Accepted; amended 2026-10-26. Supersedes the earlier unconditional production migration in this ADR.
- **Date:** 2026-10-26
- **Related:** [architecture.md](../architecture.md) §2, §3, §8–10, [ADR 0001](0001-realtime-voice-architecture.md)

## Context

The prototype backend is thin: health, short-lived Realtime client secrets (after the hosted demo's limit checks), and backup-voice text answers. Audio flows directly between the browser and OpenAI. The major delivery risks are playback, interruption, tools and resume behavior in the client, not the backend language.

The author knows Python and TypeScript. One toolchain and shared deck/schema definitions make a TypeScript backend appropriate for the take-home. Production requirements have not established a reason to replace it.

## Decision

Use **Node 24 LTS + Hono + TypeScript** in the frontend's npm workspace. Pin the supported patch and dependencies when scaffolding. Desktop Chrome is the tested browser baseline. Preserve one install and one documented local start command.

Keep this backend for production unless concrete requirements justify a change. Python/FastAPI and Pipecat are conditional options, not a mandatory next stage. Accounts, persistence, quotas, audit records and more tenants do not alone require a language migration. A server sideband connection can also be added to the existing Node service; it does not depend on Python.

## Current shape

```
Browser (React) ──WebRTC──▶ OpenAI Realtime
      │
      └──HTTP──▶ Node/Hono  (health, limits + short-lived key, backup chat)
                    └──wss sideband per call (hosted only)──▶ OpenAI Realtime
```

- One process with no database. Rate-limit, quota and concurrency counters live in memory and reset on restart; the OpenAI project budget is the hard cost ceiling ([architecture.md](../architecture.md) §8).
- Hosted on Render or Railway as a single instance, with a layered spend cap ([architecture.md](../architecture.md) §3.6). The sideband enforces the session time limit and server-owned config on the hosted build (§3.3).
- The browser owns the presentation checkpoint.

## Options and tradeoffs

| Option | When it fits | Tradeoff |
|---|---|---|
| Node/Hono with direct WebRTC (chosen now) | Small web demo and a thin API | Minimal setup; client orchestration must be tested carefully |
| Extend Node with server session control | Need trusted tools or policy control with the same voice path | Adds session lifecycle work without a language change |
| FastAPI/Pipecat voice service | Demonstrated need for server media orchestration, required integrations, telephony, or independent speech/reasoning vendors | Adds a second toolchain, media transport and operational work |

## Revisit triggers

Open a new ADR when an actual requirement cannot be met reasonably by the current design:

- A required vendor integration or telephony channel benefits materially from Pipecat.
- Server media processing, recording or redaction is needed and evaluated options favor that stack.
- Measured reliability, latency, cost or concurrency limits justify moving the media path.
- The maintaining team needs Python for a concrete integration and accepts the migration cost.

Compare retaining Node, adding a separate voice service, and replacing the API. Include measured tradeoffs, deployment cost, data controls, rollback and acceptance tests. Changing languages is not itself a compliance control.

## Conditional migration outline

If selected later, preserve external API contracts where practical. FastAPI can publish OpenAPI for generated TypeScript clients; the deck can become versioned JSON with shared validation. A server voice agent may use Pipecat and a selected media transport.

Do not promise that only the adapter changes. Moving tools or presentation ownership to the server affects events, recovery, authorization and frontend state. Decide cursor authority, session identity, ordering, cancellation and playback acknowledgements explicitly. Re-run the interaction acceptance suite against the new contract.

Worker pools, regional placement and persistence are future designs driven by measured load. No Redis, database or worker orchestration is required for the take-home.

## Consequences

- The prototype remains one language and one local toolchain.
- The adapter boundary supports changes without claiming every provider is interchangeable.
- Production investment follows demonstrated needs rather than a precommitted rewrite.
- Keep deck data, prompts and transport-specific code separate so a later migration is reviewable.
