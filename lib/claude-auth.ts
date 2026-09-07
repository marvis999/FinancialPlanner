import "server-only";

import type { ChildProcessWithoutNullStreams } from "child_process";

import { spawnClaude } from "./claude-cli";
import type { ClaudeAuthStatus } from "./types";

/**
 * Sign the server's Claude CLI in from the app. `claude auth login` has no
 * headless mode; without a terminal it prints the sign-in link and then waits
 * on stdin for the code the page shows. So the flow is: start it, hand the
 * link to the browser, write the pasted code back, and read `auth status`
 * once it exits. A wrong code makes it prompt again, so the process is kept
 * for another paste.
 */

/** Parse `claude auth status --json`; null when the output is not that. */
export function parseAuthStatus(text: string): ClaudeAuthStatus | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      loggedIn?: unknown;
      email?: unknown;
    };
    return {
      loggedIn: parsed.loggedIn === true,
      email: typeof parsed.email === "string" ? parsed.email : null,
    };
  } catch {
    return null;
  }
}

/** The sign-in link in the CLI's "If the browser didn't open, visit: …" line. */
export function loginUrlFrom(output: string): string | null {
  return output.match(/https:\/\/\S+/)?.[0] ?? null;
}

const INVALID_CODE = /invalid code/i;

interface Login {
  child: ChildProcessWithoutNullStreams;
  output: string;
  exitCode: number | null | undefined;
  spawnError: string | null;
}

// ponytail: one login at a time for the whole server; the app is single-user.
let pending: Login | null = null;

function track(child: ChildProcessWithoutNullStreams): Login {
  const login: Login = { child, output: "", exitCode: undefined, spawnError: null };
  child.stdout.on("data", (chunk: Buffer) => (login.output += chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => (login.output += chunk.toString("utf8")));
  child.on("error", (err: NodeJS.ErrnoException) => {
    login.spawnError = err.code === "ENOENT" ? "cliNotFound" : err.message;
  });
  child.on("close", (code) => (login.exitCode = code));
  child.stdin.on("error", () => {
    // EPIPE when the process is already gone; `close` carries the outcome.
  });
  return login;
}

/** Resolve once `test` holds, the process has exited, or the time is up. */
function waitFor(
  login: Login,
  test: () => boolean,
  timeoutMs: number
): Promise<"matched" | "exited" | "timeout"> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const outcome = test()
        ? "matched"
        : login.exitCode !== undefined || login.spawnError
          ? "exited"
          : Date.now() - startedAt > timeoutMs
            ? "timeout"
            : null;
      if (outcome) {
        clearInterval(timer);
        resolve(outcome);
      }
    }, 150);
  });
}

function tail(login: Login): string {
  return login.output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim().slice(-300);
}

export async function claudeAuthStatus(): Promise<ClaudeAuthStatus | null> {
  const login = track(spawnClaude(["auth", "status", "--json"]));
  await waitFor(login, () => false, 20_000);
  return login.spawnError ? null : parseAuthStatus(login.output);
}

export async function startClaudeLogin(): Promise<
  { url: string } | { error: "cliNotFound" | "noUrl"; detail: string }
> {
  cancelClaudeLogin();
  const login = track(spawnClaude(["auth", "login"]));
  pending = login;
  const outcome = await waitFor(login, () => loginUrlFrom(login.output) !== null, 20_000);
  const url = loginUrlFrom(login.output);
  if (outcome === "matched" && url) return { url };
  cancelClaudeLogin();
  return login.spawnError === "cliNotFound"
    ? { error: "cliNotFound", detail: "" }
    : { error: "noUrl", detail: login.spawnError ?? tail(login) };
}

export async function finishClaudeLogin(
  code: string
): Promise<
  | { ok: true; status: ClaudeAuthStatus }
  | { ok: false; error: "noLogin" | "invalidCode" | "timeout" | "exited"; detail: string }
> {
  const login = pending;
  if (!login || login.exitCode !== undefined || login.spawnError) {
    return { ok: false, error: "noLogin", detail: "" };
  }
  const before = login.output.length;
  login.child.stdin.write(`${code.trim()}\n`, "utf8");
  const outcome = await waitFor(
    login,
    () => INVALID_CODE.test(login.output.slice(before)),
    90_000
  );
  // The CLI prompts again after a bad code, so the process stays for a retry.
  if (outcome === "matched") return { ok: false, error: "invalidCode", detail: "" };
  if (outcome === "timeout") {
    cancelClaudeLogin();
    return { ok: false, error: "timeout", detail: "" };
  }
  pending = null;
  const status = await claudeAuthStatus();
  return status?.loggedIn
    ? { ok: true, status }
    : { ok: false, error: "exited", detail: tail(login) };
}

export function cancelClaudeLogin(): void {
  // ponytail: kill() reaches the cmd.exe wrapper on Windows; use taskkill /T
  // if orphaned CLI processes ever matter.
  pending?.child.kill();
  pending = null;
}
