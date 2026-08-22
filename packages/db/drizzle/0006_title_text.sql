ALTER TABLE "collected_videos" ALTER COLUMN "title" SET DATA TYPE text;--> statement-breakpoint
-- videos.title 被生成列 search_vector 引用，先拆掉再改类型；post-migrate.sql 会重建。
ALTER TABLE "videos" DROP COLUMN IF EXISTS "search_vector";--> statement-breakpoint
ALTER TABLE "videos" ALTER COLUMN "title" SET DATA TYPE text;
