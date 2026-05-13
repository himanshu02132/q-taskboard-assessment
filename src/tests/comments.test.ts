/**
 * Integration tests for Part 3a — Task Comments.
 * Runs against the live dev server on localhost:3000.
 */

import { describe, it, expect, beforeAll } from "vitest";

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

let meeraToken: string;
let devToken: string;   // viewer
let taskId: string;
let q3ProjectId: string;

beforeAll(async () => {
  const m = await post("/api/auth/login", { email: "meera@taskboard.dev", password: "password123" });
  meeraToken = ((await m.json()) as { token: string }).token;

  const d = await post("/api/auth/login", { email: "dev@example.com", password: "password123" });
  devToken = ((await d.json()) as { token: string }).token;

  const proj = await get("/api/projects", meeraToken);
  const pd = (await proj.json()) as { projects: Array<{ id: string; name: string }> };
  q3ProjectId = pd.projects.find((p) => p.name === "Q3 Launch")!.id;

  const tasks = await get(`/api/projects/${q3ProjectId}/tasks`, meeraToken);
  const td = (await tasks.json()) as { tasks: Array<{ id: string }> };
  taskId = td.tasks[0].id;
});

describe("GET /api/tasks/:id/comments", () => {
  it("requires authentication", async () => {
    const res = await get(`/api/tasks/${taskId}/comments`);
    expect(res.status).toBe(401);
  });

  it("requires project membership", async () => {
    // Create a fresh user who is not in Q3 Launch
    const ts = Date.now();
    const reg = await post("/api/auth/register", {
      email: `stranger${ts}@test.com`,
      password: "testpassword",
      name: "Stranger",
    });
    const { token: strangerToken } = (await reg.json()) as { token: string };
    const res = await get(`/api/tasks/${taskId}/comments`, strangerToken);
    expect(res.status).toBe(403);
  });

  it("allows a viewer to list comments", async () => {
    const res = await get(`/api/tasks/${taskId}/comments`, devToken);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { comments: unknown[] };
    expect(Array.isArray(data.comments)).toBe(true);
  });

  it("returns comments in chronological order", async () => {
    // Post two comments and verify ordering
    await post(`/api/tasks/${taskId}/comments`, { body: "first comment" }, meeraToken);
    await post(`/api/tasks/${taskId}/comments`, { body: "second comment" }, meeraToken);

    const res = await get(`/api/tasks/${taskId}/comments`, meeraToken);
    const data = (await res.json()) as { comments: Array<{ body: string; createdAt: string }> };
    const bodies = data.comments.map((c) => c.body);
    const firstIdx = bodies.indexOf("first comment");
    const secondIdx = bodies.indexOf("second comment");
    // "second comment" must appear after "first comment"
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(secondIdx).toBeGreaterThan(firstIdx);
  });
});

describe("POST /api/tasks/:id/comments", () => {
  it("rejects an empty body", async () => {
    const res = await post(`/api/tasks/${taskId}/comments`, { body: "" }, meeraToken);
    expect(res.status).toBe(400);
  });

  it("allows a member to post a comment", async () => {
    const res = await post(
      `/api/tasks/${taskId}/comments`,
      { body: "looks good to me!" },
      meeraToken,
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as { comment: { body: string; author: { name: string } } };
    expect(data.comment.body).toBe("looks good to me!");
    expect(data.comment.author.name).toBe("Meera Iyer");
  });

  it("prevents a viewer from posting", async () => {
    const res = await post(
      `/api/tasks/${taskId}/comments`,
      { body: "viewers should not post" },
      devToken,
    );
    expect(res.status).toBe(403);
  });

  it("comments are append-only — no edit or delete endpoints exist", async () => {
    const createRes = await post(
      `/api/tasks/${taskId}/comments`,
      { body: "immutable comment" },
      meeraToken,
    );
    const { comment } = (await createRes.json()) as { comment: { id: string } };

    const patchRes = await fetch(`${BASE}/api/comments/${comment.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${meeraToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ body: "edited" }),
    });
    // No PATCH endpoint — expect 404 or 405
    expect([404, 405]).toContain(patchRes.status);

    const deleteRes = await fetch(`${BASE}/api/comments/${comment.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${meeraToken}` },
    });
    expect([404, 405]).toContain(deleteRes.status);
  });
});
