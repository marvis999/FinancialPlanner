import "server-only";

import { spawn, type ChildProcessWithoutNullStreams } from "child_process";

import { claudeEnabled } from "./claude-privacy";

/**
 * Headless bridge to the locally installed Claude Code CLI (`claude -p`).
 * Uses the user's existing Claude login — no API key handling in the app.
 * The prompt travels via stdin (no shell-quoting, no length limits).
 *
 * Runs with `--output-format stream-json` so callers get live progress
 * (session start, generated characters) while the model works.
 */

export const CLAUDE_MODEL = "claude-sonnet-5";

/**
 * Why a run failed, as a code rather than a sentence. next-intl's translator
 * only exists inside a request, and this module is spawned from a background
 * job — so it reports what went wrong and leaves the wording to the action
 * that holds `getTranslations`.
 */
export type ClaudeError =
  /** The user has not turned Claude on in Settings; nothing was sent. */
  | { code: "disabled" }
  | { code: "timeout"; seconds: number }
  | { code: "cliNotFound" }
  | { code: "cliStartFailed"; detail: string }
  /** No result envelope on stdout; `detail` is stderr, empty when it was silent. */
  | { code: "unexpectedResponse"; detail: string }
  /** `detail` is the CLI's own wording of what went wrong, when it gave one. */
  | { code: "cliReportedError"; subtype: string | null; detail: string };

/**
 * Split on `ok` so a failure always carries a reason and a success always
 * carries an answer — neither is an optional field the caller has to guess a
 * fallback for.
 */
export type ClaudeRunResult =
  | {
      ok: true;
      /** The assistant's answer text. */
      text: string;
    }
  | { ok: false; error: ClaudeError };

export interface ClaudeProgress {
  phase: "start" | "thinking" | "writing";
  /** Characters generated so far in this phase. */
  chars: number;
}

export interface StreamLine {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: unknown;
  event?: {
    type?: string;
    delta?: { type?: string; text?: string; thinking?: string };
  };
}

/**
 * Variables a running Claude Code session hands to its children. The app
 * server inherits them when it is started from a terminal inside Claude Code
 * or the desktop app, and a `claude -p` spawned with them attaches to that
 * session instead of running on its own. The CLI strips the same set before
 * spawning its own subprocesses.
 */
const SESSION_MARKERS =
  /^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_(SESSION_ID|CHILD_SESSION|HOST_SESSION_ID|BRIDGE_SESSION_ID|ENTRYPOINT|EXECPATH|MESSAGING_SOCKET|MESSAGING_TOKEN))$/;

export function childEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  // Next types NODE_ENV as required on ProcessEnv; the filter never drops it.
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !SESSION_MARKERS.test(name))
  ) as NodeJS.ProcessEnv;
}

/**
 * Turn the result envelope into the run's outcome. On an error the CLI puts
 * its own wording into `result` (an API error, for instance) while
 * `subtype` may still say "success", so the text is what the user needs to
 * see. A success without a `result` string has been observed too; the
 * answer streamed past in the deltas, so that text is used before giving up.
 */
export function interpretResult(
  envelope: StreamLine,
  streamedText: string
): ClaudeRunResult {
  const text = typeof envelope.result === "string" ? envelope.result : null;
  if (envelope.is_error) {
    return {
      ok: false,
      error: {
        code: "cliReportedError",
        subtype: envelope.subtype ?? null,
        detail: (text ?? "").trim().slice(0, 300),
      },
    };
  }
  if (text !== null) return { ok: true, text };
  if (streamedText) return { ok: true, text: streamedText };
  return {
    ok: false,
    error: {
      code: "unexpectedResponse",
      detail: `result envelope without text (subtype ${envelope.subtype ?? "none"})`,
    },
  };
}

/** Start the CLI with fixed literal arguments; anything variable goes via stdin. */
export function spawnClaude(args: string[]): ChildProcessWithoutNullStreams {
  return process.platform === "win32"
    ? // Windows resolves the `claude` shim only through a shell; a single
      // command string avoids DEP0190 (shell + args array). Every argument is
      // quoted because a bare join drops `--tools ""` entirely: an empty
      // string contributes nothing between two spaces, and the flag would
      // silently lose its value.
      spawn(["claude", ...args].map((arg) => `"${arg}"`).join(" "), {
        shell: true,
        windowsHide: true,
        env: childEnv(process.env),
      })
    : spawn("claude", args, { env: childEnv(process.env) });
}

export function runClaude(
  prompt: string,
  opts: { timeoutMs?: number; onProgress?: (p: ClaudeProgress) => void } = {}
): Promise<ClaudeRunResult> {
  // The last line of defence: every prompt passes here, so no caller can send
  // data while the switch in Settings is off.
  if (!claudeEnabled()) {
    return Promise.resolve({ ok: false, error: { code: "disabled" } });
  }
  const timeoutMs = opts.timeoutMs ?? 300_000;
  return new Promise((resolve) => {
    let settled = false;
    const done = (result: ClaudeRunResult) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(result);
      }
    };

    // Fixed literals only — the prompt travels via stdin, never the command line.
    const args = [
      "-p",
      "--model", CLAUDE_MODEL,
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--max-turns", "3",
      "--tools", "",
      "--strict-mcp-config",
    ];
    const child = spawnClaude(args);

    const timer = setTimeout(() => {
      child.kill();
      done({
        ok: false,
        error: { code: "timeout", seconds: Math.round(timeoutMs / 1000) },
      });
    }, timeoutMs);

    let buffer = "";
    let stderr = "";
    let envelope: StreamLine | null = null;
    let streamedText = "";
    let thinkingChars = 0;
    let reportedChars = -1;
    let announcedStart = false;

    let lastPhase: "thinking" | "writing" | null = null;
    const report = (phase: "thinking" | "writing", chars: number) => {
      // Report immediately on a phase change, then every ~200 characters.
      if (phase !== lastPhase) {
        lastPhase = phase;
        reportedChars = -Infinity;
      }
      if (chars - reportedChars >= 200) {
        reportedChars = chars;
        opts.onProgress?.({ phase, chars });
      }
    };

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let parsed: StreamLine;
      try {
        parsed = JSON.parse(line) as StreamLine;
      } catch {
        return; // ignore non-JSON noise
      }
      if (parsed.type === "system" && !announcedStart) {
        announcedStart = true;
        opts.onProgress?.({ phase: "start", chars: 0 });
      } else if (
        parsed.type === "stream_event" &&
        parsed.event?.type === "content_block_delta"
      ) {
        const delta = parsed.event.delta;
        if (delta?.type === "text_delta") {
          streamedText += delta.text ?? "";
          report("writing", streamedText.length);
        } else if (delta?.type === "thinking_delta") {
          thinkingChars += delta.thinking?.length ?? 0;
          // Answer text takes over the progress line once it starts flowing.
          if (!streamedText) report("thinking", thinkingChars);
        }
      } else if (parsed.type === "result") {
        envelope = parsed;
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        handleLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));

    child.on("error", (err: NodeJS.ErrnoException) => {
      done({
        ok: false,
        error:
          err.code === "ENOENT"
            ? { code: "cliNotFound" }
            : { code: "cliStartFailed", detail: err.message },
      });
    });

    child.on("close", () => {
      handleLine(buffer); // flush a possible last line without newline
      // The CLI's exit code is not reliable across shells; trust the JSON
      // stream on stdout instead.
      if (!envelope) {
        done({
          ok: false,
          error: {
            code: "unexpectedResponse",
            detail: stderr.trim().slice(0, 300),
          },
        });
        return;
      }
      const env: StreamLine = envelope;
      done(interpretResult(env, streamedText));
    });

    child.stdin.on("error", () => {
      // Swallow EPIPE when the process dies early; `close` reports the error.
    });
    child.stdin.write(prompt, "utf8");
    child.stdin.end();
  });
}

/** Extract the first JSON array from a model answer (tolerates code fences). */
export function extractJsonArray(text: string): unknown[] | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
