CREATE TABLE "academy_attendance" (
	"id" serial PRIMARY KEY NOT NULL,
	"lesson_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"status" varchar(30) NOT NULL,
	"project_url" text,
	"note" text,
	"marked_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "academy_communications" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer,
	"student_id" integer,
	"channel" varchar(80) NOT NULL,
	"result" text,
	"comment" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "academy_courses" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"age_category" varchar(100) NOT NULL,
	"lesson_count" integer DEFAULT 0 NOT NULL,
	"lesson_duration_minutes" integer DEFAULT 120 NOT NULL,
	"frequency" varchar(255),
	"base_price_uzs" integer DEFAULT 0 NOT NULL,
	"discounted_price_uzs" integer DEFAULT 0 NOT NULL,
	"ltv_target_min_uzs" integer DEFAULT 0 NOT NULL,
	"ltv_target_max_uzs" integer DEFAULT 0 NOT NULL,
	"program" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "academy_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"course_id" integer NOT NULL,
	"teacher_id" integer,
	"schedule" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_students" integer DEFAULT 12 NOT NULL,
	"status" varchar(50) DEFAULT 'open' NOT NULL,
	"start_date" timestamp,
	"end_date" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "academy_integration_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" varchar(120) NOT NULL,
	"direction" varchar(40) NOT NULL,
	"status" varchar(50) NOT NULL,
	"payload" jsonb,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "academy_lead_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(120) NOT NULL,
	"name" varchar(255) NOT NULL,
	"channel" varchar(120),
	"campaign_name" varchar(255),
	"cost_per_lead_uzs" integer DEFAULT 0 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "academy_lead_stage_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"from_status_code" varchar(80),
	"to_status_code" varchar(80) NOT NULL,
	"entered_at" timestamp DEFAULT now(),
	"changed_by" integer,
	"comment" text
);
--> statement-breakpoint
CREATE TABLE "academy_lead_statuses" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(80) NOT NULL,
	"name" varchar(255) NOT NULL,
	"color" varchar(40) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "academy_leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_name" varchar(255) NOT NULL,
	"phone" varchar(50) NOT NULL,
	"messenger" varchar(120),
	"student_name" varchar(255),
	"student_age" integer,
	"course_id" integer,
	"source_id" integer NOT NULL,
	"advertising_campaign" varchar(255),
	"acquisition_cost_uzs" integer DEFAULT 0 NOT NULL,
	"status_code" varchar(80) DEFAULT 'new_request' NOT NULL,
	"manager_id" integer,
	"language" varchar(20) DEFAULT 'ru' NOT NULL,
	"comment" text,
	"first_contact_at" timestamp,
	"first_contact_channel" varchar(80),
	"first_contact_result" text,
	"demo_at" timestamp,
	"demo_course_id" integer,
	"demo_format" varchar(50),
	"demo_location" text,
	"demo_attended" boolean DEFAULT false NOT NULL,
	"demo_result" text,
	"offer_course_id" integer,
	"offer_price_uzs" integer,
	"offer_discount" varchar(120),
	"offer_at" timestamp,
	"enrolled_group_id" integer,
	"expected_payment_uzs" integer,
	"payment_method" varchar(80),
	"warm_reason" text,
	"warm_moved_at" timestamp,
	"no_mailing" boolean DEFAULT false NOT NULL,
	"referral_code" varchar(80),
	"referrer_student_id" integer,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "academy_lesson_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"lesson_id" integer NOT NULL,
	"from_status" varchar(50),
	"to_status" varchar(50) NOT NULL,
	"changed_by" integer,
	"comment" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "academy_lesson_surveys" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"lesson_id" integer NOT NULL,
	"group_id" integer,
	"teacher_id" integer,
	"course_id" integer,
	"score" integer NOT NULL,
	"liked" text,
	"improve" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "academy_lessons" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"course_id" integer,
	"teacher_id" integer,
	"lesson_number" integer NOT NULL,
	"topic" varchar(255) NOT NULL,
	"materials" text,
	"scheduled_at" timestamp NOT NULL,
	"duration_minutes" integer DEFAULT 120 NOT NULL,
	"status" varchar(50) DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "academy_marketing_expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer,
	"channel" varchar(120) NOT NULL,
	"campaign_name" varchar(255),
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"amount_uzs" integer NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "academy_notification_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel" varchar(80) NOT NULL,
	"recipient" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"scheduled_at" timestamp,
	"sent_at" timestamp,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"entity_type" varchar(80),
	"entity_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "academy_parent_surveys" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"group_id" integer,
	"course_id" integer,
	"progress_answer" varchar(80),
	"joy_answer" varchar(80),
	"continue_answer" varchar(80),
	"nps_score" integer,
	"comment" text,
	"period" varchar(40) NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "academy_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer,
	"student_id" integer,
	"amount_uzs" integer NOT NULL,
	"type" varchar(60) DEFAULT 'full' NOT NULL,
	"method" varchar(60) DEFAULT 'transfer' NOT NULL,
	"paid_at" timestamp,
	"period" varchar(120),
	"discount" varchar(120) DEFAULT 'none' NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"due_at" timestamp,
	"paid_until" timestamp,
	"comment" text,
	"receipt_url" text,
	"confirmed_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "academy_portfolio_projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"lesson_id" integer,
	"group_id" integer,
	"course_id" integer,
	"title" varchar(255) NOT NULL,
	"url" text,
	"file_url" text,
	"final_status" varchar(80) DEFAULT 'not_started' NOT NULL,
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "academy_referral_rewards" (
	"id" serial PRIMARY KEY NOT NULL,
	"referrer_student_id" integer NOT NULL,
	"referred_lead_id" integer,
	"referred_student_id" integer,
	"reward_type" varchar(80) NOT NULL,
	"reward_value" varchar(120) NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"applied_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "academy_student_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"from_status" varchar(50),
	"to_status" varchar(50) NOT NULL,
	"changed_by" integer,
	"comment" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "academy_student_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"from_group_id" integer,
	"to_group_id" integer,
	"reason" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "academy_students" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer,
	"group_id" integer,
	"contact_name" varchar(255) NOT NULL,
	"phone" varchar(50) NOT NULL,
	"messenger" varchar(120),
	"student_name" varchar(255),
	"student_age" integer,
	"course_id" integer,
	"manager_id" integer,
	"status" varchar(50) DEFAULT 'studying' NOT NULL,
	"enrolled_at" timestamp,
	"enrollment_date" timestamp,
	"balance_uzs" integer DEFAULT 0 NOT NULL,
	"attendance_percent" integer DEFAULT 0 NOT NULL,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"satisfaction_avg" integer DEFAULT 0 NOT NULL,
	"parent_feedback" text,
	"next_payment_at" timestamp,
	"referral_code" varchar(80) NOT NULL,
	"referral_level" varchar(50) DEFAULT 'none' NOT NULL,
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"risk_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "academy_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"responsible_id" integer,
	"deadline_at" timestamp,
	"status" varchar(50) DEFAULT 'new' NOT NULL,
	"entity_type" varchar(80),
	"entity_id" integer,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "academy_teachers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"full_name" varchar(255) NOT NULL,
	"course_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"schedule" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" varchar(255) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" integer,
	"old_values" jsonb,
	"new_values" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"sender_id" integer NOT NULL,
	"receiver_id" integer NOT NULL,
	"content" text NOT NULL,
	"is_read" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"type" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text,
	"is_read" boolean DEFAULT false,
	"related_entity_type" varchar(50),
	"related_entity_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" text,
	"description" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"password" text NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"phone" varchar(50),
	"date_of_birth" timestamp,
	"position" varchar(255),
	"role" varchar(50) DEFAULT 'employee' NOT NULL,
	"has_report_access" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"is_online" boolean DEFAULT false,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "academy_attendance" ADD CONSTRAINT "academy_attendance_lesson_id_academy_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."academy_lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_attendance" ADD CONSTRAINT "academy_attendance_student_id_academy_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."academy_students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_attendance" ADD CONSTRAINT "academy_attendance_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_communications" ADD CONSTRAINT "academy_communications_lead_id_academy_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."academy_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_communications" ADD CONSTRAINT "academy_communications_student_id_academy_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."academy_students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_communications" ADD CONSTRAINT "academy_communications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_groups" ADD CONSTRAINT "academy_groups_course_id_academy_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."academy_courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_groups" ADD CONSTRAINT "academy_groups_teacher_id_academy_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."academy_teachers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_lead_stage_history" ADD CONSTRAINT "academy_lead_stage_history_lead_id_academy_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."academy_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_lead_stage_history" ADD CONSTRAINT "academy_lead_stage_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_leads" ADD CONSTRAINT "academy_leads_course_id_academy_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."academy_courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_leads" ADD CONSTRAINT "academy_leads_source_id_academy_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."academy_lead_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_leads" ADD CONSTRAINT "academy_leads_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_leads" ADD CONSTRAINT "academy_leads_demo_course_id_academy_courses_id_fk" FOREIGN KEY ("demo_course_id") REFERENCES "public"."academy_courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_leads" ADD CONSTRAINT "academy_leads_offer_course_id_academy_courses_id_fk" FOREIGN KEY ("offer_course_id") REFERENCES "public"."academy_courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_leads" ADD CONSTRAINT "academy_leads_enrolled_group_id_academy_groups_id_fk" FOREIGN KEY ("enrolled_group_id") REFERENCES "public"."academy_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_leads" ADD CONSTRAINT "academy_leads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_lesson_status_history" ADD CONSTRAINT "academy_lesson_status_history_lesson_id_academy_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."academy_lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_lesson_status_history" ADD CONSTRAINT "academy_lesson_status_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_lesson_surveys" ADD CONSTRAINT "academy_lesson_surveys_student_id_academy_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."academy_students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_lesson_surveys" ADD CONSTRAINT "academy_lesson_surveys_lesson_id_academy_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."academy_lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_lesson_surveys" ADD CONSTRAINT "academy_lesson_surveys_group_id_academy_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."academy_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_lesson_surveys" ADD CONSTRAINT "academy_lesson_surveys_teacher_id_academy_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."academy_teachers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_lesson_surveys" ADD CONSTRAINT "academy_lesson_surveys_course_id_academy_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."academy_courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_lessons" ADD CONSTRAINT "academy_lessons_group_id_academy_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."academy_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_lessons" ADD CONSTRAINT "academy_lessons_course_id_academy_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."academy_courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_lessons" ADD CONSTRAINT "academy_lessons_teacher_id_academy_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."academy_teachers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_marketing_expenses" ADD CONSTRAINT "academy_marketing_expenses_source_id_academy_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."academy_lead_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_marketing_expenses" ADD CONSTRAINT "academy_marketing_expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_parent_surveys" ADD CONSTRAINT "academy_parent_surveys_student_id_academy_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."academy_students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_parent_surveys" ADD CONSTRAINT "academy_parent_surveys_group_id_academy_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."academy_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_parent_surveys" ADD CONSTRAINT "academy_parent_surveys_course_id_academy_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."academy_courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_payments" ADD CONSTRAINT "academy_payments_lead_id_academy_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."academy_leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_payments" ADD CONSTRAINT "academy_payments_student_id_academy_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."academy_students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_payments" ADD CONSTRAINT "academy_payments_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_portfolio_projects" ADD CONSTRAINT "academy_portfolio_projects_student_id_academy_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."academy_students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_portfolio_projects" ADD CONSTRAINT "academy_portfolio_projects_lesson_id_academy_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."academy_lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_portfolio_projects" ADD CONSTRAINT "academy_portfolio_projects_group_id_academy_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."academy_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_portfolio_projects" ADD CONSTRAINT "academy_portfolio_projects_course_id_academy_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."academy_courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_referral_rewards" ADD CONSTRAINT "academy_referral_rewards_referrer_student_id_academy_students_id_fk" FOREIGN KEY ("referrer_student_id") REFERENCES "public"."academy_students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_referral_rewards" ADD CONSTRAINT "academy_referral_rewards_referred_lead_id_academy_leads_id_fk" FOREIGN KEY ("referred_lead_id") REFERENCES "public"."academy_leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_referral_rewards" ADD CONSTRAINT "academy_referral_rewards_referred_student_id_academy_students_id_fk" FOREIGN KEY ("referred_student_id") REFERENCES "public"."academy_students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_student_status_history" ADD CONSTRAINT "academy_student_status_history_student_id_academy_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."academy_students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_student_status_history" ADD CONSTRAINT "academy_student_status_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_student_transfers" ADD CONSTRAINT "academy_student_transfers_student_id_academy_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."academy_students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_student_transfers" ADD CONSTRAINT "academy_student_transfers_from_group_id_academy_groups_id_fk" FOREIGN KEY ("from_group_id") REFERENCES "public"."academy_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_student_transfers" ADD CONSTRAINT "academy_student_transfers_to_group_id_academy_groups_id_fk" FOREIGN KEY ("to_group_id") REFERENCES "public"."academy_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_student_transfers" ADD CONSTRAINT "academy_student_transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_students" ADD CONSTRAINT "academy_students_lead_id_academy_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."academy_leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_students" ADD CONSTRAINT "academy_students_group_id_academy_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."academy_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_students" ADD CONSTRAINT "academy_students_course_id_academy_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."academy_courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_students" ADD CONSTRAINT "academy_students_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_tasks" ADD CONSTRAINT "academy_tasks_responsible_id_users_id_fk" FOREIGN KEY ("responsible_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academy_teachers" ADD CONSTRAINT "academy_teachers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_receiver_id_users_id_fk" FOREIGN KEY ("receiver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "academy_attendance_lesson_student_unique" ON "academy_attendance" USING btree ("lesson_id","student_id");--> statement-breakpoint
CREATE INDEX "academy_communications_lead_idx" ON "academy_communications" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "academy_communications_student_idx" ON "academy_communications" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "academy_courses_slug_unique" ON "academy_courses" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "academy_groups_course_idx" ON "academy_groups" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "academy_groups_teacher_idx" ON "academy_groups" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "academy_integration_logs_provider_idx" ON "academy_integration_logs" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX "academy_lead_sources_code_unique" ON "academy_lead_sources" USING btree ("code");--> statement-breakpoint
CREATE INDEX "academy_lead_stage_history_lead_idx" ON "academy_lead_stage_history" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "academy_lead_statuses_code_unique" ON "academy_lead_statuses" USING btree ("code");--> statement-breakpoint
CREATE INDEX "academy_leads_phone_idx" ON "academy_leads" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "academy_leads_status_idx" ON "academy_leads" USING btree ("status_code");--> statement-breakpoint
CREATE INDEX "academy_leads_manager_idx" ON "academy_leads" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "academy_leads_source_idx" ON "academy_leads" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "academy_lesson_status_history_lesson_idx" ON "academy_lesson_status_history" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "academy_lesson_surveys_lesson_idx" ON "academy_lesson_surveys" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "academy_lessons_group_idx" ON "academy_lessons" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "academy_lessons_teacher_idx" ON "academy_lessons" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "academy_marketing_expenses_source_idx" ON "academy_marketing_expenses" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "academy_notification_outbox_status_idx" ON "academy_notification_outbox" USING btree ("status");--> statement-breakpoint
CREATE INDEX "academy_parent_surveys_student_idx" ON "academy_parent_surveys" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "academy_payments_student_idx" ON "academy_payments" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "academy_payments_lead_idx" ON "academy_payments" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "academy_payments_status_idx" ON "academy_payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "academy_portfolio_projects_student_idx" ON "academy_portfolio_projects" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "academy_referral_rewards_referrer_idx" ON "academy_referral_rewards" USING btree ("referrer_student_id");--> statement-breakpoint
CREATE INDEX "academy_referral_rewards_referred_lead_idx" ON "academy_referral_rewards" USING btree ("referred_lead_id");--> statement-breakpoint
CREATE INDEX "academy_student_status_history_student_idx" ON "academy_student_status_history" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "academy_student_transfers_student_idx" ON "academy_student_transfers" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "academy_students_phone_idx" ON "academy_students" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "academy_students_group_idx" ON "academy_students" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "academy_students_lead_idx" ON "academy_students" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "academy_students_manager_idx" ON "academy_students" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "academy_students_status_idx" ON "academy_students" USING btree ("status");--> statement-breakpoint
CREATE INDEX "academy_tasks_responsible_idx" ON "academy_tasks" USING btree ("responsible_id");--> statement-breakpoint
CREATE INDEX "academy_tasks_entity_idx" ON "academy_tasks" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "system_settings_key_unique" ON "system_settings" USING btree ("key");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");
