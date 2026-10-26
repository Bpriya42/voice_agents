# Product Brief: Voice Presentation Agent

> Take-home prototype for Synthio Labs. This file holds the product decisions: what we build, for whom, and how it should feel.
> Stack and system design go in [architecture.md](architecture.md). Build order goes in [implementation-plan.md](implementation-plan.md).

## 1. Summary

A web app where an AI presenter gives a short, spoken, six-slide talk on **how GLP-1 medicines work**. The reviewer can cut in at any time by pressing to talk, or, as a stretch goal, just by speaking. The agent stops at once, answers the question, changes to the relevant slide if one fits, and then picks the talk back up. The interface always shows what the agent is doing. When the mic or the voice connection fails, the demo keeps working: typed questions still get spoken answers.

**The priority is the quality of the interaction.** A small, polished feature set beats a large, rough one.

### 1.1 Assessment requirements

These come from the Synthio Labs take-home email. **Deadline: Thursday, October 29, 2026, end of day.** Submit a GitHub repo link or a zip of the code.

| Requirement (from the email) | How this brief meets it |
|---|---|
| Present 5–6 slides on any topic of your choice | Six slides on how GLP-1 medicines work (§5) |
| The AI agent automatically changes slides based on the user's question | `goto_slide` during answers (§6) |
| The user can interrupt the AI agent | Phase 1 tap-to-talk stops Ava immediately (§9.1). Hands-free spoken interruption is a recommended stretch goal, not a requirement. |
| A lightweight frontend and backend | A React app and a small Node server ([architecture.md](architecture.md)) |

The email says the exercise evaluates technical creativity, product instincts, and the ability to execute a lightweight demo quickly. The rest of this brief (states, captions, recovery, persona, hands-free) is our own quality bar, not a requirement. Within the deadline, we prioritise it after the four requirements above work end to end.

## 2. Why this fits Synthio Labs

Synthio Labs builds clinical-grade voice AI for pharma teams. Its agents talk with doctors and patients about medical topics, and its public positioning stresses:

| Synthio value | How this prototype shows it |
|---|---|
| Science-first, not promotional | The deck teaches how GLP-1 drugs work, with balanced coverage of benefits and side effects. No brand promotion. |
| Accurate and compliant | Answers are grounded in the deck's facts. The agent says when something is outside its material, and it never gives personal medical advice. |
| Real-time, natural voice | Fast responses, true interruption, and a smooth return to the talk. |
| Clinical-grade reliability | Clear states, honest error messages, and a working fallback path. Nothing dead-ends. |

## 3. Users and context

**Primary user: a Synthio reviewer.** They are technical, short on time, and evaluating voice UX. They will explore in any order with no walkthrough. They may be on a laptop with speakers (so echo is a risk), may block the mic, or may just try to break it.

What this means for the design:
- The first screen must explain itself in 5 seconds: what this is, that interrupting is welcome, and what to ask.
- Every action must be reversible or retryable. No page reloads should be needed.
- The reviewer should never wonder whether the agent heard them.

**Role-play framing (light):** the reviewer can act like a curious clinician or patient. Example questions on screen set that tone.

## 4. Goals and non-goals

**Goals**
1. The agent presents a coherent 6-slide talk on its own, about 2–3 minutes end to end without interruption.
2. Interruption works at any point: audio stops fast and the agent answers the question. It is built in three phases (§9.1): tap-to-talk, then hands-free spoken interruption, then a toggle between them. Tap-to-talk meets the interrupt requirement (§1.1). Hands-free is the recommended stretch goal before the October 29 deadline, not a requirement.
3. The agent changes slides when a question is better served by another slide.
4. Four states are always visible and easy to tell apart: listening, thinking, speaking, and cannot connect.
5. Graceful recovery from mic denial, a missing or silent mic, and voice session failure or drop.
6. Zero-friction start: a clear first screen and a README quickstart in under 2 minutes.

**Non-goals**
- Accounts, saved sessions, analytics, or multiple users.
- Deck editing or uploading.
- Real regulatory compliance (HIPAA or MLR review). We show the *posture*, not the certification.
- A mobile-first layout. It should be usable on mobile, but it is designed for desktop.
- Several languages or a choice of voices.

## 5. The deck: "How GLP-1 medicines work"

There are six slides. Each slide has a **title**, **3–4 dense bullets**, a **scientific diagram**, a **spoken script** (about 20–30 seconds, in 4–6 short segments), and **8–15 facts** the agent may use to answer questions. The depth is that of a good continuing-medical-education talk: trial names, populations, doses, durations, comparators, and absolute as well as relative effects. Diagrams are hand-built, labelled and drawn to scale (physiology, receptor signalling, trial results, adverse-event rates, timelines), never decorative. Each slide also has a stable `id` so the agent can navigate by meaning, not by number.

| # | id | Title | Core content | Questions it should catch |
|---|---|---|---|---|
| 1 | `intro` | What is GLP-1? | A natural gut hormone released after eating. It signals fullness and helps control blood sugar. The body's own GLP-1 breaks down within minutes. | "What does GLP-1 stand for?" "Is it natural?" |
| 2 | `mechanism` | How the medicines work | They mimic GLP-1 and act on its receptor. They raise insulin only when glucose is high, lower glucagon, slow stomach emptying, and act on appetite centres in the brain. They are engineered to last days (for example, weekly dosing). | "Why do people eat less?" "How is it different from insulin?" |
| 3 | `uses` | What they're used for | Type 2 diabetes, chronic weight management, and lowering cardiovascular risk in some patients. Newer dual agonists (GIP/GLP-1, such as tirzepatide). | "Who are these for?" "Is Ozempic the same as Wegovy?" |
| 4 | `evidence` | What the evidence shows | Landmark trial results: mean weight loss in STEP-1 (semaglutide) and SURMOUNT-1 (tirzepatide) against placebo, and the cardiovascular outcome result in SELECT. | "How much weight do people lose?" "Does it help the heart?" |
| 5 | `safety` | Side effects and safety | GI effects are common, especially when the dose is being increased. Rare risks include pancreatitis and gallbladder problems. Thyroid C-cell tumour warning (MTC/MEN2). Some lean mass is lost along with fat. Weight often returns after stopping. | "What are the side effects?" "What happens if you stop?" |
| 6 | `future` | What's next | Oral forms, next-generation multi-agonists, open questions about long-term data, plus access and cost. Recap. | "Is there a pill?" "What's coming next?" |

**Content rules**
- Every number on a slide must be checked against a primary source (trial publication or FDA label) before shipping. Sources go in the slide data and appear in small print on the slide. Captions do not show sources.
- Approval and pipeline status is checked against FDA on the build date, and slides where status can change show "as of <date>".
- The author reads every number against its linked source before submission.
- Use generic drug names first. Brand names appear only to clarify ("semaglutide, sold as Ozempic and Wegovy").
- The footer on every slide reads: *"Educational demo — not medical advice."*

## 6. Agent persona and behaviour

**Persona:** "Ava", a calm, clear medical educator. She is warm but concise and sounds like a good conference speaker, not a sales rep.

**Speaking style**
- Short sentences and plain language. Medical terms are defined on first use.
- Answers to questions run **1–3 sentences** by default, with "Want more detail?" offered rather than given unasked.
- She never reads the bullets aloud word for word. The script adds to what's on the slide.

**Grounding and safety**
- She answers from the deck's facts first. For relevant general knowledge outside the deck, she may answer briefly and flag it as general background.
- **Personal medical questions** ("Should I take it?" "What dose for me?") get general information plus a clear "that's a decision for your clinician". She does not refuse curtly.
- **Off-topic questions** get one polite sentence, then a bridge back ("That's outside today's topic. Happy to keep going with side effects?").
- **Uncertainty:** she says "I don't know" or "the evidence isn't settled" instead of guessing.

**Slide navigation**
- If a question maps to another slide, she changes to it *as she starts answering*, so the visual lands with the words ("Good question — let me pull up the safety slide.").
- If the question fits the current slide, she stays.
- The reviewer can also ask directly ("go back", "show me the evidence slide", "skip to the end").

**Resuming after an interruption**
- After answering, she returns to the talk with a short bridge.
- If she changed slides to answer, she announces the return ("Back to where we were — how the medicines work.") and goes back to the slide she had been presenting, unless the reviewer asked to stay or move on.
- She picks up **from the start of the sentence she was cut off in**, not from the start of the slide script, with a short bridge ("As I was saying…").
- After the talk has finished, answers do not restart narration. She stays on the final slide (or returns to it) and keeps listening.

## 7. Experience flow

### 7.1 First screen (landing)
- The title, a one-line description, and the topic: "A 3-minute spoken talk on how GLP-1 medicines work."
- The hint: **"Interrupt anytime — hold Space to talk."** (Phase 2 hands-free changes it to "just start talking".)
- 3 example questions as chips (for example "What are the side effects?", "How much weight do people lose?", "Is there a pill version?").
- A primary action, **"Check microphone"**, plus a quieter secondary link, **"Continue without mic (type instead)"**.

### 7.2 Mic check (step 1)
1. The browser asks for mic permission. While it waits, the screen explains why the mic is needed.
2. Once allowed: a live level meter appears with the prompt "Say something…", plus a device picker if more than one mic exists.
3. When speech-level input is detected, a green check appears with "We can hear you", and the **Start presentation** button becomes enabled.
4. If no input arrives within about 6 seconds, the screen suggests checking the device or mute switch, offers the device picker, and offers "Try again" or "Continue by typing".
5. A one-line tip: "Using speakers? Headphones give the best interruption experience."

### 7.3 Start (step 2)
- One button: **Start presentation**. Permission was already granted, so the click goes straight to the *Connecting* state.
- Once connected, Ava greets the reviewer in one sentence, reminds them they can interrupt, and starts slide 1.

### 7.4 Presenting screen layout
- **Slide stage** (dominant): the current slide, with the slide number (`2 / 6`) and smooth transitions.
- **Agent status** (always visible, near the slide): the state indicator plus a text label (see §8).
- **Live captions**: what Ava is saying, and what the reviewer said once recognised. This confirms she heard them correctly.
- **Controls**: a talk control (the status orb: hold `Space`, or tap the orb to start and tap again to send), pause/resume, previous/next slide, a text input ("Type a question…") that is always available, and End. Mute mic arrives in phase 2, and the Hands-free / Tap to talk toggle in phase 3 (§9.1).
- **Typing pauses Ava.** As soon as the reviewer types in the question box, Ava pauses ("Paused while you type"). Sending the question interrupts and answers it. Clearing the box or leaving it empty resumes her.
- **Stay here.** When Ava jumps to another slide to answer, a "Stay here" button (and `S`, or saying "let's stay here") keeps the presentation on the new slide.
- **Example-question chips** stay available in a collapsed form. Clicking one sends it as a typed question.

### 7.5 End
- After slide 6: a short recap, then "Any final questions?" She stays ready to answer, and answers never restart the talk.
- **End** (button or `Shift+E`) at any time: Ava says one closing line, the voice session closes, and the microphone is released (the browser's mic indicator turns off).
- An end screen with "Restart" and a short summary of the questions asked (nice-to-have).

## 8. Agent states

One status component shows the agent's state using **shape or motion + colour + a text label**, never colour alone.

| State | When | Visual | Label |
|---|---|---|---|
| Connecting | Session starting or reconnecting | Neutral pulsing spinner | "Connecting…" |
| Speaking | Ava is talking | Animated waveform driven by output audio | "Speaking — hold Space to interrupt" |
| Ready to talk | Tap-to-talk mode, mic closed, waiting for a press | Static mic icon on the orb | "Hold Space or tap to talk" |
| Listening | Mic open, waiting for or hearing the reviewer (in tap-to-talk, while the talk control is held) | Ring that reacts to the reviewer's mic level | "Listening…" |
| Thinking | Turn ended, waiting for the first response audio | Slow shimmer or dots | "Thinking…" |
| Paused | Reviewer paused | Static icon | "Paused — press Resume or P" |
| Paused while typing | Reviewer is typing a question | Static icon | "Paused while you type" |
| Text mode | Mic unavailable, live voice still on | Keyboard icon on the status | "Type your question below" |
| Backup voice | Live voice service unreachable; browser speech reads the talk and typed questions are answered by the backend | Keyboard icon plus a "backup" tag | "Backup voice — type your question" + **Try live voice again** |
| Offline | No network at all; browser speech keeps narrating, questions are disabled | Muted icon | "You're offline — questions are paused" |
| Error | A specific failure needing action | Muted/red icon with an action button | Specific message + **Retry** |
| Finished | Talk complete, still taking questions | Static mic icon | "Any final questions? Hold Space" |

Rules:
- State changes must show **within 100 ms** of the event that causes them. A stale "Speaking" label after an interruption is a bug.
- *Thinking* that lasts more than about 4 s shows "Still working…". After about 10 s, show an error with Retry.
- Captions and status must agree. They never show contradictory states.

## 9. Interaction quality targets

"Typical" means p50 over at least 20 trials on a normal home broadband connection; p90 is also reported. All times are measured in the browser from what the reviewer does to what they hear (architecture §9).

| Moment | Target |
|---|---|
| Reviewer presses talk (tap-to-talk) → Ava's audio stops | ≤ 150 ms |
| Reviewer starts speaking (hands-free) → Ava's audio stops | ≤ 300 ms (aim for about 150 ms) |
| Reviewer releases talk / stops speaking → first answer audio | p50 ≤ 1.5 s, p90 ≤ 2.5 s (includes the 150 ms mic tail) |
| First audible answer word → slide transition finished | ≤ 200 ms |
| Silence between narration sentences | p50 ≤ 600 ms |
| Start click → first words of the greeting | ≤ 3 s |
| Typed question → first answer audio | p50 ≤ 1.5 s, p90 ≤ 2.5 s |

**Turn-taking**
- Coughs, "mm-hm" and short noises should not throw away a whole answer. Tune the turn detection, and if a false interruption produces no words, resume.
- Prevent echo, so Ava doesn't interrupt herself: use the browser's echo cancellation and noise suppression, and recommend headphones on the mic-check screen.
- Barge-in should **truncate** what she was saying, so the conversation history reflects only what was actually heard.

**Keyboard**

Every control has a shortcut or is reachable with `Tab`, and every control has a visible focus style. Shortcuts are ignored while typing in the question box, except `Esc` and `Enter`.

| Key | Action |
|---|---|
| Hold `Space` | Talk; release to send. A hold under 300 ms is treated as accidental. |
| `Esc` | While holding: cancel the turn. In the question box: clear it and resume. Otherwise: close a notice. |
| `P` | Pause / resume |
| `←` / `→` | Previous / next slide |
| `1`–`6` | Jump to a slide |
| `/` | Focus the question box (typing pauses Ava) |
| `Enter` | Send the typed question; on the landing screen, start |
| `S` | Stay on this slide after an answer jump |
| `R` | Retry, when an error with Retry is shown |
| `Shift+E` | End the presentation |
| `M` | Mute mic (phase 2+) |
| `?` | Show the shortcut list |

Holding `Space` is cancelled if the window loses focus. Key auto-repeat is ignored.

### 9.1 Turn modes and delivery order

Decided in [ADR 0003](decisions/0003-turn-taking-tap-to-talk-first.md).

| Phase | Mode | How the reviewer takes a turn | Notes |
|---|---|---|---|
| 1 | **Tap-to-talk** | Hold `Space`, or tap the orb to start and tap again to send. Pressing stops Ava immediately. | Built first, and the submittable baseline: it meets the interrupt requirement (§1.1). Clean, explicit turns. All other features (narration, slide changes, resume, text mode, recovery) are polished in this mode. A press under 300 ms counts as accidental. |
| 2 | **Hands-free** | Just start speaking | **Recommended stretch goal** before the October 29 deadline, not required. Once reliable, it becomes the default. Adds the echo and false-interruption handling above, mute mic, and the headphone tip. |
| 3 | **Hybrid** (stretch, after phase 2) | A Hands-free / Tap to talk switch. Tapping the orb always interrupts. | After 2 false interruptions in a row, suggest "Using speakers? Switch to tap-to-talk." |

## 10. Failure and recovery

The rule: **never a dead end, always a next action, plain language, no stack traces.**

| Failure | What the reviewer sees | Recovery |
|---|---|---|
| Mic permission denied | "Microphone access is blocked." Browser-specific steps to re-enable (address-bar lock icon). | **Retry** after re-enabling, or **Continue by typing** (text mode: spoken answers, slides still change). |
| No mic device found | "We couldn't find a microphone." | Device picker, Retry, or Continue by typing. |
| Mic connected but silent | Nothing on the level meter after about 6 s | Check mute/device, use the picker, Retry, or Continue by typing. |
| Voice session fails to connect | Status shows "Can't connect to the voice service." | Automatic retry ×2 with backoff, then **Retry** button + **Continue with backup voice**. |
| Session drops mid-talk | Status "Connection lost — reconnecting…", slide stays put | Automatic reconnect that **restores the previous state**: narration resumes on the same slide, a pause stays paused, an unanswered question offers "Ask again", and a finished talk stays finished. If reconnect fails, show Retry and **Continue with backup voice**. |
| Backend unreachable | Nothing changes while the live session is up (the backend isn't in the audio path). Only matters at reconnect. | If a reconnect also can't reach the backend: "Our server isn't responding." Retry, and narration continues with browser speech. |
| No network at all | "You're offline — questions are paused." | Browser speech (a local voice) keeps reading the talk. Recovers automatically when the network returns. |
| Mic unplugged or lost mid-talk | "Your microphone disconnected." | Switch to text mode automatically; device picker and **Try microphone again**. |
| Session reaches 60 minutes | Nothing visible | Silent reconnect at the next pause in speech. |
| No response (timeout) | "That took too long." | Retry the last question with one click. |
| Audio playback blocked (autoplay) | "Tap to enable sound" | One click resumes the audio. |
| Backend/API key misconfigured | Clear message on the landing screen before start ("Server isn't configured — see README") | Fix the config. The README covers this. |

**Text mode** (mic off, live voice on) is a full experience, not an error screen. Typed questions get spoken (and captioned) answers and slide navigation still works. A persistent **"Try microphone again"** action offers a way back to voice.

**Backup voice** (live voice service down) is different: the browser's speech reads the talk, typed questions go to the backend, and the label says "Backup voice" so the downgrade is honest. A persistent **"Try live voice again"** action offers a way back.

## 11. Accessibility basics
- Captions on by default, so everything said is on screen.
- The status is announced through an ARIA live region (polite), and errors are assertive.
- Full keyboard operation. Colour contrast meets WCAG AA.
- Respect `prefers-reduced-motion`: replace waveform and pulse animations with static indicators.

## 12. Success criteria: reviewer acceptance checks

Each of these must be demonstrable without guidance:

1. Open the app → understand what to do from the first screen alone.
2. Pass the mic check → Start → Ava presents slide 1 and moves through the talk on her own.
3. Interrupt mid-sentence (phase 1: hold `Space` or tap the orb; phase 2+: just speak) → audio stops within 150 ms → status shows Listening → answer → resume from the start of the interrupted sentence.
4. Ask "What are the side effects?" while on slide 2 → she changes to slide 5 as she answers → then announces a return to slide 2.
5. Say "Go to the evidence slide" → the slide changes.
6. Ask for personal dosing advice → helpful general answer plus a referral to a clinician.
7. Deny the mic → clear explanation → continue by typing → typed questions get spoken answers and slide changes.
8. a. Block the voice service mid-talk (e.g. block `api.openai.com` in DevTools) → "Connection lost — reconnecting…" → after retries, backup voice continues the talk and answers typed questions, with no page reload.
   b. Turn the network off mid-talk → "You're offline" → browser speech keeps narrating → turn it back on → live voice resumes on the same slide, with no page reload.
9. Each state (listening, thinking, speaking, error) can be told apart at a glance and is labelled in text.
10. Type in the question box while Ava speaks → she pauses at once → send → she answers → she resumes.
11. Ask a question after the recap → she answers and does not restart the talk.
12. Every control works from the keyboard alone (§9).

## 13. Resolved questions
- Voice stack: OpenAI Realtime over WebRTC ([ADR 0001](decisions/0001-realtime-voice-architecture.md)).
- Slide navigation: `goto_slide` tool with slide `id`s ([architecture.md](architecture.md) §6.3).
- Session tokens: short-lived client secrets minted by the backend ([architecture.md](architecture.md) §11).
- Hosting: local run only. The submission is a GitHub repo link or zip; the README quickstart is the reviewer's path.
