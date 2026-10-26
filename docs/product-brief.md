# Product Brief: Voice Presentation Agent

> Take-home prototype for Synthio Labs. This file holds the product decisions: what we build, for whom, and how it should feel.
> Stack and system design go in [architecture.md](architecture.md). Build order goes in [implementation-plan.md](implementation-plan.md).

## 1. Summary

A web app where an AI presenter gives a short, spoken, six-slide talk on **how GLP-1 medicines work**. The reviewer can cut in at any time by speaking. The agent stops at once, answers the question, changes to the relevant slide if one fits, and then picks the talk back up. The interface always shows what the agent is doing. When the mic or the voice connection fails, the demo keeps working: typed questions still get spoken answers.

**The priority is the quality of the interaction.** A small, polished feature set beats a large, rough one.

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
2. Spoken interruption works at any point: audio stops fast and the agent answers the question.
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

There are six slides. Each slide has a **title**, **2–4 visual bullets or a simple diagram**, a **spoken script** (about 20–30 seconds), and **facts** the agent may use to answer questions. Each slide also has a stable `id` so the agent can navigate by meaning, not by number.

| # | id | Title | Core content | Questions it should catch |
|---|---|---|---|---|
| 1 | `intro` | What is GLP-1? | A natural gut hormone released after eating. It signals fullness and helps control blood sugar. The body's own GLP-1 breaks down within minutes. | "What does GLP-1 stand for?" "Is it natural?" |
| 2 | `mechanism` | How the medicines work | They mimic GLP-1 and act on its receptor. They raise insulin only when glucose is high, lower glucagon, slow stomach emptying, and act on appetite centres in the brain. They are engineered to last days (for example, weekly dosing). | "Why do people eat less?" "How is it different from insulin?" |
| 3 | `uses` | What they're used for | Type 2 diabetes, chronic weight management, and lowering cardiovascular risk in some patients. Newer dual agonists (GIP/GLP-1, such as tirzepatide). | "Who are these for?" "Is Ozempic the same as Wegovy?" |
| 4 | `evidence` | What the evidence shows | Landmark trial results: mean weight loss in STEP-1 (semaglutide) and SURMOUNT-1 (tirzepatide) against placebo, and the cardiovascular outcome result in SELECT. | "How much weight do people lose?" "Does it help the heart?" |
| 5 | `safety` | Side effects and safety | GI effects are common, especially when the dose is being increased. Rare risks include pancreatitis and gallbladder problems. Thyroid C-cell tumour warning (MTC/MEN2). Some muscle is lost along with fat. Weight often returns after stopping. | "What are the side effects?" "What happens if you stop?" |
| 6 | `future` | What's next | Oral forms, next-generation multi-agonists, open questions about long-term data, plus access and cost. Recap. | "Is there a pill?" "What's coming next?" |

**Content rules**
- Every number on a slide must be checked against a primary source (trial publication or FDA label) before shipping. Sources go in the slide data and appear in small print on the slide.
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
- She picks up **from the point she was cut off**, not from the start of the slide script.

## 7. Experience flow

### 7.1 First screen (landing)
- The title, a one-line description, and the topic: "A 3-minute spoken talk on how GLP-1 medicines work."
- The hint: **"Interrupt anytime — just start talking."**
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
- **Controls**: pause/resume, previous/next slide, mute mic, a text input ("Type a question…") that is always available, and End.
- **Example-question chips** stay available in a collapsed form. Clicking one sends it as a typed question.

### 7.5 End
- After slide 6: a short recap, then "Any final questions?" She stays in listening mode.
- An end screen with "Restart" and a short summary of the questions asked (nice-to-have).

## 8. Agent states

One status component shows the agent's state using **shape or motion + colour + a text label**, never colour alone.

| State | When | Visual | Label |
|---|---|---|---|
| Connecting | Session starting or reconnecting | Neutral pulsing spinner | "Connecting…" |
| Speaking | Ava is talking | Animated waveform driven by output audio | "Speaking — interrupt anytime" |
| Listening | Mic open, waiting for or hearing the reviewer | Ring that reacts to the reviewer's mic level | "Listening…" |
| Thinking | Turn ended, waiting for the first response audio | Slow shimmer or dots | "Thinking…" |
| Paused | Reviewer paused | Static icon | "Paused — press Resume or Space" |
| Text mode | Mic unavailable, voice output still on | Keyboard icon on the status | "Type your question below" |
| Offline / error | Can't connect or the session dropped | Muted/red icon with an action button | Specific message + **Retry** |

Rules:
- State changes must show **within 100 ms** of the event that causes them. A stale "Speaking" label after an interruption is a bug.
- *Thinking* that lasts more than about 4 s shows "Still working…". After about 10 s, show an error with Retry.
- Captions and status must agree. They never show contradictory states.

## 9. Interaction quality targets

| Moment | Target |
|---|---|
| Reviewer starts speaking → Ava's audio stops | ≤ 300 ms (aim for about 150 ms) |
| Reviewer stops speaking → first answer audio | ≤ 1.5 s typical |
| Navigation decided → slide visible | Before or with the first words about it |
| Start click → first words of the greeting | ≤ 3 s |
| Typed question → first answer audio | ≤ 1.5 s typical |

**Turn-taking**
- Coughs, "mm-hm" and short noises should not throw away a whole answer. Tune the turn detection, and if a false interruption produces no words, resume.
- Prevent echo, so Ava doesn't interrupt herself: use the browser's echo cancellation and noise suppression, and recommend headphones on the mic-check screen.
- Barge-in should **truncate** what she was saying, so the conversation history reflects only what was actually heard.

**Keyboard**
- `Space` pauses/resumes (when not typing), `←`/`→` change slides, and `M` mutes the mic. Every control has a visible focus style.

## 10. Failure and recovery

The rule: **never a dead end, always a next action, plain language, no stack traces.**

| Failure | What the reviewer sees | Recovery |
|---|---|---|
| Mic permission denied | "Microphone access is blocked." Browser-specific steps to re-enable (address-bar lock icon). | **Retry** after re-enabling, or **Continue by typing** (text mode: spoken answers, slides still change). |
| No mic device found | "We couldn't find a microphone." | Device picker, Retry, or Continue by typing. |
| Mic connected but silent | Nothing on the level meter after about 6 s | Check mute/device, use the picker, Retry, or Continue by typing. |
| Voice session fails to connect | Status shows "Can't connect to the voice service." | Automatic retry ×2 with backoff, then **Retry** button + **Continue in text mode**. |
| Session drops mid-talk | Status "Connection lost — reconnecting…", slide stays put | Automatic reconnect that **resumes on the same slide** without restarting the talk. If that fails, show Retry and text mode. |
| No response (timeout) | "That took too long." | Retry the last question with one click. |
| Audio playback blocked (autoplay) | "Tap to enable sound" | One click resumes the audio. |
| Backend/API key misconfigured | Clear message on the landing screen before start ("Server isn't configured — see README") | Fix the config. The README covers this. |

**Text mode** is a full experience, not an error screen. Typed questions get spoken (and captioned) answers and slide navigation still works. A persistent **"Try microphone again"** action offers a way back to voice.

## 11. Accessibility basics
- Captions on by default, so everything said is on screen.
- The status is announced through an ARIA live region (polite), and errors are assertive.
- Full keyboard operation. Colour contrast meets WCAG AA.
- Respect `prefers-reduced-motion`: replace waveform and pulse animations with static indicators.

## 12. Success criteria: reviewer acceptance checks

Each of these must be demonstrable without guidance:

1. Open the app → understand what to do from the first screen alone.
2. Pass the mic check → Start → Ava presents slide 1 and moves through the talk on her own.
3. Interrupt mid-sentence → audio stops right away → status shows Listening → answer → resume from where she was cut off.
4. Ask "What are the side effects?" while on slide 2 → she changes to slide 5 as she answers → then announces a return to slide 2.
5. Say "Go to the evidence slide" → the slide changes.
6. Ask for personal dosing advice → helpful general answer plus a referral to a clinician.
7. Deny the mic → clear explanation → continue by typing → typed questions get spoken answers and slide changes.
8. Kill the network or the backend mid-talk → clear "connection lost" → recovery without a page reload.
9. Each state (listening, thinking, speaking, error) can be told apart at a glance and is labelled in text.

## 13. Open questions (for architecture.md)
- The voice stack: a single realtime speech-to-speech API with tool calling versus a separate STT → LLM → TTS pipeline. The choice is judged against the barge-in and latency targets in §9.
- How slide navigation is exposed to the model (a tool or function call with slide `id`s is the likely choice).
- How the backend issues short-lived session tokens so API keys never reach the browser.
- Hosting: a local run only, or also a deployed URL for reviewers.
