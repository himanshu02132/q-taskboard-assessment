# Terminal Log

All commands run in the project root: `q-taskboard-assessment-main/`

---

## 1. Setup

```
$ sudo -u postgres psql -c "CREATE USER taskboard WITH PASSWORD 'taskboard';"
CREATE ROLE
$ sudo -u postgres psql -c "CREATE DATABASE taskboard OWNER taskboard;"
CREATE DATABASE
$ sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE taskboard TO taskboard;"
GRANT

$ cp .env.example .env
$ npm install
added 507 packages in 20s

$ node_modules/.bin/prisma migrate deploy
All migrations have been successfully applied.

$ node_modules/.bin/prisma generate
✔ Generated Prisma Client (v6.1.0)

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

## 2. Initial test run

```
$ node_modules/.bin/vitest run

 ✓ src/tests/schemas.test.ts (7 tests)
 ✓ src/tests/auth.test.ts (2 tests)
 ✓ src/tests/TaskCard.test.tsx (3 tests)

 Test Files  3 passed (3)
      Tests  12 passed (12)
```

---

## 3. Bug proof — SQL Injection (Issue #1, BEFORE fix)

```bash
# Set up
MEERA_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"meera@taskboard.dev","password":"password123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

PROJECT_ID=cmp2ysmoc0006dlbb7xcotfa3   # Q3 Launch

# Normal search (no match) — returns 0 tasks
$ curl -s -H "Authorization: Bearer $MEERA_TOKEN" \
    "http://localhost:3000/api/projects/$PROJECT_ID/tasks?q=XYZNOTEXIST" \
  | python3 -c "import sys,json; print('Tasks:', len(json.load(sys.stdin)['tasks']))"
Tasks: 0

# SQL injection — bypass the filter, returns ALL 7 tasks (BUG)
$ curl -s -H "Authorization: Bearer $MEERA_TOKEN" \
    "http://localhost:3000/api/projects/$PROJECT_ID/tasks?q=XYZNOTEXIST%27%20OR%20title%20%3C%3E%20%27" \
  | python3 -c "import sys,json; print('Tasks:', len(json.load(sys.stdin)['tasks']))"
Tasks: 7
```

## 4. Bug proof — Missing PATCH authorization (Issue #2, BEFORE fix)

```bash
DEV_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@example.com","password":"password123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

TASK_ID=cmp2ysmpo000vdlbb61eihry2   # "Prepare customer email blast"

# dev is a VIEWER — should get 403 but gets 200 (BUG)
$ curl -s -X PATCH "http://localhost:3000/api/tasks/$TASK_ID" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $DEV_TOKEN" \
    -d '{"title":"UNAUTHORIZED MODIFICATION by viewer","status":"done"}'
{"task":{"title":"UNAUTHORIZED MODIFICATION by viewer","status":"done",...}}
```

---

## 5. Fix proof

```bash
# After fix — SQL injection returns 0 (correct)
$ curl -s -H "Authorization: Bearer $MEERA_TOKEN" \
    "http://localhost:3000/api/projects/$PROJECT_ID/tasks?q=XYZNOTEXIST%27%20OR%20title%20%3C%3E%20%27" \
  | python3 -c "import sys,json; print('Tasks:', len(json.load(sys.stdin)['tasks']))"
Tasks: 0

# After fix — viewer PATCH returns 403 (correct)
$ curl -s -X PATCH "http://localhost:3000/api/tasks/$TASK_ID" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $DEV_TOKEN" \
    -d '{"title":"UNAUTHORIZED"}'
{"error":"viewers cannot edit tasks"}
```

---

## 6. Part 3c — Airtable export demo

```bash
# Configure Airtable credentials in .env:
# AIRTABLE_API_KEY=pat...
# AIRTABLE_BASE_ID=app...

# Trigger export (first run — creates records)
$ curl -s -X POST "http://localhost:3000/api/projects/$PROJECT_ID/export" \
    -H "Authorization: Bearer $MEERA_TOKEN"
{"ok":true,"succeeded":7,"failed":0,"errors":[]}

# Second run — updates existing records (idempotent, still 7 records in Airtable)
$ curl -s -X POST "http://localhost:3000/api/projects/$PROJECT_ID/export" \
    -H "Authorization: Bearer $MEERA_TOKEN"
{"ok":true,"succeeded":7,"failed":0,"errors":[]}

# Viewer cannot export
$ curl -s -X POST "http://localhost:3000/api/projects/$PROJECT_ID/export" \
    -H "Authorization: Bearer $DEV_TOKEN"
{"error":"only admins and members can trigger an export"}
```

---

## 7. Part 3a — Comments demo

```bash
TASK_ID=cmp2ysmps000xdlbbydxj0g1k

# Admin posts a comment
$ curl -s -X POST "http://localhost:3000/api/tasks/$TASK_ID/comments" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $MEERA_TOKEN" \
    -d '{"body":"This task is on track for Q3 launch!"}' \
  | python3 -c "import sys,json; c=json.load(sys.stdin)['comment']; print(c['author']['name'], ':', c['body'])"
Meera Iyer : This task is on track for Q3 launch!

# Viewer can read but not post
$ curl -s -X POST "http://localhost:3000/api/tasks/$TASK_ID/comments" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $DEV_TOKEN" \
    -d '{"body":"I should not be able to post"}'
{"error":"viewers cannot post comments"}

# List comments (chronological)
$ curl -s "http://localhost:3000/api/tasks/$TASK_ID/comments" \
    -H "Authorization: Bearer $DEV_TOKEN" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['comments']), 'comment(s)')"
5 comment(s)
```

---

## 8. Part 3b — Activity feed demo

```bash
$ curl -s "http://localhost:3000/api/projects/$PROJECT_ID/activity" \
    -H "Authorization: Bearer $MEERA_TOKEN" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); [print(e['actor']['name'], '->', e['type']) for e in d['events'][:5]]"
Meera Iyer -> comment_added
Meera Iyer -> status_changed
Meera Iyer -> status_changed
Meera Iyer -> comment_added
Meera Iyer -> comment_added
```

---

## 9. Final test run

```
$ node_modules/.bin/vitest run

 ✓ src/tests/auth.test.ts (2 tests)
 ✓ src/tests/schemas.test.ts (7 tests)
 ✓ src/tests/airtable-export.test.ts (7 tests)
 ✓ src/tests/TaskCard.test.tsx (3 tests)
 ✓ src/tests/comments.test.ts (8 tests)
 ✓ src/tests/activity.test.ts (6 tests)
 ✓ src/tests/security.test.ts (6 tests)

 Test Files  7 passed (7)
      Tests  39 passed (39)
   Duration  11.16s
```
