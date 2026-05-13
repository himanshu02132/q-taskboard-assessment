import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  unauthorized,
  forbidden,
  badRequest,
  getProjectMembership,
  canEditTasks,
} from "@/lib/auth";
import { exportTasksToAirtable, type ExportRecord } from "@/lib/airtable-client";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: projectId } = await params;

  const membership = await getProjectMembership(user.id, projectId);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) {
    return forbidden("only admins and members can trigger an export");
  }

  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    return badRequest("Airtable credentials are not configured on the server");
  }

  const tasks = await prisma.task.findMany({
    where: { projectId },
    include: { assignee: { select: { name: true } } },
    orderBy: { position: "asc" },
  });

  if (tasks.length === 0) {
    return NextResponse.json({ ok: true, succeeded: 0, failed: 0, errors: [] });
  }

  const records: ExportRecord[] = tasks.map((t) => ({
    taskId: t.id,
    fields: {
      "Task ID": t.id,
      Title: t.title,
      Description: t.description ?? "",
      Status: t.status,
      Assignee: t.assignee?.name ?? "Unassigned",
      "Created At": t.createdAt.toISOString(),
    },
  }));

  const result = await exportTasksToAirtable(records);

  return NextResponse.json({ ok: true, ...result });
}
