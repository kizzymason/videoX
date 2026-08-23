CREATE TABLE "home_recommend_pins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "home_recommend_keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"keyword" varchar(80) NOT NULL,
	"direction" varchar(16) NOT NULL,
	"weight" double precision DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "home_recommend_pins" ADD CONSTRAINT "home_recommend_pins_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "home_recommend_pins" ADD CONSTRAINT "home_recommend_pins_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "home_recommend_pins_video_uq" ON "home_recommend_pins" USING btree ("video_id");
--> statement-breakpoint
CREATE INDEX "home_recommend_pins_sort_idx" ON "home_recommend_pins" USING btree ("sort_order");
--> statement-breakpoint
CREATE UNIQUE INDEX "home_recommend_keywords_keyword_uq" ON "home_recommend_keywords" USING btree ("keyword");
