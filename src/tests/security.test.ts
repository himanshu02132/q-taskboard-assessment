/**
 * Tests for the two critical security fixes:
 *   1. SQL injection in task search (Issue #1)
 *   2. Missing authorization on PATCH /api/tasks/:id (Issue #2)
 *
 * These tests use the real Prisma client against a test database so that
 * the ORM-level parameterization is verified end-to-end.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { signToken } from "@/lib/jwt";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = "http://localhost:3000";

async function post(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return res;
}

async function get(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(`${BASE}${path}`, { headers });
}

async function patch(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Setup — grab real tokens from the running dev server
// ---------------------------------------------------------------------------

let meeraToken: string;
let devToken: string;   // dev@example.com — viewer on Q3 Launch
let q3ProjectId: string;
let taskId: string;     // a task inside Q3 Launch

beforeAll(async () => {
  const loginMeera = await post("/api/auth/login", {
    email: "meera@taskboard.dev",
    password: "password123",
  });
  const meeraData = await loginMeera.json() as { token: string };
  meeraToken = meeraData.token;

  const loginDev = await post("/api/auth/login", {
    email: "dev@example.com",
    password: "password123",
  });
  const devData = await loginDev.json() as { token: string };
  devToken = devData.token;

  const projectsRes = await get("/api/projects", meeraToken);
  const projectsData = await projectsRes.json() as { projects: Array<{ id: string; name: string }> };
  const q3 = projectsData.projects.find((p) => p.name === "Q3 Launch");
  q3ProjectId = q3!.id;

  const tasksRes = await get(`/api/projects/${q3ProjectId}/tasks`, meeraToken);
  const tasksData = await tasksRes.json() as { tasks: Array<{ id: string }> };
  taskId = tasksData.tasks[0].id;
});

// ---------------------------------------------------------------------------
// Issue #1 — SQL injection fix
// ---------------------------------------------------------------------------

describe("task search — SQL injection prevention", () => {
  it("returns 0 results for a query that matches nothing", async () => {
    const res = await get(
      `/api/projects/${q3ProjectId}/tasks?q=XYZWILLNEVEREXIST`,
      meeraToken,
    );
    expect(res.status).toBe(200);
    const data = await res.json() as { tasks: unknown[] };
    expect(data.tasks).toHaveLength(0);
  });

  it("does NOT return extra rows when the q param contains SQL tautology", async () => {
    // Previously this injection: XYZNOTEXIST' OR title <> '
    // would bypass the WHERE and return all tasks.
    const injection = encodeURIComponent("XYZNOTEXIST' OR title <> '");
    const res = await get(
      `/api/projects/${q3ProjectId}/tasks?q=${injection}`,
      meeraToken,
    );
    expect(res.status).toBe(200);
    const data = await res.json() as { tasks: unknown[] };
    // After the fix: parameterized ORM query — still 0 results
    expect(data.tasks).toHaveLength(0);
  });

  it("returns matching tasks for a legitimate search", async () => {
    const res = await get(
      `/api/projects/${q3ProjectId}/tasks?q=launch`,
      meeraToken,
    );
    expect(res.status).toBe(200);
    const data = await res.json() as { tasks: Array<{ title: string }> };
    expect(data.tasks.length).toBeGreaterThan(0);
    expect(
      data.tasks.every(
        (t) =>
          t.title.toLowerCase().includes("launch"),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Issue #2 — PATCH /api/tasks/:id authorization fix
// ---------------------------------------------------------------------------

describe("task PATCH — authorization enforcement", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await patch(`/api/tasks/${taskId}`, { title: "x" });
    expect(res.status).toBe(401);
  });

  it("rejects a viewer trying to edit a task with 403", async () => {
    // dev@example.com is a viewer on Q3 Launch
    const res = await patch(
      `/api/tasks/${taskId}`,
      { title: "Viewer should not be able to change this" },
      devToken,
    );
    expect(res.status).toBe(403);
    const data = await res.json() as { error: string };
    expect(data.error).toMatch(/viewer/i);
  });

  it("allows an admin to edit a task", async () => {
    // Fetch original title first
    const before = await get(`/api/projects/${q3ProjectId}/tasks`, meeraToken);
    const beforeData = await before.json() as { tasks: Array<{ id: string; title: string }> };
    const originalTitle = beforeData.tasks.find((t) => t.id === taskId)!.title;

    const res = await patch(`/api/tasks/${taskId}`, { title: originalTitle }, meeraToken);
    expect(res.status).toBe(200);
  });
});
