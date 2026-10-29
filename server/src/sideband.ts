import WebSocket from "ws";
import { GotoSlideArgs, qualityFlags } from "@ava/shared";
import type { Logger } from "./logger.js";

/** The subset of `ws` the sideband uses, so tests pass a fake socket. */
export interface SidebandSocket {
  send(data: string): void;
  close(): void;
  on(event: "message", cb: (raw: unknown) => void): unknown;
  on(event: "close", cb: () => void): unknown;
  on(event: "error", cb: (err: unknown) => void): unknown;
}

export interface SidebandOptions {
  apiKey: string;
  callId: string;
  expiresAt: number | null;
  expectedInstructions: string;
  expectedTools: readonly string[];
  /** Sends the server's session config again (arch §3.3, point 2). */
  reapply: (send: (e: object) => void) => void;
  onFlag: (flag: string) => void;
  hangup: () => Promise<void>;
  onClose?: () => void;
  logger: Logger;
  now?: () => number;
  createSocket?: (url: string, headers: Record<string, string>) => SidebandSocket;
}

export type OpenSideband = (opts: SidebandOptions) => { close: () => void };

interface SidebandEvent {
  type?: string;
  session?: { instructions?: unknown; tools?: { name?: unknown }[] };
  transcript?: unknown;
  item?: { type?: unknown; name?: unknown; arguments?: unknown };
}

const toolsChanged = (session: SidebandEvent["session"], want: readonly string[]) => {
  if (!session?.tools) return false; // the update didn't touch tools
  const names = session.tools.map((t) => t.name);
  return names.length !== want.length || !want.every((n) => names.includes(n));
};

const validGotoArgs = (raw: unknown) => {
  try {
    return GotoSlideArgs.safeParse(JSON.parse(String(raw))).success;
  } catch {
    return false;
  }
};

/**
 * A server-side connection to one WebRTC call (arch §3.3): hangs up at `expiresAt`, re-applies the
 * session config if a client changes it, and counts quality flags (§5.8). Transcripts are read in
 * memory and dropped; only flag names leave this function, and nothing here logs event content.
 */
export const openSideband: OpenSideband = (opts) => {
  const now = opts.now ?? Date.now;
  const url = `wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(opts.callId)}`;
  const create =
    opts.createSocket ?? ((u, headers) => new WebSocket(u, { headers }) as SidebandSocket);
  const ws = create(url, { Authorization: `Bearer ${opts.apiKey}` });
  const send = (e: object) => ws.send(JSON.stringify(e));
  const timer =
    opts.expiresAt === null
      ? null
      : setTimeout(
          () =>
            void opts
              .hangup()
              .catch(() => opts.logger.warn("sideband_hangup_failed", { callId: opts.callId }))
              .finally(() => ws.close()),
          Math.max(0, opts.expiresAt - now()),
        );

  ws.on("message", (raw) => {
    let ev: SidebandEvent;
    try {
      ev = JSON.parse(String(raw)) as SidebandEvent;
    } catch {
      return;
    }
    if (ev.type === "session.updated") {
      const instructions = ev.session?.instructions;
      const instructionsChanged =
        instructions !== undefined && instructions !== opts.expectedInstructions;
      if (instructionsChanged || toolsChanged(ev.session, opts.expectedTools)) {
        opts.onFlag("config_reapplied");
        opts.reapply(send);
      }
    }
    if (ev.type === "response.output_audio_transcript.done" && typeof ev.transcript === "string") {
      for (const f of qualityFlags(ev.transcript)) opts.onFlag(f);
    }
    if (
      ev.type === "response.output_item.done" &&
      ev.item?.type === "function_call" &&
      ev.item.name === "goto_slide" &&
      !validGotoArgs(ev.item.arguments)
    ) {
      opts.onFlag("goto_slide_invalid");
    }
  });
  ws.on("close", () => {
    if (timer) clearTimeout(timer);
    opts.onClose?.();
  });
  ws.on("error", () => opts.logger.warn("sideband_error", { callId: opts.callId }));
  return { close: () => ws.close() };
};
