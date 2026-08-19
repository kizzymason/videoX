ALTER TABLE "videos" ADD COLUMN "kind" varchar(16) DEFAULT 'vod' NOT NULL;--> statement-breakpoint
UPDATE "videos" SET "kind" = 'shorts' WHERE "width" IS NOT NULL AND "height" IS NOT NULL AND "height" > "width";--> statement-breakpoint
CREATE INDEX "videos_kind_idx" ON "videos" USING btree ("kind");
