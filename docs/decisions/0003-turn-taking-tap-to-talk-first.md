# ADR 0003: Turn-taking. Tap-to-talk first, then hands-free, then a toggle

- **Status:** Accepted
- **Date:** 2026-10-26
- **Related:** [product-brief.md](../product-brief.md) §7.4, §8, §9, [architecture.md](../architecture.md) §4.5–4.8, §5.6, [ADR 0001](0001-realtime-voice-architecture.md)

## Context

There are two ways for a reviewer to take a turn:

- **Hands-free:** just start speaking, and server voice detection cuts the agent off.
- **Tap-to-talk:** hold `Space`, or tap the status orb, to talk.

The assessment email only requires that the "User should be able to interrupt the AI agent" (brief §1.1). It does not say how, so **tap-to-talk meets the requirement**. Hands-free is the most natural experience and the strongest showcase of "user interaction for voice-based AI", which the email says it wants to see. It is also where most quality risk sits:

- echo on laptop speakers
- coughs and room noise causing false interruptions
- tuning how eagerly the service decides a turn has ended

Tap-to-talk gives explicit, clean turn boundaries. Nothing has to guess where a turn ends, and noise can't interrupt Ava.

The rest of the pipeline has to work whichever way a turn starts. That pipeline covers session setup, per-slide narration, the `goto_slide` and `resume_presentation` tools, resume after an answer, captions, text mode and recovery.

## Decision

We build turn-taking in three phases:

1. **Phase 1: tap-to-talk.** Hold `Space` (or tap the orb to start, and tap again to send). Pressing interrupts Ava right away, and releasing sends the turn. Session `turn_detection` is `null`, and the client commits each turn. Everything else in the brief (narration, slide changes, resume, text mode, recovery) is built and polished in this mode. **This is the submittable baseline:** it meets every requirement in the email.
2. **Phase 2: hands-free (recommended stretch goal, go/no-go on October 28 at 14:00, architecture.md §12).** Turn on `semantic_vad` with `interrupt_response: true` and `create_response: false`, so the client stays the only creator of responses (architecture.md §4.3). Add echo and false-interruption handling, the mute-mic control and the headphone tip. Once it's reliable, hands-free becomes the default. **It is not required**, because tap-to-talk already meets the interrupt requirement. It is the recommended next step before the October 29, 2026 deadline, because spoken barge-in best shows off voice interaction.
3. **Phase 3: hybrid toggle (stretch, after phase 2).** A **Hands-free / Tap to talk** switch in Controls. Tapping the orb always interrupts, in either mode. After 2 false interruptions in a row, the app suggests switching to tap-to-talk.

## Options considered

| Option | For | Against |
|---|---|---|
| **Tap-to-talk first, then hands-free, then hybrid** *(chosen)* | We build on a predictable input, so bugs in narration, tools and resume aren't hidden behind voice-detection noise. It also leaves a dependable fallback for speaker and noisy setups, and phase 1 already meets the assessment. | Phase 1 alone doesn't show spoken barge-in, the strongest showcase. If phase 2 isn't reliable by the deadline, we ship phase 1. |
| Hands-free only | The most natural experience, with the least UI. | Fails noticeably on laptop speakers. When something breaks during development, it's hard to tell whether voice detection, echo or our logic is at fault. |
| Tap-to-talk only | The most reliable, with the best audio quality. | Doesn't demonstrate spoken barge-in, and reviewers may read it as avoiding the hard part. |

## Consequences

- **`VoiceSession` gains** `beginUserTurn()`, `endUserTurn()` and `setTurnMode()`. The state machine gains a `turnMode` setting (architecture.md §4.2, §4.5).
- **Keyboard:** `Space` becomes hold-to-talk, which is the familiar convention, and pause moves to `P`.
- **Phase 1 latency** depends on explicit commits rather than server end-of-turn detection, so responses may be slightly faster.
- **Phase 1 truncation risk:** when the client cancels Ava's speech on press, we must check that the server cuts her message to the audio actually played over WebRTC. If it doesn't, the client sends `conversation.item.truncate` with the played milliseconds, timed from `output_audio_buffer.started`.
- **Order in implementation-plan.md:** phase 1 → phase 2 → phase 3. The acceptance checks in brief §12 are run in tap-to-talk at phase 1 and again in hands-free at phase 2.

## Revisit if

- Phase 2 can't reach a false-interruption rate low enough on laptop speakers. Then ship with tap-to-talk as the default when no headphones are detected, and hands-free as the option.
