CREATE TABLE IF NOT EXISTS "card_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reference" varchar(40) NOT NULL,
	"upstream_order_no" varchar(64),
	"product_id" varchar(64) NOT NULL,
	"product_name" varchar(80) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"email" varchar(160),
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"codes_encrypted" text,
	"paid_at" timestamp with time zone,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_purchases" ADD CONSTRAINT "card_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "card_purchases_reference_uq" ON "card_purchases" USING btree ("reference");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "card_purchases_upstream_uq" ON "card_purchases" USING btree ("upstream_order_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_purchases_user_idx" ON "card_purchases" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_purchases_status_idx" ON "card_purchases" USING btree ("status");
