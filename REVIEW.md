# Code Review — TaskBoard Assessment

Issues ranked by business impact (highest first).

---

## Issue 1 — SQL Injection in Task Search

| Field    | Value |
|----------|-------|
| File     | `src/app/api/projects/[id]/tasks/route.ts` lines 27–34 |
| Category | Security |
| Severity | Critical |

### Description

The `GET /api/projects/:id/tasks?q=` search handler builds a raw SQL query by directly
interpolating the user-controlled `q` parameter with no sanitization:

```ts
const sql = `
  SELECT id, project_id, title, description, status, assignee_id, created_by_id, position, created_at, updated_at
  FROM tasks
  WHERE project_id = '${projectId}'
    AND (title ILIKE '%${q}%' OR description ILIKE '%${q}%')
  ORDER BY position ASC
`;
const tasks = await prisma.$queryRawUnsafe(sql);
```

An attacker can inject SQL into `q` to bypass the search filter, return unintended rows, or
exfiltrate data from other tables via UNION attacks. The `projectId` param is also interpolated
(though gated by a membership check), creating a defence-in-depth gap.

### Recommended Fix

Replace `$queryRawUnsafe` with a parameterized Prisma query:

```ts
const tasks = await prisma.task.findMany({
  where: {
    projectId,
    OR: [
      { title:       { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ],
  },
  include: { assignee: { select: { id: true, name: true, email: true } } },
  orderBy: { position: "asc" },
});
```

### Proof

```bash
# 1. Authenticate
MEERA_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"meera@taskboard.dev","password":"password123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

PROJECT_ID=cmp2ysmoc0006dlbb7xcotfa3  # Q3 Launch

# 2. Normal search — returns 0 results (no task contains "XYZNOTEXIST")
curl -s -H "Authorization: Bearer $MEERA_TOKEN" \
  "http://localhost:3000/api/projects/$PROJECT_ID/tasks?q=XYZNOTEXIST" \
  | python3 -c "import sys,json; print('Tasks returned:', len(json.load(sys.stdin)['tasks']))"
# → Tasks returned: 0

# 3. SQL injection — bypasses the filter, returns ALL 7 tasks
curl -s -H "Authorization: Bearer $MEERA_TOKEN" \
  "http://localhost:3000/api/projects/$PROJECT_ID/tasks?q=XYZNOTEXIST%27%20OR%20title%20%3C%3E%20%27" \
  | python3 -c "import sys,json; print('Tasks returned:', len(json.load(sys.stdin)['tasks']))"
# → Tasks returned: 7
```

---

## Issue 2 — Missing Authorization on `PATCH /api/tasks/:id`

| Field    | Value |
|----------|-------|
| File     | `src/app/api/tasks/[id]/route.ts` lines 16–38 |
| Category | Security |
| Severity | Critical |

### Description

The `PATCH` handler verifies only that the caller is authenticated — it never checks whether
the caller is a member of the task's project, or that the member's role permits editing:

```ts
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();          // ← only authn, no authz

  const existing = await prisma.task.findUnique({ where: { id } });
  // ← no membership check, no canEditTasks() call
  const task = await prisma.task.update({ where: { id }, data: parsed.data });
  ...
}
```

By contrast, the `DELETE` handler on the same file correctly calls `getProjectMembership` and
`canEditTasks`. Any logged-in user — even a viewer on a different project — can silently
overwrite the title, description, status, or assignee of any task in the system.

### Recommended Fix

After fetching `existing`, look up the caller's membership and verify their role:

```ts
const membership = await getProjectMembership(user.id, existing.projectId);
if (!membership) return forbidden("you are not a member of this project");
if (!canEditTasks(membership.role)) return forbidden("viewers cannot edit tasks");
```

### Proof

```bash
# dev@example.com is a VIEWER on Q3 Launch — role cannot create or edit tasks.
DEV_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@example.com","password":"password123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

TASK_ID=cmp2ysmpo000vdlbb61eihry2   # "Prepare customer email blast"

# Before fix — 200 OK, task is silently mutated:
curl -s -X PATCH "http://localhost:3000/api/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DEV_TOKEN" \
  -d '{"title":"UNAUTHORIZED MODIFICATION by viewer","status":"done"}'
# → {"task":{"title":"UNAUTHORIZED MODIFICATION by viewer","status":"done",...}}

# After fix — 403 Forbidden:
# → {"error":"viewers cannot edit tasks"}
```

---

## Issue 3 — Missing Unique Constraint on `User.email`

| Field    | Value |
|----------|-------|
| File     | `prisma/schema.prisma` line 26 (User model) |
| Category | Data Integrity |
| Severity | High |

### Description

The `User` model has no `@@unique([email])` constraint. The register endpoint guards against
duplicates with a `findFirst` check, but two concurrent registrations with the same email can
both pass the check before either write completes (classic TOCTOU race condition). Duplicate
accounts sharing one email would break password-reset flows, email-based queries, and any
future billing logic.

### Recommended Fix

Add a unique constraint to the schema:

```prisma
model User {
  email String @unique
  ...
}
```

And handle the `P2002` unique-violation error in the register handler with a proper 409 response.

---

## Issue 4 — JWT Tokens Expire After 30 Days with No Revocation

| Field    | Value |
|----------|-------|
| File     | `src/lib/jwt.ts` line 7 |
| Category | Security |
| Severity | Medium |

### Description

Tokens are signed with a 30-day expiry and there is no server-side revocation mechanism:

```ts
const EXPIRES_IN = "30d";
```

The "logout" action on the client merely removes the token from `localStorage`; the token
itself stays valid for up to 30 days. If a token is stolen (XSS, logged request, compromised
device), there is no way to invalidate it. Similarly, if a user is removed from a project or
deleted from the system, their existing token continues to work.

### Recommended Fix

Reduce `EXPIRES_IN` to `"15m"` and introduce refresh tokens, or maintain a server-side
`TokenRevocation` table keyed by `jti` (JWT ID claim). At minimum, add a `jti` claim to each
signed token and validate it against a lightweight Redis/DB allowlist on every request.
