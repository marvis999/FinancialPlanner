import { describe, expect, it } from "vitest";

import { loginUrlFrom, parseAuthStatus } from "@/lib/claude-auth";

describe("parseAuthStatus", () => {
  it("reads the signed-in account", () => {
    expect(
      parseAuthStatus('{"loggedIn":true,"authMethod":"claude.ai","email":"me@example.org"}')
    ).toEqual({ loggedIn: true, email: "me@example.org" });
  });

  it("reads a signed-out CLI and tolerates noise around the JSON", () => {
    expect(parseAuthStatus('update available\n{"loggedIn":false,"authMethod":"none"}\n')).toEqual({
      loggedIn: false,
      email: null,
    });
  });

  it("is null for anything else", () => {
    expect(parseAuthStatus("command not found")).toBeNull();
  });
});

describe("loginUrlFrom", () => {
  it("picks the sign-in link out of the CLI's prompt", () => {
    const output =
      "Opening browser to sign in…\nIf the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&state=x\nPaste code here if prompted >";
    expect(loginUrlFrom(output)).toBe("https://claude.com/cai/oauth/authorize?code=true&state=x");
  });

  it("is null before the link has been printed", () => {
    expect(loginUrlFrom("Opening browser to sign in…\n")).toBeNull();
  });
});
