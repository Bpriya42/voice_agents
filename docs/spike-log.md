# Spike S log (2026-10-27)

Day-1 spike from implementation.md §S. The tools are `web/spike.html` with `web/src/spike/main.ts`, plus `scripts/spike/text-session.ts` and `scripts/spike/sideband.ts`.

- **Environment:** desktop Chromium (the Claude desktop app's browser pane), Node 22.17, model `gpt-realtime-2.1`, local dev server.
- **Not tested:** the spike ran with no microphone (the pane blocks capture), so **Commit turn** was not exercised.
- **What was logged:** event types and ids only. Times are ms from the action that started each scenario.

## Results

| Item | Result |
|---|---|
| Session config accepted by `client_secrets` | **Confirmed.** `/api/session` minted keys and the calls connected with the `sessionConfig()` GA shape. |
| Event ordering | **Confirmed.** `response.created` → `output_item.added` → `output_audio_buffer.started` (while transcript deltas still stream) → `response.output_audio.done` → `response.done` → `output_audio_buffer.stopped`. `stopped` came **3.8 s after** `response.done` for one sentence. Generation finishes long before playback, so `response.done` is not playback completion. |
| `output_audio_buffer.*` carry `response_id` | **Confirmed.** `started`, `stopped` and `cleared` all carry the right `response_id`, in-band and out-of-band. The oldest-unplayed fallback in the adapter is kept as a guard but isn't needed. |
| `output_audio_buffer.clear` acknowledged and truncates | **Confirmed.** `output_audio_buffer.cleared` arrives about 16–21 ms after `clear`, followed by `conversation.item.truncated`. This also happens for out-of-band responses. Audio still generated after a clear is **not** played again. |
| `response.cancel` | **In-band:** `response.done` status `cancelled` about 52 ms after cancel. **Out-of-band: a bare `response.cancel` returns `response_cancel_not_active` and generation keeps running** (it finished as `completed` about 2.8 s later). `response.cancel` with `response_id` works for out-of-band responses (`cancelled` after 64 ms). **Adapter changed:** see below. |
| Web Audio receives the remote track (muted `<audio>` needed?) | **Needed.** With no media element attached, an analyser on the remote stream read RMS 0 during speech. With the muted `<audio>` element (as `outputGate.ts` does), the post-gate analyser read peak RMS 0.104 at gain 1 and **0 at gain 0** (AudioContext running, page visible). One analyser frame (~11 ms) can still hold pre-mute samples right after `setGain(0)`. |
| Out-of-band responses (`conversation: "none"`) | **Confirmed.** Audio plays, buffer events fire, clear works, and no `conversation.item.added` appears for the response. |
| Sideband from a reported `call_id`; hangup | **Confirmed.** The `call_id` comes from the SDP answer's `Location` header. `wss …/realtime?call_id=` from Node received the call's events (28 during one sentence). `POST /v1/realtime/calls/{id}/hangup` returned 200, and the sideband socket closed 2.2 s later (code 1006). |
| Text-output Realtime session for evals | **Confirmed for tool calls.** Same `sessionConfig()` with `output_modalities: ["text"]`. All 5 sample questions made the same tool calls as the audio session (see below). Answer lengths are in the same range. |
| Sentence gap p50 | **919 ms** from `stopped` of one sentence to `started` of the next (n = 19, range 654–1390 ms); about 1030 ms to audible output after the gate. **Above the 600 ms target**, so the prefetch decision (arch §5.9) is now open. Caveat: the pane was hidden for part of this run, so the audible-gap figure is less reliable than the event-based one. |

## Adapter change from this spike

The controller narrates and greets out-of-band. Before this change, `OpenAIRealtimeSession.interrupt()` sent a bare `response.cancel`. During narration, the API rejected it, generation kept going, and the interrupt waited for its 1.5 s timeout and then reconnected. Now:

- `interrupt()` sends `response.cancel` with `response_id` for every generating request whose response is known.
- A bare cancel is sent only for a request whose `response.created` hasn't arrived yet.
- When `response.created` arrives for a request that was already interrupted, the adapter cancels it by id.

Two unit tests cover this (`web/test/voice/openaiSession.test.ts`).

**Checked against the real API afterwards:** text mode, start, then typing during narration.
- The status paused at once ("Paused while you type").
- "What are the side effects?" jumped to slide 5, answered, then returned to slide 1, and narration resumed.
- End showed the end screen.
- There was no reconnect.

## Sample questions: audio vs text session

| Question | Audio session | Text session |
|---|---|---|
| What are the side effects? | `goto_slide(safety, answer)`, 91 words | `goto_slide(safety, answer)`, 109 words |
| Go to the evidence slide. | `goto_slide(evidence, user_request)`, 33 words | `goto_slide(evidence, user_request)`, 19 words |
| How do these medicines actually work? | `goto_slide(mechanism, answer)`, 62 words | `goto_slide(mechanism, answer)`, 69 words |
| Should I take a higher dose to lose weight faster? | no tool, 56 words | no tool, 45 words |
| Okay, go on. | `resume_presentation`, 55 words after the tool output | `resume_presentation`, 0 words |

The "go on" difference only appears after the spike's generic follow-up `response.create`. The real controller resumes locally on `resume_presentation` and doesn't request that follow-up.

## Key timelines (ids shortened)

**Interrupt, in-band**

```
0     out response.create
30    in  response.created            in_progress
822   in  output_audio_buffer.started
1523  out response.cancel
1523  out output_audio_buffer.clear
1539  in  output_audio_buffer.cleared
1575  in  response.done               cancelled
1576  in  conversation.item.truncated
```

**Interrupt, out-of-band with a bare cancel (before the fix)**

```
0     out response.create (conversation: none)
568   in  output_audio_buffer.started
1168  out response.cancel
1168  out output_audio_buffer.clear
1184  in  output_audio_buffer.cleared
1188  in  error                       response_cancel_not_active
1190  in  conversation.item.truncated
…     generation continues; response.done completed later
```

**Interrupt, out-of-band, cancelled by `response_id`**

```
0     out response.create (conversation: none)
505   in  output_audio_buffer.started
983   out response.cancel {response_id}
983   out output_audio_buffer.clear
1004  in  output_audio_buffer.cleared
1047  in  response.done               cancelled
```
