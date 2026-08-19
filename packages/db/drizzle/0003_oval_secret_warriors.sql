CREATE TABLE "account_pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_site" varchar NOT NULL,
	"uid" varchar NOT NULL,
	"token" varchar NOT NULL,
	"username" varchar,
	"is_vip" boolean DEFAULT false NOT NULL,
	"vip_expires_at" timestamp with time zone,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_check_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collected_videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" varchar NOT NULL,
	"target_site" varchar NOT NULL,
	"source_key" varchar(500),
	"video_id" uuid,
	"title" varchar(200) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"page" integer DEFAULT 1 NOT NULL,
	"fetch_url" varchar(500),
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"import_mode" varchar(20),
	"local_video_url" varchar(500),
	"external_play_url" varchar(500),
	"metadata" jsonb,
	"last_fetched_at" timestamp with time zone,
	"imported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_configs" (
	"key" varchar(60) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" varchar NOT NULL,
	"type" varchar(32) NOT NULL,
	"target_site" varchar NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"level" varchar(10) NOT NULL,
	"message" text NOT NULL,
	"context" jsonb,
	"account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "videos" ALTER COLUMN "access_level" SET DEFAULT 'vip';--> statement-breakpoint
ALTER TABLE "collected_videos" ADD CONSTRAINT "collected_videos_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_logs" ADD CONSTRAINT "collection_logs_job_id_collection_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."collection_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_logs" ADD CONSTRAINT "collection_logs_account_id_account_pools_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account_pools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_pools_target_site_idx" ON "account_pools" USING btree ("target_site");--> statement-breakpoint
CREATE INDEX "account_pools_target_uid_idx" ON "account_pools" USING btree ("target_site","uid");--> statement-breakpoint
CREATE INDEX "account_pools_status_idx" ON "account_pools" USING btree ("status");--> statement-breakpoint
CREATE INDEX "account_pools_vip_idx" ON "account_pools" USING btree ("is_vip");--> statement-breakpoint
CREATE UNIQUE INDEX "collected_videos_external_site_uq" ON "collected_videos" USING btree ("external_id","target_site");--> statement-breakpoint
CREATE INDEX "collected_videos_status_idx" ON "collected_videos" USING btree ("status");--> statement-breakpoint
CREATE INDEX "collected_videos_video_idx" ON "collected_videos" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "collected_videos_target_site_idx" ON "collected_videos" USING btree ("target_site");--> statement-breakpoint
CREATE INDEX "collected_videos_kind_idx" ON "collected_videos" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "collection_jobs_status_idx" ON "collection_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "collection_jobs_next_run_idx" ON "collection_jobs" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "collection_jobs_type_idx" ON "collection_jobs" USING btree ("type");--> statement-breakpoint
CREATE INDEX "collection_jobs_target_site_idx" ON "collection_jobs" USING btree ("target_site");--> statement-breakpoint
CREATE INDEX "collection_logs_job_idx" ON "collection_logs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "collection_logs_level_idx" ON "collection_logs" USING btree ("level");--> statement-breakpoint
CREATE INDEX "collection_logs_created_idx" ON "collection_logs" USING btree ("created_at");
