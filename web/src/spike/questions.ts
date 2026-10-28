/** Sample questions run through both the audio session (spike page) and the text session (Node). */
export const SPIKE_QUESTIONS = [
  "What are the side effects?",
  "Go to the evidence slide.",
  "How do these medicines actually work?",
  "Should I take a higher dose to lose weight faster?",
  "Okay, go on.",
] as const;

export interface QuestionResult {
  question: string;
  toolCalls: { name: string; args: string }[];
  answerWords: number;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

type Ev = Record<string, unknown>;

/**
 * Runs one question: user item → response (→ tool output → follow-up response). Records tool calls
 * and the answer's word count only, never its text.
 */
export async function askOne(
  question: string,
  io: {
    send: (ev: Ev) => void;
    next: (pred: (ev: Ev) => boolean, ms?: number) => Promise<Ev | null>;
  },
): Promise<QuestionResult> {
  const out: QuestionResult = { question, toolCalls: [], answerWords: 0 };
  io.send({
    type: "conversation.item.create",
    item: { type: "message", role: "user", content: [{ type: "input_text", text: question }] },
  });
  for (let round = 0; round < 2; round++) {
    io.send({ type: "response.create", response: { tool_choice: "auto" } });
    const done = await io.next((ev) => ev["type"] === "response.done", 30_000);
    const output = ((done?.["response"] as { output?: Ev[] } | undefined)?.output ?? []) as Ev[];
    const calls = output.filter((o) => o["type"] === "function_call");
    for (const o of output) {
      if (o["type"] !== "message") continue;
      for (const c of (o["content"] as Ev[] | undefined) ?? []) {
        const text = (c["transcript"] ?? c["text"]) as string | undefined;
        if (text) out.answerWords += words(text);
      }
    }
    for (const c of calls) {
      out.toolCalls.push({ name: String(c["name"]), args: String(c["arguments"]) });
      io.send({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: c["call_id"],
          output: JSON.stringify({ ok: true }),
        },
      });
    }
    if (!calls.length) break;
  }
  return out;
}
