CREATE TABLE IF NOT EXISTS "video_seo" (
	"video_id" uuid PRIMARY KEY NOT NULL,
	"seo_title" varchar(200),
	"seo_description" varchar(500),
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" varchar(16) DEFAULT 'ai' NOT NULL,
	"ai_model" varchar(80),
	"generated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "seo_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engine" varchar(20) NOT NULL,
	"url" varchar(600) NOT NULL,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"http_status" integer,
	"response" text,
	"trigger" varchar(16) DEFAULT 'auto' NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "video_seo" ADD CONSTRAINT "video_seo_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "video_seo_generated_idx" ON "video_seo" USING btree ("generated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "seo_submissions_engine_url_uq" ON "seo_submissions" USING btree ("engine","url");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_submissions_status_idx" ON "seo_submissions" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_submissions_created_idx" ON "seo_submissions" USING btree ("created_at");
