import { describe, expect, it } from "vitest";

import {
  hostnameOf,
  isAllowedHost,
  parseAllowedHosts,
} from "@/lib/allowed-host";

describe("hostnameOf", () => {
  it("drops the port", () => {
    expect(hostnameOf("localhost:3210")).toBe("localhost");
    expect(hostnameOf("evil.example:3210")).toBe("evil.example");
  });

  it("keeps a bare name intact", () => {
    expect(hostnameOf("localhost")).toBe("localhost");
  });

  it("keeps the brackets of an IPv6 literal", () => {
    expect(hostnameOf("[::1]:3210")).toBe("[::1]");
    expect(hostnameOf("[::1]")).toBe("[::1]");
  });

  it("lowercases and trims", () => {
    expect(hostnameOf("  LocalHost:3210 ")).toBe("localhost");
  });
});

describe("parseAllowedHosts", () => {
  it("is empty when unset or blank", () => {
    expect(parseAllowedHosts(undefined)).toEqual([]);
    expect(parseAllowedHosts("")).toEqual([]);
    expect(parseAllowedHosts(" , ,")).toEqual([]);
  });

  it("splits, trims and lowercases", () => {
    expect(parseAllowedHosts("Planner.Example, box.lan:8080 ")).toEqual([
      "planner.example",
      "box.lan:8080",
    ]);
  });
});

describe("isAllowedHost", () => {
  it("allows loopback names on any port", () => {
    for (const host of [
      "localhost",
      "localhost:3210",
      "127.0.0.1:3210",
      "127.0.0.1",
      // The whole /8, not just .0.1.
      "127.13.7.2:3210",
      "[::1]:3210",
    ]) {
      expect(isAllowedHost(host), host).toBe(true);
    }
  });

  /*
   * The attack this exists for: the browser has been made to resolve
   * evil.example to 127.0.0.1, so Origin and Host agree and Next's Server
   * Action guard sees a same-origin request. Only the Host header still
   * carries the attacker's name.
   */
  it("refuses a rebound attacker domain", () => {
    expect(isAllowedHost("evil.example:3210")).toBe(false);
    expect(isAllowedHost("evil.example")).toBe(false);
  });

  it("is not fooled by a loopback name inside another domain", () => {
    for (const host of [
      "localhost.evil.example:3210",
      "evil.example:3210localhost",
      "127.0.0.1.evil.example",
      "notlocalhost",
      "xn--localhost-hg9c",
    ]) {
      expect(isAllowedHost(host), host).toBe(false);
    }
  });

  it("refuses a missing or empty Host", () => {
    expect(isAllowedHost(null)).toBe(false);
    expect(isAllowedHost(undefined)).toBe(false);
    expect(isAllowedHost("")).toBe(false);
    expect(isAllowedHost("   ")).toBe(false);
  });

  it("allows a configured host with or without its port", () => {
    const allowed = parseAllowedHosts("planner.example");
    expect(isAllowedHost("planner.example", allowed)).toBe(true);
    expect(isAllowedHost("planner.example:8443", allowed)).toBe(true);
    expect(isAllowedHost("other.example", allowed)).toBe(false);
  });

  it("honours a configured host:port pair strictly", () => {
    const allowed = parseAllowedHosts("box.lan:8080");
    expect(isAllowedHost("box.lan:8080", allowed)).toBe(true);
    // Naming a port narrows the entry; another port is not covered by it.
    expect(isAllowedHost("box.lan:9999", allowed)).toBe(false);
    expect(isAllowedHost("box.lan", allowed)).toBe(false);
  });

  /* RFC 7230 brackets IPv6 in Host, so a bare ::1 is malformed, not loopback. */
  it("refuses a malformed unbracketed IPv6 host", () => {
    expect(isAllowedHost("::1")).toBe(false);
    expect(isAllowedHost("::1:3210")).toBe(false);
  });

  it("matches a configured host case-insensitively", () => {
    const allowed = parseAllowedHosts("Planner.Example");
    expect(isAllowedHost("PLANNER.EXAMPLE:3210", allowed)).toBe(true);
  });
});
