ALTER TABLE "account_pools" ADD COLUMN "login_username" varchar;--> statement-breakpoint
ALTER TABLE "account_pools" ADD COLUMN "login_password_encrypted" text;--> statement-breakpoint
ALTER TABLE "account_pools" ADD COLUMN "token_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_pools" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "account_pools" ADD COLUMN "last_error" text;