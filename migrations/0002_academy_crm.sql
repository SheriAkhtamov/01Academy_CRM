CREATE TABLE IF NOT EXISTS "academy_courses" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "name" varchar(255) NOT NULL,
  "slug" varchar(100) NOT NULL,
  "age_category" varchar(100) NOT NULL,
  "lesson_count" integer NOT NULL DEFAULT 0,
  "lesson_duration_minutes" integer NOT NULL DEFAULT 120,
  "frequency" varchar(255),
  "base_price_uzs" integer NOT NULL DEFAULT 0,
  "discounted_price_uzs" integer NOT NULL DEFAULT 0,
  "ltv_target_min_uzs" integer NOT NULL DEFAULT 0,
  "ltv_target_max_uzs" integer NOT NULL DEFAULT 0,
  "program" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_courses_workspace_slug_unique" ON "academy_courses" ("workspace_id", "slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_courses_workspace_idx" ON "academy_courses" ("workspace_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_lead_sources" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "code" varchar(120) NOT NULL,
  "name" varchar(255) NOT NULL,
  "channel" varchar(120),
  "campaign_name" varchar(255),
  "cost_per_lead_uzs" integer NOT NULL DEFAULT 0,
  "is_system" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_lead_sources_workspace_code_unique" ON "academy_lead_sources" ("workspace_id", "code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_lead_sources_workspace_idx" ON "academy_lead_sources" ("workspace_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_lead_statuses" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "code" varchar(80) NOT NULL,
  "name" varchar(255) NOT NULL,
  "color" varchar(40) NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_system" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_lead_statuses_workspace_code_unique" ON "academy_lead_statuses" ("workspace_id", "code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_lead_statuses_workspace_idx" ON "academy_lead_statuses" ("workspace_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_teachers" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "full_name" varchar(255) NOT NULL,
  "course_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "schedule" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" varchar(50) NOT NULL DEFAULT 'active',
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_teachers_workspace_idx" ON "academy_teachers" ("workspace_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_groups" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "name" varchar(255) NOT NULL,
  "course_id" integer NOT NULL REFERENCES "academy_courses"("id") ON DELETE restrict,
  "teacher_id" integer REFERENCES "academy_teachers"("id") ON DELETE set null,
  "schedule" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "max_students" integer NOT NULL DEFAULT 12,
  "status" varchar(50) NOT NULL DEFAULT 'open',
  "start_date" timestamp,
  "end_date" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_groups_workspace_idx" ON "academy_groups" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_groups_course_idx" ON "academy_groups" ("course_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_groups_teacher_idx" ON "academy_groups" ("teacher_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_leads" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "contact_name" varchar(255) NOT NULL,
  "phone" varchar(50) NOT NULL,
  "messenger" varchar(120),
  "student_name" varchar(255),
  "student_age" integer,
  "course_id" integer REFERENCES "academy_courses"("id") ON DELETE set null,
  "source_id" integer NOT NULL REFERENCES "academy_lead_sources"("id") ON DELETE restrict,
  "advertising_campaign" varchar(255),
  "acquisition_cost_uzs" integer NOT NULL DEFAULT 0,
  "status_code" varchar(80) NOT NULL DEFAULT 'new_request',
  "manager_id" integer REFERENCES "users"("id") ON DELETE set null,
  "language" varchar(20) NOT NULL DEFAULT 'ru',
  "comment" text,
  "first_contact_at" timestamp,
  "first_contact_channel" varchar(80),
  "first_contact_result" text,
  "demo_at" timestamp,
  "demo_course_id" integer REFERENCES "academy_courses"("id") ON DELETE set null,
  "demo_format" varchar(50),
  "demo_location" text,
  "demo_attended" boolean NOT NULL DEFAULT false,
  "demo_result" text,
  "offer_course_id" integer REFERENCES "academy_courses"("id") ON DELETE set null,
  "offer_price_uzs" integer,
  "offer_discount" varchar(120),
  "offer_at" timestamp,
  "enrolled_group_id" integer REFERENCES "academy_groups"("id") ON DELETE set null,
  "expected_payment_uzs" integer,
  "payment_method" varchar(80),
  "warm_reason" text,
  "warm_moved_at" timestamp,
  "no_mailing" boolean NOT NULL DEFAULT false,
  "referral_code" varchar(80),
  "referrer_student_id" integer,
  "created_by" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_leads_workspace_idx" ON "academy_leads" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_leads_phone_idx" ON "academy_leads" ("phone");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_leads_workspace_phone_unique" ON "academy_leads" ("workspace_id", "phone") WHERE "phone" <> '';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_leads_status_idx" ON "academy_leads" ("status_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_leads_manager_idx" ON "academy_leads" ("manager_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_leads_source_idx" ON "academy_leads" ("source_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_lead_stage_history" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "lead_id" integer NOT NULL REFERENCES "academy_leads"("id") ON DELETE cascade,
  "from_status_code" varchar(80),
  "to_status_code" varchar(80) NOT NULL,
  "entered_at" timestamp DEFAULT now(),
  "changed_by" integer REFERENCES "users"("id") ON DELETE set null,
  "comment" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_lead_stage_history_lead_idx" ON "academy_lead_stage_history" ("lead_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_students" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "lead_id" integer REFERENCES "academy_leads"("id") ON DELETE set null,
  "contact_name" varchar(255) NOT NULL,
  "phone" varchar(50) NOT NULL,
  "messenger" varchar(120),
  "student_name" varchar(255) NOT NULL,
  "age" integer,
  "course_id" integer REFERENCES "academy_courses"("id") ON DELETE set null,
  "group_id" integer REFERENCES "academy_groups"("id") ON DELETE set null,
  "manager_id" integer REFERENCES "users"("id") ON DELETE set null,
  "enrolled_at" timestamp DEFAULT now(),
  "status" varchar(50) NOT NULL DEFAULT 'studying',
  "attendance_percent" integer NOT NULL DEFAULT 0,
  "progress_percent" integer NOT NULL DEFAULT 0,
  "satisfaction_avg" integer NOT NULL DEFAULT 0,
  "parent_feedback" text,
  "next_payment_at" timestamp,
  "referral_code" varchar(80) NOT NULL,
  "marketing_consent" boolean NOT NULL DEFAULT false,
  "risk_flags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_students_workspace_idx" ON "academy_students" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_students_phone_idx" ON "academy_students" ("phone");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_students_workspace_phone_unique" ON "academy_students" ("workspace_id", "phone") WHERE "phone" <> '';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_students_group_idx" ON "academy_students" ("group_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_students_referral_unique" ON "academy_students" ("workspace_id", "referral_code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_student_status_history" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "student_id" integer NOT NULL REFERENCES "academy_students"("id") ON DELETE cascade,
  "from_status" varchar(50),
  "to_status" varchar(50) NOT NULL,
  "changed_by" integer REFERENCES "users"("id") ON DELETE set null,
  "comment" text,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_student_status_history_student_idx" ON "academy_student_status_history" ("student_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_lessons" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "group_id" integer NOT NULL REFERENCES "academy_groups"("id") ON DELETE cascade,
  "course_id" integer REFERENCES "academy_courses"("id") ON DELETE set null,
  "teacher_id" integer REFERENCES "academy_teachers"("id") ON DELETE set null,
  "lesson_number" integer NOT NULL,
  "topic" varchar(255) NOT NULL,
  "materials" text,
  "scheduled_at" timestamp NOT NULL,
  "duration_minutes" integer NOT NULL DEFAULT 120,
  "status" varchar(50) NOT NULL DEFAULT 'scheduled',
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_lessons_workspace_idx" ON "academy_lessons" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_lessons_group_idx" ON "academy_lessons" ("group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_lessons_teacher_idx" ON "academy_lessons" ("teacher_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_lesson_status_history" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "lesson_id" integer NOT NULL REFERENCES "academy_lessons"("id") ON DELETE cascade,
  "from_status" varchar(50),
  "to_status" varchar(50) NOT NULL,
  "changed_by" integer REFERENCES "users"("id") ON DELETE set null,
  "comment" text,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_lesson_status_history_lesson_idx" ON "academy_lesson_status_history" ("lesson_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_attendance" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "lesson_id" integer NOT NULL REFERENCES "academy_lessons"("id") ON DELETE cascade,
  "student_id" integer NOT NULL REFERENCES "academy_students"("id") ON DELETE cascade,
  "status" varchar(30) NOT NULL,
  "project_url" text,
  "note" text,
  "marked_by" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academy_attendance_lesson_student_unique" ON "academy_attendance" ("lesson_id", "student_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_attendance_workspace_idx" ON "academy_attendance" ("workspace_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_payments" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "lead_id" integer REFERENCES "academy_leads"("id") ON DELETE set null,
  "student_id" integer REFERENCES "academy_students"("id") ON DELETE set null,
  "amount_uzs" integer NOT NULL,
  "type" varchar(60) NOT NULL DEFAULT 'full',
  "method" varchar(60) NOT NULL DEFAULT 'transfer',
  "paid_at" timestamp,
  "period" varchar(120),
  "discount" varchar(120) NOT NULL DEFAULT 'none',
  "status" varchar(50) NOT NULL DEFAULT 'pending',
  "due_at" timestamp,
  "paid_until" timestamp,
  "comment" text,
  "receipt_url" text,
  "confirmed_by" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_payments_workspace_idx" ON "academy_payments" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_payments_student_idx" ON "academy_payments" ("student_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_payments_lead_idx" ON "academy_payments" ("lead_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_payments_status_idx" ON "academy_payments" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_tasks" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "title" varchar(255) NOT NULL,
  "description" text,
  "responsible_id" integer REFERENCES "users"("id") ON DELETE set null,
  "deadline_at" timestamp,
  "status" varchar(50) NOT NULL DEFAULT 'new',
  "entity_type" varchar(80),
  "entity_id" integer,
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_tasks_workspace_idx" ON "academy_tasks" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_tasks_responsible_idx" ON "academy_tasks" ("responsible_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_tasks_entity_idx" ON "academy_tasks" ("entity_type", "entity_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_communications" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "lead_id" integer REFERENCES "academy_leads"("id") ON DELETE cascade,
  "student_id" integer REFERENCES "academy_students"("id") ON DELETE cascade,
  "channel" varchar(80) NOT NULL,
  "result" text,
  "comment" text,
  "created_by" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_communications_lead_idx" ON "academy_communications" ("lead_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_communications_student_idx" ON "academy_communications" ("student_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_student_transfers" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "student_id" integer NOT NULL REFERENCES "academy_students"("id") ON DELETE cascade,
  "from_group_id" integer REFERENCES "academy_groups"("id") ON DELETE set null,
  "to_group_id" integer REFERENCES "academy_groups"("id") ON DELETE set null,
  "reason" text,
  "created_by" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_student_transfers_student_idx" ON "academy_student_transfers" ("student_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_lesson_surveys" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "student_id" integer NOT NULL REFERENCES "academy_students"("id") ON DELETE cascade,
  "lesson_id" integer NOT NULL REFERENCES "academy_lessons"("id") ON DELETE cascade,
  "group_id" integer REFERENCES "academy_groups"("id") ON DELETE set null,
  "teacher_id" integer REFERENCES "academy_teachers"("id") ON DELETE set null,
  "course_id" integer REFERENCES "academy_courses"("id") ON DELETE set null,
  "score" integer NOT NULL,
  "liked" text,
  "improve" text,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_lesson_surveys_workspace_idx" ON "academy_lesson_surveys" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_lesson_surveys_lesson_idx" ON "academy_lesson_surveys" ("lesson_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_parent_surveys" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "student_id" integer NOT NULL REFERENCES "academy_students"("id") ON DELETE cascade,
  "group_id" integer REFERENCES "academy_groups"("id") ON DELETE set null,
  "course_id" integer REFERENCES "academy_courses"("id") ON DELETE set null,
  "progress_answer" varchar(80),
  "joy_answer" varchar(80),
  "continue_answer" varchar(80),
  "nps_score" integer,
  "comment" text,
  "period" varchar(40) NOT NULL,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_parent_surveys_workspace_idx" ON "academy_parent_surveys" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_parent_surveys_student_idx" ON "academy_parent_surveys" ("student_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_portfolio_projects" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "student_id" integer NOT NULL REFERENCES "academy_students"("id") ON DELETE cascade,
  "lesson_id" integer REFERENCES "academy_lessons"("id") ON DELETE set null,
  "group_id" integer REFERENCES "academy_groups"("id") ON DELETE set null,
  "course_id" integer REFERENCES "academy_courses"("id") ON DELETE set null,
  "title" varchar(255) NOT NULL,
  "url" text,
  "file_url" text,
  "final_status" varchar(80) NOT NULL DEFAULT 'not_started',
  "marketing_consent" boolean NOT NULL DEFAULT false,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_portfolio_projects_workspace_idx" ON "academy_portfolio_projects" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_portfolio_projects_student_idx" ON "academy_portfolio_projects" ("student_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_marketing_expenses" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "source_id" integer REFERENCES "academy_lead_sources"("id") ON DELETE set null,
  "channel" varchar(120) NOT NULL,
  "campaign_name" varchar(255),
  "period_start" timestamp NOT NULL,
  "period_end" timestamp NOT NULL,
  "amount_uzs" integer NOT NULL,
  "created_by" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_marketing_expenses_workspace_idx" ON "academy_marketing_expenses" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_marketing_expenses_source_idx" ON "academy_marketing_expenses" ("source_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_referral_rewards" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "referrer_student_id" integer NOT NULL REFERENCES "academy_students"("id") ON DELETE cascade,
  "referred_lead_id" integer REFERENCES "academy_leads"("id") ON DELETE set null,
  "referred_student_id" integer REFERENCES "academy_students"("id") ON DELETE set null,
  "reward_type" varchar(80) NOT NULL,
  "reward_value" varchar(120) NOT NULL,
  "status" varchar(50) NOT NULL DEFAULT 'pending',
  "created_at" timestamp DEFAULT now(),
  "applied_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_referral_rewards_referrer_idx" ON "academy_referral_rewards" ("referrer_student_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_referral_rewards_referred_lead_idx" ON "academy_referral_rewards" ("referred_lead_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_integration_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "provider" varchar(120) NOT NULL,
  "direction" varchar(40) NOT NULL,
  "status" varchar(50) NOT NULL,
  "payload" jsonb,
  "error_message" text,
  "retry_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_integration_logs_workspace_idx" ON "academy_integration_logs" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_integration_logs_provider_idx" ON "academy_integration_logs" ("provider");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "academy_notification_outbox" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "channel" varchar(80) NOT NULL,
  "recipient" varchar(255) NOT NULL,
  "message" text NOT NULL,
  "status" varchar(50) NOT NULL DEFAULT 'pending',
  "scheduled_at" timestamp,
  "sent_at" timestamp,
  "error_message" text,
  "retry_count" integer NOT NULL DEFAULT 0,
  "entity_type" varchar(80),
  "entity_id" integer,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_notification_outbox_workspace_idx" ON "academy_notification_outbox" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_notification_outbox_status_idx" ON "academy_notification_outbox" ("status");
--> statement-breakpoint
UPDATE "workspaces"
SET "name" = '01 Academy'
WHERE COALESCE(TRIM("name"), '') = '' OR "name" = 'Workspace' OR "name" = 'CRM';
--> statement-breakpoint
INSERT INTO "academy_courses" (
  "workspace_id", "name", "slug", "age_category", "lesson_count", "lesson_duration_minutes",
  "frequency", "base_price_uzs", "discounted_price_uzs", "ltv_target_min_uzs", "ltv_target_max_uzs", "program", "is_active"
)
SELECT
  w."id",
  seed."name",
  seed."slug",
  seed."age_category",
  seed."lesson_count",
  seed."lesson_duration_minutes",
  seed."frequency",
  seed."base_price_uzs",
  seed."discounted_price_uzs",
  seed."ltv_target_min_uzs",
  seed."ltv_target_max_uzs",
  seed."program"::jsonb,
  true
FROM "workspaces" w
CROSS JOIN (
  VALUES
    ('AI Kids', 'ai-kids', '7-10', 24, 90, '2 раза в неделю', 1200000, 960000, 4800000, 6000000, '[{"lessonNumber":1,"topic":"Знакомство с AI","description":"Что такое искусственный интеллект"},{"lessonNumber":2,"topic":"Промпты и безопасность","description":"Как задавать вопросы AI"},{"lessonNumber":3,"topic":"AI-рисование","description":"Создание картинок"},{"lessonNumber":4,"topic":"Истории и персонажи","description":"Мини-комиксы и сценарии"}]'),
    ('AI Creator', 'ai-creator', '11-15', 36, 120, '2 раза в неделю', 1440000, 1224000, 8640000, 10080000, '[{"lessonNumber":1,"topic":"AI-инструменты создателя","description":"Тексты, изображения, видео"},{"lessonNumber":2,"topic":"Контент-план","description":"Идея, аудитория, формат"},{"lessonNumber":3,"topic":"AI-видео","description":"Сценарии и генерация видео"},{"lessonNumber":4,"topic":"Финальный проект","description":"Портфолио-проект"}]'),
    ('Vibe Coding', 'vibe-coding', '16+', 32, 120, '2 раза в неделю', 2500000, 2125000, 10000000, 10000000, '[{"lessonNumber":1,"topic":"Vibe Coding workflow","description":"Сборка продукта с AI"},{"lessonNumber":2,"topic":"Frontend basics","description":"Интерфейсы и компоненты"},{"lessonNumber":3,"topic":"Backend basics","description":"API и данные"},{"lessonNumber":4,"topic":"Запуск проекта","description":"Деплой и QA"}]')
) AS seed("name", "slug", "age_category", "lesson_count", "lesson_duration_minutes", "frequency", "base_price_uzs", "discounted_price_uzs", "ltv_target_min_uzs", "ltv_target_max_uzs", "program")
ON CONFLICT ("workspace_id", "slug") DO NOTHING;
--> statement-breakpoint
INSERT INTO "academy_lead_statuses" ("workspace_id", "code", "name", "color", "sort_order", "is_system", "is_active")
SELECT w."id", seed."code", seed."name", seed."color", seed."sort_order", true, true
FROM "workspaces" w
CROSS JOIN (
  VALUES
    ('new_request', 'Новая заявка', '#2563eb', 10),
    ('first_contact', 'Первый контакт', '#0ea5e9', 20),
    ('qualified', 'Квалифицирован', '#14b8a6', 30),
    ('demo_invited', 'Приглашён на демо', '#8b5cf6', 40),
    ('demo_attended', 'Был на демо', '#a855f7', 50),
    ('offer', 'Предложение', '#f59e0b', 60),
    ('thinking', 'Думает', '#f97316', 70),
    ('enrolled', 'Записан на курс', '#22c55e', 80),
    ('paid', 'Оплатил', '#16a34a', 90),
    ('not_now', 'Не сейчас', '#64748b', 100)
) AS seed("code", "name", "color", "sort_order")
ON CONFLICT ("workspace_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "academy_lead_sources" ("workspace_id", "code", "name", "channel", "is_system", "is_active")
SELECT w."id", seed."code", seed."name", seed."channel", true, true
FROM "workspaces" w
CROSS JOIN (
  VALUES
    ('instagram_dm', 'Instagram DM', 'instagram'),
    ('instagram_ad_default', 'Instagram Ads', 'instagram'),
    ('instagram_reels', 'Instagram Reels', 'instagram'),
    ('tiktok', 'TikTok', 'tiktok'),
    ('telegram_channel', 'Telegram channel', 'telegram'),
    ('telegram_chat', 'Telegram chat', 'telegram'),
    ('telegram_ad', 'Telegram Ads', 'telegram'),
    ('blogger_default', 'Blogger', 'blogger'),
    ('school_default', 'School partnership', 'school'),
    ('event_default', 'Event', 'event'),
    ('referral_default', 'Referral', 'referral'),
    ('website', 'Website', 'website'),
    ('organic', 'Organic', 'organic')
) AS seed("code", "name", "channel")
ON CONFLICT ("workspace_id", "code") DO NOTHING;
