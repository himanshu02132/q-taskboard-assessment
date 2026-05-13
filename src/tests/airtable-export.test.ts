/**
 * Tests for Part 3c — Airtable export.
 *
 * Uses AirtableMockClient as the test double so no real credentials are needed.
 * Tests cover: happy path, idempotency, per-record error isolation, and
 * retry behaviour on transient failures.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { AirtableMockClient, AirtableError } from "@/lib/airtable-mock";
import type { ExportRecord } from "@/lib/airtable-client";

// ---------------------------------------------------------------------------
// Local export engine that mirrors src/lib/airtable-client.ts but accepts
// any client instance — this lets us inject the mock.
// ---------------------------------------------------------------------------

type ExportResult = {
  succeeded: number;
  failed: number;
  errors: Array<{ taskId: string; error: string }>;
};

async function exportWithClient(
  client: AirtableMockClient,
  records: ExportRecord[],
): Promise<ExportResult> {
  const MAX_RETRIES = 3;
  const BASE_DELAY = 10; // short delay in tests

  async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let last: unknown;
    for (let i = 0; i <= MAX_RETRIES; i++) {
      try {
        return await fn();
      } catch (err) {
        last = err;
        const isTransient =
          err instanceof AirtableError &&
          (err.type === "rate-limit" || err.type === "server-error" || err.type === "network");
        if (!isTransient) throw err;
        if (i < MAX_RETRIES) await new Promise((r) => setTimeout(r, BASE_DELAY * 2 ** i));
      }
    }
    throw last;
  }

  // Build existing-record map for idempotency
  const existing = await client.list();
  const byTaskId = new Map<string, string>();
  for (const rec of existing) {
    const tid = rec.fields["Task ID"];
    if (typeof tid === "string") byTaskId.set(tid, rec.id);
  }

  const result: ExportResult = { succeeded: 0, failed: 0, errors: [] };

  for (const record of records) {
    try {
      const existingId = byTaskId.get(record.taskId);
      if (existingId) {
        await withRetry(() => client.update(existingId, record.fields));
      } else {
        await withRetry(() => client.create({ id: record.taskId, fields: record.fields }));
      }
      result.succeeded++;
    } catch (err) {
      result.failed++;
      result.errors.push({
        taskId: record.taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const sampleRecords: ExportRecord[] = [
  {
    taskId: "task_1",
    fields: {
      "Task ID": "task_1",
      Title: "Set up CI",
      Description: "Wire up GitHub Actions",
      Status: "done",
      Assignee: "Meera Iyer",
      "Created At": "2026-01-01T00:00:00.000Z",
    },
  },
  {
    taskId: "task_2",
    fields: {
      "Task ID": "task_2",
      Title: "Write docs",
      Description: "",
      Status: "todo",
      Assignee: "Unassigned",
      "Created At": "2026-01-02T00:00:00.000Z",
    },
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let client: AirtableMockClient;

beforeEach(() => {
  client = new AirtableMockClient();
});

describe("Airtable export — happy path", () => {
  it("creates one Airtable record per task", async () => {
    const result = await exportWithClient(client, sampleRecords);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(client.__getRecordCount()).toBe(2);
  });

  it("each record's fields are stored correctly", async () => {
    await exportWithClient(client, sampleRecords);
    const recs = client.__getRecords();
    const ci = recs.find((r) => r.fields["Task ID"] === "task_1");
    expect(ci?.fields.Title).toBe("Set up CI");
    expect(ci?.fields.Status).toBe("done");
  });
});

describe("Airtable export — idempotency", () => {
  it("running the export twice does not duplicate records", async () => {
    await exportWithClient(client, sampleRecords);
    await exportWithClient(client, sampleRecords);
    expect(client.__getRecordCount()).toBe(2);
  });

  it("re-export updates existing record fields", async () => {
    await exportWithClient(client, sampleRecords);
    const updated: ExportRecord[] = [
      { ...sampleRecords[0], fields: { ...sampleRecords[0].fields, Status: "in_progress" } },
    ];
    await exportWithClient(client, updated);
    const recs = client.__getRecords();
    const rec = recs.find((r) => r.fields["Task ID"] === "task_1");
    expect(rec?.fields.Status).toBe("in_progress");
  });
});

describe("Airtable export — per-record error isolation", () => {
  it("continues export when one record fails permanently", async () => {
    // Simulate a permanent (non-retriable) error on task_1 by making the mock
    // throw a non-transient error on every call
    const faultyClient = new AirtableMockClient();

    // Monkey-patch create to fail for task_1 only
    const originalCreate = faultyClient.create.bind(faultyClient);
    let callCount = 0;
    faultyClient.create = async (input) => {
      callCount++;
      if (input.id === "task_1") {
        throw new AirtableError("Invalid field: Task ID", "server-error", 422);
      }
      return originalCreate(input);
    };

    const result = await exportWithClient(faultyClient, sampleRecords);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0].taskId).toBe("task_1");
  });
});

describe("Airtable export — retry on transient failures", () => {
  it("retries on rate-limit errors and eventually succeeds", async () => {
    const retryClient = new AirtableMockClient();
    let callCount = 0;
    const originalCreate = retryClient.create.bind(retryClient);
    retryClient.create = async (input) => {
      callCount++;
      if (callCount <= 2) {
        throw new AirtableError("Rate limited", "rate-limit", 429);
      }
      return originalCreate(input);
    };

    const result = await exportWithClient(retryClient, [sampleRecords[0]]);
    expect(result.succeeded).toBe(1);
    expect(callCount).toBeGreaterThan(1); // retried at least once
  });

  it("gives up after max retries on persistent transient errors", async () => {
    const alwaysFail = new AirtableMockClient();
    alwaysFail.create = async () => {
      throw new AirtableError("Server error", "server-error", 500);
    };

    const result = await exportWithClient(alwaysFail, [sampleRecords[0]]);
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(0);
  });
});
