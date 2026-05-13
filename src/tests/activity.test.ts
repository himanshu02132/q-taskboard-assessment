/**
 * Integration tests for Part 3b — Activity Feed.
 * Runs against the live dev server on localhost:3000.
 */

import { describe, it, expect, beforeAll } from "vitest";

const BASE = "http://localhost:3000";

async function post(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
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

async function get(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(`${BASE}${path}`, { headers });
}

let meeraToken: string;
let devToken: string;
let q3ProjectId: string;

beforeAll(async () => {
  const m = await post("/api/auth/login", { email: "meera@taskboard.dev", password: "password123" });
  meeraToken = ((await m.json()) as { token: string }).token;

  const d = await post("/api/auth/login", { email: "dev@example.com", password: "password123" });
  devToken = ((await d.json()) as { token: string }).token;

  const proj = await get("/api/projects", meeraToken);
  const pd = (await proj.json()) as { projects: Array<{ id: string; name: string }> };
  q3ProjectId = pd.projects.find((p) => p.name === "Q3 Launch")!.id;
});

describe("GET /api/projects/:id/activity", () => {
  it("requires authentication", async () => {
    const res = await get(`/api/projects/${q3ProjectId}/activity`);
    expect(res.status).toBe(401);
  });

  it("requires project membership", async () => {
    const ts = Date.now();
    const reg = await post("/api/auth/register", {
      email: `outsider${ts}@test.com`,
      password: "testpassword",
      name: "Outsider",
    });
    const { token: outsiderToken } = (await reg.json()) as { token: string };
    const res = await get(`/api/projects/${q3ProjectId}/activity`, outsiderToken);
    expect(res.status).toBe(403);
  });

  it("allows a viewer to read the feed", async () => {
    const res = await get(`/api/projects/${q3ProjectId}/activity`, devToken);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { events: unknown[] };
    expect(Array.isArray(data.events)).toBe(true);
  });

  it("returns events most-recent first", async () => {
    const res = await get(`/api/projects/${q3ProjectId}/activity`, meeraToken);
    const data = (await res.json()) as {
      events: Array<{ createdAt: string }>;
    };
    const dates = data.events.map((e) => new Date(e.createdAt).getTime());
    const isSorted = dates.every((d, i) => i === 0 || d <= dates[i - 1]);
    expect(isSorted).toBe(true);
  });

  it("records a task_created event when a task is created", async () => {
    const before = await get(`/api/projects/${q3ProjectId}/activity`, meeraToken);
    const beforeData = (await before.json()) as { events: Array<{ type: string }> };
    const beforeCount = beforeData.events.filter((e) => e.type === "task_created").length;

    await post(`/api/projects/${q3ProjectId}/tasks`, { title: "Activity test task" }, meeraToken);

    const after = await get(`/api/projects/${q3ProjectId}/activity`, meeraToken);
    const afterData = (await after.json()) as { events: Array<{ type: string; meta: { title?: string } }> };
    const afterCount = afterData.events.filter((e) => e.type === "task_created").length;

    expect(afterCount).toBe(beforeCount + 1);
  });

  it("records a status_changed event when a task status changes", async () => {
    const tasks = await get(`/api/projects/${q3ProjectId}/tasks`, meeraToken);
    const td = (await tasks.json()) as { tasks: Array<{ id: string; status: string }> };
    const task = td.tasks.find((t) => t.status === "todo")!;

    await patch(`/api/tasks/${task.id}`, { status: "in_progress" }, meeraToken);

    const feed = await get(`/api/projects/${q3ProjectId}/activity`, meeraToken);
    const feedData = (await feed.json()) as {
      events: Array<{ type: string; meta: { from?: string; to?: string } }>;
    };
    const ev = feedData.events.find(
      (e) => e.type === "status_changed" && e.meta?.to === "in_progress",
    );
    expect(ev).toBeDefined();

    // Restore
    await patch(`/api/tasks/${task.id}`, { status: "todo" }, meeraToken);
  });
});
