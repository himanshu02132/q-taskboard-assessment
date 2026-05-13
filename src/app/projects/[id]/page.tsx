"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, getToken, getStoredUser } from "@/lib/api-client";
import { Header } from "@/components/Header";
import { StatusColumn } from "@/components/StatusColumn";
import { TaskDetail } from "@/components/TaskDetail";
import type { ApiProjectDetail, ApiTask, ApiActivityEvent, TaskStatus } from "@/types";
import { STATUS_ORDER } from "@/types";

type PageProps = { params: Promise<{ id: string }> };

function activityLabel(event: ApiActivityEvent): string {
  const meta = event.meta ?? {};
  switch (event.type) {
    case "task_created":
      return `created task "${meta.title}"`;
    case "status_changed":
      return `moved "${meta.title}" from ${meta.from} → ${meta.to}`;
    case "assignee_changed":
      return `changed assignee on "${meta.title}"`;
    case "comment_added":
      return `commented on "${meta.taskTitle}"`;
    default:
      return event.type;
  }
}

export default function ProjectPage({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params);
  const queryClient = useQueryClient();

  const [activeTask, setActiveTask] = useState<ApiTask | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newColumn, setNewColumn] = useState<TaskStatus>("todo");
  const [error, setError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const storedUser = getStoredUser();

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ["project", id],
    queryFn: () => apiFetch<{ project: ApiProjectDetail }>(`/api/projects/${id}`),
  });

  const { data: activityData } = useQuery({
    queryKey: ["activity", id],
    queryFn: () => apiFetch<{ events: ApiActivityEvent[] }>(`/api/projects/${id}/activity`),
    refetchInterval: 30000,
  });

  const createTask = useMutation({
    mutationFn: (input: { title: string; status: TaskStatus }) =>
      apiFetch<{ task: ApiTask }>(`/api/projects/${id}/tasks`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      setNewTitle("");
      queryClient.invalidateQueries({ queryKey: ["project", id] });
      queryClient.invalidateQueries({ queryKey: ["activity", id] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "create failed"),
  });

  const exportTasks = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; succeeded: number; failed: number; errors: unknown[] }>(
        `/api/projects/${id}/export`,
        { method: "POST" },
      ),
    onSuccess: (res) => {
      setExportStatus(
        `Export complete — ${res.succeeded} succeeded, ${res.failed} failed`,
      );
    },
    onError: (err) =>
      setExportStatus(`Export failed: ${err instanceof Error ? err.message : "unknown error"}`),
  });

  const project = data?.project;
  const tasksByStatus: Record<TaskStatus, ApiTask[]> = {
    todo: [],
    in_progress: [],
    review: [],
    done: [],
  };
  if (project) {
    for (const t of project.tasks) {
      tasksByStatus[t.status].push(t);
    }
  }

  const currentMembership = project?.memberships.find(
    (m) => m.user.id === storedUser?.id,
  );
  const userRole = currentMembership?.role ?? "viewer";
  const canExport = userRole === "admin" || userRole === "member";

  return (
    <div className="min-h-screen">
      <Header />

      <main className="max-w-7xl mx-auto px-6 py-8">
        <Link href="/dashboard" className="text-sm text-muted hover:text-white">
          ← all projects
        </Link>

        {isLoading && <p className="text-muted text-sm mt-6">loading…</p>}
        {queryError && (
          <p className="text-sm text-red-400 mt-6">
            {queryError instanceof Error ? queryError.message : "failed to load"}
          </p>
        )}

        {project && (
          <>
            <div className="flex items-start justify-between mt-4 mb-8">
              <div>
                <h1 className="text-2xl font-semibold">{project.name}</h1>
                {project.description && (
                  <p className="text-sm text-muted mt-1 max-w-2xl">{project.description}</p>
                )}
                <p className="text-xs text-muted mt-2">
                  owner: {project.owner.name} · {project.memberships.length} members
                </p>
              </div>
              {canExport && (
                <div className="flex flex-col items-end gap-1">
                  <button
                    onClick={() => {
                      setExportStatus(null);
                      exportTasks.mutate();
                    }}
                    disabled={exportTasks.isPending}
                    className="text-sm px-4 py-2 rounded-md border border-border hover:border-accent disabled:opacity-50"
                  >
                    {exportTasks.isPending ? "exporting…" : "export to Airtable"}
                  </button>
                  {exportStatus && (
                    <p className="text-xs text-muted">{exportStatus}</p>
                  )}
                </div>
              )}
            </div>

            {(userRole === "admin" || userRole === "member") && (
              <section className="bg-surface border border-border rounded-lg p-4 mb-6">
                <h2 className="text-sm font-medium mb-3">add a task</h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newTitle.trim()) return;
                    setError(null);
                    createTask.mutate({ title: newTitle.trim(), status: newColumn });
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="task title"
                    className="flex-1 rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  />
                  <select
                    value={newColumn}
                    onChange={(e) => setNewColumn(e.target.value as TaskStatus)}
                    className="rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  >
                    {STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={createTask.isPending}
                    className="bg-accent hover:bg-indigo-500 text-white text-sm font-medium rounded-md px-4 disabled:opacity-50"
                  >
                    add
                  </button>
                </form>
                {error && <p className="text-sm text-red-400 mt-2" role="alert">{error}</p>}
              </section>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {STATUS_ORDER.map((s) => (
                <StatusColumn
                  key={s}
                  status={s}
                  tasks={tasksByStatus[s]}
                  onTaskClick={setActiveTask}
                />
              ))}
            </div>

            {/* Activity Feed */}
            <section className="mt-10">
              <h2 className="text-sm font-medium mb-3">recent activity</h2>
              {!activityData || activityData.events.length === 0 ? (
                <p className="text-xs text-muted">no activity yet</p>
              ) : (
                <ul className="bg-surface border border-border rounded-lg divide-y divide-border">
                  {activityData.events.map((ev) => (
                    <li key={ev.id} className="px-4 py-3 flex items-center justify-between text-sm">
                      <span>
                        <span className="font-medium">{ev.actor.name}</span>{" "}
                        {activityLabel(ev)}
                      </span>
                      <span className="text-xs text-muted ml-4 shrink-0">
                        {new Date(ev.createdAt).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="mt-10">
              <h2 className="text-sm font-medium mb-3">members</h2>
              <ul className="bg-surface border border-border rounded-lg divide-y divide-border">
                {project.memberships.map((m) => (
                  <li key={m.id} className="px-4 py-3 flex items-center justify-between text-sm">
                    <span>{m.user.name}</span>
                    <span className="text-xs text-muted">{m.user.email} · {m.role}</span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>

      {activeTask && project && (
        <TaskDetail
          task={activeTask}
          projectId={id}
          members={project.memberships}
          userRole={userRole}
          onClose={() => {
            setActiveTask(null);
            queryClient.invalidateQueries({ queryKey: ["activity", id] });
          }}
        />
      )}
    </div>
  );
}
