// Presenter preview clips (brief §6.1, arch §5.1). Calls the real OpenAI API and costs about a
// cent: run it only when the presenters or their greeting change.
//
//   npm run voices:samples       writes web/public/voices/{id}.mp3 for every presenter
//
// The key is read from process.env (the npm script loads .env through node's
// --env-file-if-exists) and is only ever sent in an Authorization header. Nothing here prints it.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { greetingLine, PERSONAS, type PersonaId } from "@ava/shared";

const SPEECH_URL = "https://api.openai.com/v1/audio/speech";
export const SAMPLE_MODEL = "gpt-4o-mini-tts";

export interface SampleRequest {
  persona: PersonaId;
  file: string;
  body: { model: string; voice: string; input: string; response_format: "mp3" };
}

/** One clip per presenter: their own greeting line, in their own Realtime voice. */
export function sampleRequests(): SampleRequest[] {
  return PERSONAS.map((p) => ({
    persona: p.id,
    file: `${p.id}.mp3`,
    body: {
      model: SAMPLE_MODEL,
      voice: p.voice,
      input: greetingLine({ persona: p.id }),
      response_format: "mp3",
    },
  }));
}

export interface SampleDeps {
  apiKey: string;
  outDir: string;
  fetch?: typeof fetch;
  write?: (path: string, data: Uint8Array) => void;
}

/** Fetches and writes every clip. Throws on the first failure, naming the presenter only. */
export async function writeSamples(deps: SampleDeps): Promise<string[]> {
  const doFetch = deps.fetch ?? fetch;
  const write = deps.write ?? ((path, data) => writeFileSync(path, data));
  const written: string[] = [];
  for (const r of sampleRequests()) {
    const res = await doFetch(SPEECH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${deps.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(r.body),
    });
    if (!res.ok) throw new Error(`speech request for ${r.persona} failed with ${res.status}`);
    const path = join(deps.outDir, r.file);
    write(path, new Uint8Array(await res.arrayBuffer()));
    written.push(path);
  }
  return written;
}

async function main() {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    console.error("OPENAI_API_KEY is not set. Put it in .env yourself; see .env.example.");
    process.exit(2);
  }
  const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "public", "voices");
  mkdirSync(outDir, { recursive: true });
  for (const path of await writeSamples({ apiKey, outDir })) console.log(`wrote ${path}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  });
}
