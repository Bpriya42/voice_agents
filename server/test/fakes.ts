import type { OpenAIClient } from "../src/openai.js";
import { OpenAIError } from "../src/openai.js";

/** Obviously fake values that match the `ek_test_` allow-list in .secretlintrc.json. */
export const FAKE_CLIENT_SECRET = "ek_test_value_not_a_real_key";
export const FAKE_API_KEY = "test-openai-key-not-real";

export type FakeOpenAI = OpenAIClient & { calls: string[]; lastChat?: unknown };

export function fakeOpenAI(overrides: Partial<OpenAIClient> = {}): FakeOpenAI {
  const calls: string[] = [];
  const fake: FakeOpenAI = {
    calls,
    async checkModel() {
      calls.push("checkModel");
      return "ok";
    },
    async createClientSecret() {
      calls.push("createClientSecret");
      return { value: FAKE_CLIENT_SECRET, expiresAt: 0 };
    },
    async chatJson(req) {
      calls.push("chatJson");
      fake.lastChat = req;
      return { answer: "GLP-1 is a gut hormone." };
    },
    async hangup() {
      calls.push("hangup");
    },
    ...overrides,
  };
  return fake;
}

export const failingWith = (status: number, code?: string) => async () => {
  throw new OpenAIError(status, code);
};
