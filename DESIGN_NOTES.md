# Design Notes

## Part 3b — Activity Feed: should a failed write roll back the original change?

**Decision: No — activity logging is best-effort and never rolls back the primary operation.**

The activity event is written *after* the primary mutation succeeds, using a fire-and-forget
pattern (`logActivity(...).catch(() => {})`).  If the write fails, the task update or comment
creation is **not** rolled back.

**Reasoning:**  
Activity events are a supplementary audit trail, not the source of truth for task state.  
Rolling back a successful task update because a non-critical log write failed would degrade
reliability for users — they'd lose real work due to an observability side-effect.  
The cost of an occasional missing activity entry is far lower than the cost of random
mutation failures.  If the activity table becomes unavailable, all task operations continue
uninterrupted, and the feed simply shows a gap — a reasonable trade-off.

A stricter alternative (transactional outbox / two-phase commit) would guarantee
consistency but adds significant infrastructure complexity that is not warranted at this stage.

---

## Part 3c — Airtable Export: idempotency strategy

On each export run the server first fetches all existing Airtable records and builds a
`taskId → airtableRecordId` map using the `"Task ID"` field.  Records that already exist
are updated (PATCH); new records are created (POST).  Running the export N times leaves
exactly the same number of records in Airtable as a single run — no duplicates.

## Part 3c — Retry policy

| Error type     | Retry? | Notes |
|----------------|--------|-------|
| 429 rate-limit | Yes    | Exponential back-off: 1 s → 2 s → 4 s (3 retries max) |
| 5xx server     | Yes    | Same back-off schedule |
| Network error  | Yes    | No status code present |
| 4xx permanent  | No     | Invalid field / auth — retrying won't help |

Individual record failures are isolated: a single bad record increments the `failed` counter
and adds an entry to `errors[]`, but the export continues for all remaining records.
