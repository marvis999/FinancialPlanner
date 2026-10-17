import { describe, expect, it } from "vitest";

import { abortJob, deleteJob, getJob, startJob } from "@/lib/analysis-jobs";

describe("the job registry", () => {
  it("stops a runner's Claude run when its job is dropped", () => {
    const signals: AbortSignal[] = [];
    startJob("test-delete", {}, (_progress, signal) => {
      signals.push(signal);
      return new Promise(() => {});
    });
    deleteJob("test-delete");
    expect(signals[0].aborted).toBe(true);
    expect(getJob("test-delete")).toBeUndefined();
  });

  it("lets a skipped runner finish without its Claude run", async () => {
    startJob(
      "test-skip",
      {},
      (_progress, signal) =>
        new Promise((resolve) => signal.addEventListener("abort", () => resolve("skipped")))
    );
    abortJob("test-skip");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getJob("test-skip")).toMatchObject({ status: "done", result: "skipped" });
    deleteJob("test-skip");
  });
});
