# Terminal Log

All commands run from the project root: `q-taskboard-assessment-main/`

---

## 1. Setup output

```
$ sudo -u postgres psql -c "CREATE USER taskboard WITH PASSWORD 'taskboard';"
CREATE ROLE
$ sudo -u postgres psql -c "CREATE DATABASE taskboard OWNER taskboard;"
CREATE DATABASE
$ sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE taskboard TO taskboard;"
GRANT

$ cp .env.example .env

$ npm install
added 507 packages, and audited 508 packages in 20s
170 packages are looking for funding
  run `npm fund` for details
10 vulnerabilities (2 low, 6 moderate, 1 high, 1 critical)
To address all issues, run: npm audit fix --force

$ node_modules/.bin/prisma migrate deploy
Environment variables loaded from .env
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "taskboard", schema "public" at "localhost:5432"
2 migrations found in prisma/migrations
All migrations have been successfully applied.

$ node_modules/.bin/prisma generate
Environment variables loaded from .env
Prisma schema loaded from prisma/schema.prisma
✔ Generated Prisma Client (v6.1.0) to ./node_modules/@prisma/client in 87ms

$ node_modules/.bin/tsx prisma/seed.ts
seeding…
seed complete.
login with any of these (password: password123):
  meera@taskboard.dev   — admin on Q3 Launch, Internal Tools
  arjun@taskboard.dev   — admin on Onboarding, member on Q3 Launch
  kavya@example.com     — member on Q3 Launch
  dev@example.com       — viewer on Q3 Launch
  lina@example.com      — member on Onboarding
```

---

## 2. Initial test run (baseline — 3 files, 12 tests)

```
$ node_modules/.bin/vitest run src/tests/auth.test.ts \
    src/tests/schemas.test.ts src/tests/TaskCard.test.tsx

 RUN  v2.1.8 /home/.../q-taskboard-assessment-main

 ✓ src/tests/schemas.test.ts (7 tests)   13ms
 ✓ src/tests/auth.test.ts   (2 tests)   14ms
 ✓ src/tests/TaskCard.test.tsx (3 tests) 165ms

 Test Files  3 passed (3)
      Tests  12 passed (12)
   Duration  2.16s
```

---

## 3. Bug proof — SQL Injection (Issue #1, BEFORE fix)

```bash
# Authenticate
MEERA_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"meera@taskboard.dev","password":"password123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

PROJECT_ID=cmp2ysmoc0006dlbb7xcotfa3   # Q3 Launch (7 tasks)

# --- Normal search: 0 results (correct) ---
$ curl -s -H "Authorization: Bearer $MEERA_TOKEN" \
    "http://localhost:3000/api/projects/$PROJECT_ID/tasks?q=XYZNOTEXIST" \
  | python3 -c "import sys,json; print('Tasks:', len(json.load(sys.stdin)['tasks']))"
Tasks: 0

# --- SQL injection: bypasses WHERE filter, returns ALL 7 tasks (BUG) ---
# Injection: XYZNOTEXIST' OR title <> '
# Produced SQL: ... title ILIKE '%XYZNOTEXIST' OR title <> '%' ...
# `title <> '%'` is TRUE for every normal title → returns all rows

$ curl -s -H "Authorization: Bearer $MEERA_TOKEN" \
    "http://localhost:3000/api/projects/$PROJECT_ID/tasks?q=XYZNOTEXIST%27%20OR%20title%20%3C%3E%20%27" \
  | python3 -c "import sys,json; print('Tasks:', len(json.load(sys.stdin)['tasks']))"
Tasks: 7     # <-- BUG: should be 0
```

## 4. Bug proof — Missing PATCH authorization (Issue #2, BEFORE fix)

```bash
# dev@example.com is a VIEWER on Q3 Launch — role cannot edit tasks
DEV_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@example.com","password":"password123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

TASK_ID=cmp2ysmpo000vdlbb61eihry2   # "Prepare customer email blast"

$ curl -s -X PATCH "http://localhost:3000/api/tasks/$TASK_ID" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $DEV_TOKEN" \
    -d '{"title":"UNAUTHORIZED MODIFICATION by viewer","status":"done"}'
{"task":{"title":"UNAUTHORIZED MODIFICATION by viewer","status":"done",...}}
#  ^--- BUG: 200 OK, task mutated. Should have been 403 Forbidden.
```

---

## 5. Fix proof

```bash
# Fix 1: SQL injection now returns 0 (correct)
$ curl -s -H "Authorization: Bearer $MEERA_TOKEN" \
    "http://localhost:3000/api/projects/$PROJECT_ID/tasks?q=XYZNOTEXIST%27%20OR%20title%20%3C%3E%20%27" \
  | python3 -c "import sys,json; print('Tasks:', len(json.load(sys.stdin)['tasks']))"
Tasks: 0     # FIXED ✓

# Fix 2: Viewer PATCH now returns 403 (correct)
$ curl -s -X PATCH "http://localhost:3000/api/tasks/$TASK_ID" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $DEV_TOKEN" \
    -d '{"title":"UNAUTHORIZED"}'
{"error":"viewers cannot edit tasks"}     # FIXED ✓
```

---

## 6. Part 3c — Airtable export demo

> Credentials set in `.env`: `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_NAME=Tasks`

```bash
# First run — creates 7 records in Airtable
$ curl -s -X POST "http://localhost:3000/api/projects/$PROJECT_ID/export" \
    -H "Authorization: Bearer $MEERA_TOKEN"
{"ok":true,"succeeded":7,"failed":0,"errors":[]}

# Second run — updates the same 7 records (idempotent, no duplicates)
$ curl -s -X POST "http://localhost:3000/api/projects/$PROJECT_ID/export" \
    -H "Authorization: Bearer $MEERA_TOKEN"
{"ok":true,"succeeded":7,"failed":0,"errors":[]}

# Viewer cannot trigger export
$ curl -s -X POST "http://localhost:3000/api/projects/$PROJECT_ID/export" \
    -H "Authorization: Bearer $DEV_TOKEN"
{"error":"only admins and members can trigger an export"}
```

> **Airtable screenshot / share link:** see `RECORDING.md` — the screen recording
> shows the Airtable base after both runs (7 records, no duplicates).

---

## 7. Part 3a — Task Comments demo

```bash
TASK_ID=cmp2ysmps000xdlbbydxj0g1k   # "Update pricing page copy"

# Admin posts a comment
$ curl -s -X POST "http://localhost:3000/api/tasks/$TASK_ID/comments" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $MEERA_TOKEN" \
    -d '{"body":"This task is on track for Q3 launch!"}' \
  | python3 -c "import sys,json; c=json.load(sys.stdin)['comment']; print(c['author']['name'],':',c['body'])"
Meera Iyer : This task is on track for Q3 launch!

# Viewer is blocked from posting
$ curl -s -X POST "http://localhost:3000/api/tasks/$TASK_ID/comments" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $DEV_TOKEN" \
    -d '{"body":"I should not be able to post"}'
{"error":"viewers cannot post comments"}

# Anyone (including viewer) can list comments
$ curl -s "http://localhost:3000/api/tasks/$TASK_ID/comments" \
    -H "Authorization: Bearer $DEV_TOKEN" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['comments']),'comment(s)')"
5 comment(s)

# No edit/delete endpoints — PATCH /api/comments/:id returns 404
$ curl -s -X PATCH "http://localhost:3000/api/comments/someid" \
    -H "Authorization: Bearer $MEERA_TOKEN" \
    -d '{"body":"edited"}'
# HTTP 404 — append-only confirmed ✓
```

---

## 8. Part 3b — Activity Feed demo

```bash
# Activity feed (most-recent first, project members only)
$ curl -s "http://localhost:3000/api/projects/$PROJECT_ID/activity" \
    -H "Authorization: Bearer $MEERA_TOKEN" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
for e in d['events'][:5]:
    print(e['actor']['name'],'->', e['type'], e.get('meta',{}))"
Meera Iyer -> comment_added {'commentId': 'cmp3kekcr000rdlfcalj459dr', 'taskTitle': 'Update pricing page copy'}
Meera Iyer -> status_changed {'to': 'todo', 'from': 'in_progress', 'title': 'Update pricing page copy'}
Meera Iyer -> status_changed {'to': 'in_progress', 'from': 'todo', 'title': 'Update pricing page copy'}
Meera Iyer -> task_created {'title': 'Activity test task'}
Meera Iyer -> comment_added {'commentId': 'cmp3kdjep000jdlfc2jd81l74', 'taskTitle': 'Update pricing page copy'}

# Non-member gets 403
$ curl -s "http://localhost:3000/api/projects/$PROJECT_ID/activity"
{"error":"unauthorized"}
```

---

## 9. Final test run (7 files, 39 tests — all passing)

```
$ node_modules/.bin/vitest run

 RUN  v2.1.8 /home/.../q-taskboard-assessment-main

 ✓ src/tests/auth.test.ts              (2 tests)   21ms
 ✓ src/tests/schemas.test.ts           (7 tests)   13ms
 ✓ src/tests/TaskCard.test.tsx         (3 tests)  152ms
 ✓ src/tests/airtable-export.test.ts  (7 tests)  193ms
 ✓ src/tests/security.test.ts         (6 tests) 3036ms
   ✓ SQL injection prevention — tautology returns 0 results
   ✓ PATCH auth — viewer gets 403
   ✓ PATCH auth — admin can edit
 ✓ src/tests/activity.test.ts         (6 tests) 3540ms
   ✓ requires authentication
   ✓ requires project membership
   ✓ allows viewer to read feed
   ✓ events are most-recent first
   ✓ records task_created event
   ✓ records status_changed event
 ✓ src/tests/comments.test.ts         (8 tests) 3773ms
   ✓ requires authentication
   ✓ requires project membership
   ✓ viewer can list comments
   ✓ comments in chronological order
   ✓ rejects empty body
   ✓ member can post comment
   ✓ viewer cannot post (403)
   ✓ no edit/delete endpoints (append-only)

 Test Files  7 passed (7)
      Tests  39 passed (39)
   Start at  10:12:05
   Duration  5.82s
```
