/**
 * A tiny seeded random generator for property tests. Seeded, so a failing
 * case can be replayed exactly: the failure message names the seed and run.
 * No dependency: mulberry32 is a dozen lines and good enough to shake inputs.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(probability: number): boolean;
}

export function rng(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (probability) => next() < probability,
  };
}

/**
 * Run `check` on `runs` generated cases. A thrown assertion is re-thrown with
 * the seed, the run and the input attached, so the case can be replayed.
 */
export function forAll<T>(
  seed: number,
  runs: number,
  generate: (random: Rng) => T,
  check: (input: T) => void
): void {
  const random = rng(seed);
  // FUZZ_SCALE=20 npm test runs twenty times as many cases, for a deeper search.
  const total = runs * Math.max(1, Number(process.env.FUZZ_SCALE) || 1);
  for (let run = 0; run < total; run++) {
    const input = generate(random);
    try {
      check(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `seed ${seed}, run ${run}\ninput: ${JSON.stringify(input, null, 2)}\n${message}`
      );
    }
  }
}

/** ISO date between two years, inclusive, always a real calendar day. */
export function isoDate(random: Rng, fromYear = 2024, toYear = 2028): string {
  const year = random.int(fromYear, toYear);
  const month = random.int(1, 12);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = random.int(1, days);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export const round2 = (value: number) => Math.round(value * 100) / 100;
