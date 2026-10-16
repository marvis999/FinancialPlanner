import "server-only";

import { readPreference, writePreference } from "./data-dir";
import { createMasker, parseHiddenNames, type Masker } from "./pii-mask";
import type { ClaudePrivacy } from "./types";

/**
 * Whether the app may send anything to Claude, and which names it hides.
 *
 * Off until the user turns it on: a signed-in CLI on the machine is not
 * consent to send bank bookings to a third party. Stored as files next to the
 * databases, like the language, so the choice holds for real and demo data
 * alike and survives a database reset. Read on every call, never memoised.
 */
const ENABLED_FILE = "claude-enabled";
const NAMES_FILE = "claude-hidden-names";

export function claudeEnabled(): boolean {
  return readPreference(ENABLED_FILE) === "on";
}

export function hiddenNames(): string[] {
  return parseHiddenNames(readPreference(NAMES_FILE) ?? "");
}

export function claudePrivacy(): ClaudePrivacy {
  return { enabled: claudeEnabled(), hiddenNames: hiddenNames() };
}

export function setClaudeEnabled(enabled: boolean): void {
  writePreference(ENABLED_FILE, enabled ? "on" : "off");
}

export function setHiddenNames(names: string[]): void {
  writePreference(NAMES_FILE, names.join("\n"));
}

/** A fresh masker for one Claude run, with the user's current name list. */
export function newMasker(): Masker {
  return createMasker(hiddenNames());
}
