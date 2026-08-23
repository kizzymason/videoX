CREATE TABLE "partners" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"level" varchar(16) DEFAULT 'standard' NOT NULL,
	"code_quota" integer DEFAULT 0 NOT NULL,
	"days_quota" integer DEFAULT 0 NOT NULL,
	"codes_issued" integer DEFAULT 0 NOT NULL,
	"days_issued" integer DEFAULT 0 NOT NULL,
	"note" varchar(200),
	"appointed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "partners_status_idx" ON "partners" USING btree ("status");
--> statement-breakpoint
ALTER TABLE "redeem_codes" ADD COLUMN "grant_days" integer;
--> statement-breakpoint
ALTER TABLE "redeem_codes" ADD COLUMN "sale_price_cents" integer;
--> statement-breakpoint
CREATE INDEX "redeem_codes_created_by_idx" ON "redeem_codes" USING btree ("created_by");
--> statement-breakpoint
INSERT INTO "plans" ("code", "name", "description", "duration_days", "price_cents", "is_active", "sort_order")
VALUES ('partner-custom', '合伙人订阅', '合伙人自定义天数卡密，不在前台展示。', 1, 0, false, 99)
ON CONFLICT ("code") DO NOTHING;
