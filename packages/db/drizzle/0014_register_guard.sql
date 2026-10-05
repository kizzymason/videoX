CREATE TABLE "register_guards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(16) NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"user_id" uuid,
	"ip" varchar(64) DEFAULT '' NOT NULL,
	"user_agent" varchar(300) DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
ALTER TABLE "register_guards" ADD CONSTRAINT "register_guards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "register_guards_lookup_idx" ON "register_guards" USING btree ("kind","fingerprint","expires_at");--> statement-breakpoint
CREATE INDEX "register_guards_user_idx" ON "register_guards" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "register_guards_expires_idx" ON "register_guards" USING btree ("expires_at");
