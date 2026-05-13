import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  unauthorized,
  forbidden,
  notFound,
  badRequest,
  getProjectMembership,
  canEditTasks,
} from "@/lib/auth";
import { updateTaskSchema } from "@/schemas/task";
import { logActivity } from "@/lib/activity";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = updateTaskSchema.safeParse(body);
  if (!parsed.success) return badRequest("invalid input", parsed.error.flatten());

  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) return notFound("task not found");

  const membership = await getProjectMembership(user.id, existing.projectId);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) return forbidden("viewers cannot edit tasks");

  const task = await prisma.task.update({
    where: { id },
    data: parsed.data,
    include: {
      assignee: { select: { id: true, name: true, email: true } },
    },
  });

  if (parsed.data.status && parsed.data.status !== existing.status) {
    logActivity({
      projectId: existing.projectId,
      actorId: user.id,
      type: "status_changed",
      taskId: id,
      meta: { from: existing.status, to: parsed.data.status, title: existing.title },
    }).catch(() => {});
  }
  if (
    "assigneeId" in parsed.data &&
    parsed.data.assigneeId !== existing.assigneeId
  ) {
    logActivity({
      projectId: existing.projectId,
      actorId: user.id,
      type: "assignee_changed",
      taskId: id,
      meta: {
        from: existing.assigneeId ?? null,
        to: parsed.data.assigneeId ?? null,
        title: existing.title,
      },
    }).catch(() => {});
  }

  return NextResponse.json({ task });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id } = await params;

  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) return notFound("task not found");

  const membership = await getProjectMembership(user.id, existing.projectId);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) {
    return forbidden("viewers cannot delete tasks");
  }

  await prisma.task.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
