import { describe, expect, it } from "vitest";

import { childEnv, interpretResult } from "@/lib/claude-cli";

describe("childEnv", () => {
  it("drops the markers of the session the server was started from", () => {
    const env = childEnv({
      PATH: "/usr/bin",
      CLAUDE_CONFIG_DIR: "/home/node/.claude",
      CLAUDE_CODE_OAUTH_TOKEN: "t",
      CLAUDECODE: "1",
      CLAUDE_PID: "123",
      CLAUDE_CODE_SESSION_ID: "abc",
      CLAUDE_CODE_CHILD_SESSION: "1",
      CLAUDE_CODE_ENTRYPOINT: "claude-desktop",
      CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/x.sock",
      CLAUDE_CODE_MESSAGING_TOKEN: "s",
    });
    expect(Object.keys(env).sort()).toEqual([
      "CLAUDE_CODE_OAUTH_TOKEN",
      "CLAUDE_CONFIG_DIR",
      "PATH",
    ]);
  });
});

describe("interpretResult", () => {
  it("returns the answer of a plain success", () => {
    expect(interpretResult({ subtype: "success", is_error: false, result: "[]" }, "")).toEqual({
      ok: true,
      text: "[]",
    });
  });

  it("keeps the CLI's own error text even when the subtype says success", () => {
    expect(
      interpretResult(
        { subtype: "success", is_error: true, result: "API Error: 404 model not found" },
        ""
      )
    ).toEqual({
      ok: false,
      error: { code: "cliReportedError", subtype: "success", detail: "API Error: 404 model not found" },
    });
  });

  it("falls back to the streamed text when a success carries no result", () => {
    expect(interpretResult({ subtype: "success", is_error: false }, "[]")).toEqual({
      ok: true,
      text: "[]",
    });
  });

  it("reports an envelope with neither text nor error as unexpected", () => {
    expect(interpretResult({ subtype: "success" }, "")).toMatchObject({
      ok: false,
      error: { code: "unexpectedResponse" },
    });
  });
});
