import "server-only";

/**
 * Tiny in-process job registry for Claude analyses. Jobs run server-side and
 * outlive the client component that started them, so switching tabs or
 * reloading the page never cancels a run — the UI just polls the snapshot.
 * (Job state lives on globalThis to survive dev-mode HMR module reloads.)
 */

export type JobStatus = "running" | "done" | "error";

export interface Job<T> {
  status: JobStatus;
  startedAt: number;
  finishedAt: number | null;
  /** Progress lines, oldest first; the last line may be updated in place. */
  log: string[];
  result: T | null;
  error: string | null;
  /** Free-form metadata (e.g. the question of a free analysis). */
  meta: Record<string, string>;
  /** Stops the runner's Claude process; server-side only, never sent to the client. */
  controller: AbortController;
}

type Store = Map<string, Job<unknown>>;

const globalStore = globalThis as typeof globalThis & { __finanzAnalysisJobs?: Store };
const jobs: Store = (globalStore.__finanzAnalysisJobs ??= new Map());

export interface ProgressReporter {
  (line: string, opts?: { replaceLast?: boolean }): void;
}

export function getJob<T>(key: string): Job<T> | undefined {
  return jobs.get(key) as Job<T> | undefined;
}

/**
 * Start a job unless one with this key is already running (then that one is
 * returned untouched). The runner reports progress via the given reporter;
 * its resolved value becomes the job result.
 */
export function startJob<T>(
  key: string,
  meta: Record<string, string>,
  run: (progress: ProgressReporter, signal: AbortSignal) => Promise<T>
): Job<T> {
  const existing = jobs.get(key);
  if (existing && existing.status === "running") return existing as Job<T>;

  const job: Job<T> = {
    status: "running",
    startedAt: Date.now(),
    finishedAt: null,
    log: [],
    result: null,
    error: null,
    meta,
    controller: new AbortController(),
  };
  jobs.set(key, job);

  const progress: ProgressReporter = (line, opts) => {
    if (opts?.replaceLast && job.log.length > 0) {
      job.log[job.log.length - 1] = line;
    } else {
      job.log.push(line);
    }
  };

  void run(progress, job.controller.signal)
    .then((result) => {
      job.result = result;
      job.status = "done";
      job.finishedAt = Date.now();
    })
    .catch((err: unknown) => {
      job.error = err instanceof Error ? err.message : String(err);
      job.status = "error";
      job.finishedAt = Date.now();
    });

  return job;
}

/**
 * Drop a job from the registry (finished or abandoned) and stop its Claude
 * process. The runner then finishes into the orphaned object, which is
 * harmless: the next start registers a fresh job under the key.
 */
export function deleteJob(key: string): void {
  jobs.get(key)?.controller.abort();
  jobs.delete(key);
}

/** Stop a running job's Claude process but keep the job, so it can finish without it. */
export function abortJob(key: string): void {
  jobs.get(key)?.controller.abort();
}

/** Mutate the result of a finished job (e.g. resolve one suggestion). */
export function updateJobResult<T>(key: string, update: (result: T) => T): void {
  const job = jobs.get(key) as Job<T> | undefined;
  if (job && job.status === "done" && job.result !== null) {
    job.result = update(job.result);
  }
}
