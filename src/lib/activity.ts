import { prisma } from "./prisma";

export type ActivityType =
  | "task_created"
  | "status_changed"
  | "assignee_changed"
  | "comment_added";

export interface LogActivityInput {
  projectId: string;
  actorId: string;
  type: ActivityType;
  taskId?: string;
  meta?: Record<string, unknown>;
}

/**
 * Write an activity event.  Always call with .catch(() => {}) at the call
 * site — activity logging is best-effort and must never roll back the
 * primary operation if it fails.
 */
export function logActivity(input: LogActivityInput): Promise<void> {
  return prisma.activityEvent
    .create({
      data: {
        projectId: input.projectId,
        actorId: input.actorId,
        type: input.type,
        taskId: input.taskId ?? null,
        meta: input.meta ?? {},
      },
    })
    .then(() => undefined);
}
