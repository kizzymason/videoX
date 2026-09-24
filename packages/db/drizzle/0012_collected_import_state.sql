ALTER TABLE "collected_videos" ADD COLUMN IF NOT EXISTS "import_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "collected_videos" ADD COLUMN IF NOT EXISTS "import_error" text;
--> statement-breakpoint
ALTER TABLE "collected_videos" ADD COLUMN IF NOT EXISTS "last_import_attempt_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collected_videos_import_queue_idx" ON "collected_videos" USING btree ("target_site","status","import_attempts","created_at");
