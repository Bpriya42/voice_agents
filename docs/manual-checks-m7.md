# M7 manual checks with the real API

Brief §12 checks 2–5, 9–12 and 17, run by a person on **headphones** in desktop Chrome against the real OpenAI Realtime API (M7 "done when"). Each run costs a little money.

## Setup

1. Your key is in `.env` (`OPENAI_API_KEY`). Never paste it into a chat.
2. `npm run dev`, then open <http://localhost:5173/api/health>. It should say `configured: true, keyValid: true`.
3. Open <http://localhost:5173> (no `?fake=1`). Add `?debug=1` if you want the event log in the console.
4. Leave the presenter on **Ava** (the default) for checks 2–12, or note which presenter you used. Check 17 covers choosing another.
5. Fill in the result column: ✅ pass, ❌ fail (with a note), or ⏭ skipped.

Run on: date ______ · Chrome version ______ · model ______ · presenter ______

## Checks

| # | Steps | Expected | Result | Notes |
|---|---|---|---|---|
| 2 | Check microphone → wait for "We can hear you" → **Start presentation**. Don't touch anything for ~1 minute. | Greeting, then slide 1 sentence by sentence. Moves to slide 2 by itself. Captions follow the speech. | | |
| 3a | While the presenter speaks, **hold Space**. | Audio stops at once (feels instant, under 150 ms). Status reads **Listening…**. | | |
| 3b | Still holding, ask "What does GLP-1 stand for?", then release. | **Thinking** → spoken answer from the deck → resumes from the **start of the interrupted sentence**. | | |
| 3c | Tap the **orb** while the presenter speaks, ask a question, tap the orb again. | Same as 3a/3b, via the orb. | | |
| 3d | Press Space briefly (under ~300 ms) while the presenter speaks, without asking anything. | The interrupted sentence restarts. No answer. | | |
| 4 | Wait until slide 2 (or press →). Hold Space, ask "What are the side effects?", release. | Changes to slide 5 (**Side effects and safety**) while answering. Then announces a return and goes back to slide 2. | | |
| 5 | Hold Space, say "Go to the evidence slide", release. | The slide changes to the evidence slide. | | |
| 9 | Watch the orb and status line through listening, thinking, speaking and an error (for an error: turn Wi-Fi off briefly, or stop the server). | Each state looks different at a glance and has a text label. | | |
| 10 | While the presenter speaks, click the question box and type a letter. Then type a full question and press Enter. | The presenter pauses **at once** on the first keystroke (status "Paused while you type"). After Enter they answer, then resume. | | |
| 10b | Type a letter, then clear the box (or press Esc). | The talk resumes as before. | | |
| 11 | Let the talk finish (recap on the last slide). Then ask a question by voice or typing. | The presenter answers, and does **not** restart the talk. | | |
| 12 | Unplug or ignore the mouse. Use only the keyboard: Tab through every control, then try hold Space (talk), Esc while holding (cancel), P (pause/resume), ← / → and 1–6 (slides), / (question box), Enter (send), S (stay here after a jump), R (retry, when an error shows), ? (shortcut list), Shift+E (end). | Every control works and shows a visible focus ring. Shortcuts are ignored while typing in the box, except Esc and Enter (brief §9). | | |
| 17 | Reload. On the landing page tap the **Theo** card, then the **Mira** card. Pick one, Check microphone → Start. Then press Shift+E → Restart. | Each tap plays that presenter's sample and changes the headline. The splash, greeting ("Hi, I'm …"), voice and caption labels all match the chosen presenter. After Restart the same presenter is still selected. | | |

## If something fails

Note what you did, what you heard or saw, and the time. With `?debug=1`, copy the console lines around that time. They hold event types and ids only, no audio or transcripts. Then open an issue with those notes.
