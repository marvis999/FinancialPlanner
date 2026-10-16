import { ALL_CATEGORIES } from "./categories";
import type { Kind } from "./types";

/**
 * Normalisers for what the client sends to an action. Shared by the server
 * actions and the static demo's in-memory actions, so both accept and reject
 * exactly the same input.
 */

export function toKind(value: unknown): Kind {
  return value === "income" ? "income" : "expense";
}

export function toAmount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  // store a positive magnitude; sign is derived from `kind`
  return Math.abs(Math.round(parsed * 100) / 100);
}

/** Like toAmount but keeps the sign: an account balance can be negative. */
export function toSignedAmount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

export function toInterval(value: unknown): number {
  const parsed = Math.round(Number(value));
  return [1, 3, 6, 12].includes(parsed) ? parsed : 1;
}

export function toRemaining(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.abs(Math.round(parsed * 100) / 100);
}

/** Budget category of a recurring item; null = covered by no budget. */
export function toRecurringCategory(value: unknown): string | null {
  return typeof value === "string" && ALL_CATEGORIES.some((category) => category.key === value)
    ? value
    : null;
}

export function toEndDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : null;
}

export function toCategory(value: unknown): string | null {
  return typeof value === "string" &&
    ALL_CATEGORIES.some((category) => category.key === value)
    ? value
    : null;
}

export function toIds(ids: number[]): number[] {
  return ids.filter((parsed) => Number.isInteger(parsed)).slice(0, 5000);
}

/** Trimmed, single-spaced, capped at 30 chars; null when nothing remains. */
export function toTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const tag = value.trim().replace(/\s+/g, " ").slice(0, 30);
  return tag || null;
}

export function toIsoDay(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}
