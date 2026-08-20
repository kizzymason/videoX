CREATE TABLE "collection_ai_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid,
	"user_id" uuid,
	"title" varchar(120) DEFAULT '新会话' NOT NULL,
	"status" varchar(20) DEFAULT 'idle' NOT NULL,
	"auto_approve" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_ai_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" varchar(16) NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"tool_calls" jsonb,
	"tool_call_id" varchar(80),
	"tool_name" varchar(60),
	"tool_status" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_ai_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(60) NOT NULL,
	"endpoint" varchar(300) NOT NULL,
	"model" varchar(80) NOT NULL,
	"api_key" text DEFAULT '' NOT NULL,
	"system_prompt" text DEFAULT '' NOT NULL,
	"temperature" real DEFAULT 0.2 NOT NULL,
	"max_steps" integer DEFAULT 8 NOT NULL,
	"auto_approve" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collection_ai_conversations" ADD CONSTRAINT "collection_ai_conversations_profile_id_collection_ai_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."collection_ai_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_ai_conversations" ADD CONSTRAINT "collection_ai_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_ai_messages" ADD CONSTRAINT "collection_ai_messages_conversation_id_collection_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."collection_ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_ai_conversations_user_idx" ON "collection_ai_conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "collection_ai_conversations_updated_idx" ON "collection_ai_conversations" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "collection_ai_messages_conv_idx" ON "collection_ai_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "collection_ai_messages_status_idx" ON "collection_ai_messages" USING btree ("tool_status");--> statement-breakpoint
CREATE INDEX "collection_ai_profiles_active_idx" ON "collection_ai_profiles" USING btree ("is_active");