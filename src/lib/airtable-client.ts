/**
 * Real Airtable client wrapper.
 *
 * Uses the official `airtable` npm package and the credentials from env vars:
 *   AIRTABLE_API_KEY   — personal access token
 *   AIRTABLE_BASE_ID   — base ID (starts with "app…")
 *   AIRTABLE_TABLE_NAME — defaults to "Tasks"
 *
 * Retry policy:
 *   - Transient failures (429 rate-limit, 5xx, network errors): up to 3 retries
 *     with exponential back-off (1s, 2s, 4s).
 *   - Permanent failures (4xx except 429): no retry, error surfaced immediately.
 */

import Airtable from "airtable";
import type { FieldSet, Records } from "airtable";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export type TaskFields = {
  "Task ID": string;
  Title: string;
  Description: string;
  Status: string;
  Assignee: string;
  "Created At": string;
};

function isTransient(err: unknown): boolean {
  if (err && typeof err === "object") {
    const e = err as { statusCode?: number; error?: string };
    if (e.statusCode === 429) return true;
    if (e.statusCode && e.statusCode >= 500) return true;
    // Network / no statusCode
    if (!e.statusCode) return true;
  }
  return false;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransient(err)) throw err;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, BASE_DELAY_MS * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

export type ExportRecord = {
  taskId: string;
  fields: TaskFields;
};

export type ExportResult = {
  succeeded: number;
  failed: number;
  errors: Array<{ taskId: string; error: string }>;
};

export async function exportTasksToAirtable(records: ExportRecord[]): Promise<ExportResult> {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE_NAME ?? "Tasks";

  if (!apiKey || !baseId) {
    throw new Error("AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set");
  }

  const base = new Airtable({ apiKey }).base(baseId);
  const table = base(tableName);

  // Build a map of existing records keyed by "Task ID" field for idempotency
  const existingByTaskId = new Map<string, string>();
  let offset: string | undefined = undefined;
  do {
    const page: Records<FieldSet> = await withRetry(() =>
      new Promise((resolve, reject) => {
        const opts: Record<string, unknown> = { fields: ["Task ID"] };
        if (offset) opts.offset = offset;
        table.select(opts).firstPage((err, recs) => {
          if (err) return reject(err);
          resolve(recs ?? []);
        });
      })
    );
    for (const rec of page) {
      const tid = rec.fields["Task ID"];
      if (typeof tid === "string") existingByTaskId.set(tid, rec.id);
    }
    // Airtable SDK doesn't expose offset here; firstPage returns up to 100 records.
    // For large bases, use `eachPage` below instead.
    break;
  } while (false);

  // For real pagination over all existing records:
  existingByTaskId.clear();
  await withRetry(() =>
    new Promise<void>((resolve, reject) => {
      table.select({ fields: ["Task ID"] }).eachPage(
        (recs, fetchNext) => {
          for (const rec of recs) {
            const tid = rec.fields["Task ID"];
            if (typeof tid === "string") existingByTaskId.set(tid, rec.id);
          }
          fetchNext();
        },
        (err) => (err ? reject(err) : resolve()),
      );
    })
  );

  const result: ExportResult = { succeeded: 0, failed: 0, errors: [] };

  for (const record of records) {
    try {
      const existingId = existingByTaskId.get(record.taskId);
      if (existingId) {
        // Update existing record (idempotent re-export)
        await withRetry(() =>
          new Promise<void>((resolve, reject) => {
            table.update(existingId, record.fields as unknown as FieldSet, (err) =>
              err ? reject(err) : resolve(),
            );
          })
        );
      } else {
        // Create new record
        await withRetry(() =>
          new Promise<void>((resolve, reject) => {
            table.create(record.fields as unknown as FieldSet, (err) =>
              err ? reject(err) : resolve(),
            );
          })
        );
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
