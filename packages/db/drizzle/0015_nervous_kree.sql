CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inviter_id" uuid NOT NULL,
	"invitee_id" uuid NOT NULL,
	"code" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'granted' NOT NULL,
	"reason" varchar(40) DEFAULT '' NOT NULL,
	"days" integer DEFAULT 0 NOT NULL,
	"invitee_ip" varchar(64) DEFAULT '' NOT NULL,
	"inviter_ip" varchar(64) DEFAULT '' NOT NULL,
	"device_hash" varchar(64) DEFAULT '' NOT NULL,
	"user_agent" varchar(300) DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invitee_id_users_id_fk" FOREIGN KEY ("invitee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_invitee_uq" ON "invitations" USING btree ("invitee_id");--> statement-breakpoint
CREATE INDEX "invitations_inviter_idx" ON "invitations" USING btree ("inviter_id","created_at");--> statement-breakpoint
CREATE INDEX "invitations_device_idx" ON "invitations" USING btree ("device_hash");--> statement-breakpoint
CREATE INDEX "invitations_ip_idx" ON "invitations" USING btree ("invitee_ip");--> statement-breakpoint
CREATE INDEX "invitations_created_idx" ON "invitations" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invite_codes_user_uq" ON "invite_codes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invite_codes_code_uq" ON "invite_codes" USING btree ("code");