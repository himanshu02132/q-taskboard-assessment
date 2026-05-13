-- Fix email uniqueness (Issue #3)
ALTER TABLE "users" ADD CONSTRAINT "users_email_key" UNIQUE ("email");

-- Comments table (Part 3a)
CREATE TABLE "comments" (
    "id"         TEXT NOT NULL,
    "task_id"    TEXT NOT NULL,
    "author_id"  TEXT NOT NULL,
    "body"       TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "comments_task_id_idx" ON "comments"("task_id");

ALTER TABLE "comments"
    ADD CONSTRAINT "comments_task_id_fkey"
        FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "comments"
    ADD CONSTRAINT "comments_author_id_fkey"
        FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Activity events table (Part 3b)
CREATE TABLE "activity_events" (
    "id"          TEXT NOT NULL,
    "project_id"  TEXT NOT NULL,
    "actor_id"    TEXT NOT NULL,
    "type"        TEXT NOT NULL,
    "task_id"     TEXT,
    "meta"        JSONB,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "activity_events_project_id_created_at_idx"
    ON "activity_events"("project_id", "created_at" DESC);

ALTER TABLE "activity_events"
    ADD CONSTRAINT "activity_events_project_id_fkey"
        FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "activity_events"
    ADD CONSTRAINT "activity_events_actor_id_fkey"
        FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
