# Screen Recording

## Recording Link

> **TODO:** Record your session with [Loom](https://loom.com) or similar,
> then replace this line with the link:
>
> 🎥 **[Insert Loom / recording link here]**

---

## What the recording covers

1. Project setup — npm install, prisma migrate, seed
2. Initial test run (3 files, 12 tests)
3. Live bug demonstration:
   - SQL injection in task search (`?q=XYZNOTEXIST' OR title <> '` returns all 7 tasks)
   - Viewer PATCH bypass (dev@example.com modifies a task, gets 200 instead of 403)
4. Walking through the fix code (`tasks/route.ts`, `tasks/[id]/route.ts`)
5. Fix verification via curl
6. Part 3a — Comments: posting a comment, viewer blocked, chronological list
7. Part 3b — Activity Feed: feed shows task_created, status_changed, comment_added events
8. Part 3c — Airtable Export:
   - First run: 7 records created in Airtable (screenshot of base shown)
   - Second run: same 7 records updated, no duplicates (idempotency confirmed)
9. Final test run — 7 files, 39 tests, all passing
