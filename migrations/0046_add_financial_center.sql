CREATE TABLE "academy_operating_expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"vendor" varchar(255),
	"description" text,
	"amount_uzs" integer NOT NULL,
	"expense_date" timestamp NOT NULL,
	"status" varchar(30) DEFAULT 'paid' NOT NULL,
	"method" varchar(30) DEFAULT 'transfer' NOT NULL,
	"paid_at" timestamp,
	"created_by" integer,
	"cancelled_by" integer,
	"cancelled_at" timestamp,
	"cancellation_reason" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "academy_operating_expenses_amount_check" CHECK ("academy_operating_expenses"."amount_uzs" > 0),
	CONSTRAINT "academy_operating_expenses_status_check" CHECK ("academy_operating_expenses"."status" IN ('planned', 'paid', 'cancelled')),
	CONSTRAINT "academy_operating_expenses_method_check" CHECK ("academy_operating_expenses"."method" IN ('cash', 'transfer', 'card')),
	CONSTRAINT "academy_operating_expenses_category_check" CHECK ("academy_operating_expenses"."category" IN ('rent', 'equipment', 'supplies', 'utilities', 'software', 'taxes', 'marketing', 'transport', 'maintenance', 'other'))
);
--> statement-breakpoint
CREATE TABLE "academy_salary_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_user_id" integer,
	"employee_name" varchar(255) NOT NULL,
	"amount_uzs" integer NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"note" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "academy_salary_rates_amount_check" CHECK ("academy_salary_rates"."amount_uzs" > 0),
	CONSTRAINT "academy_salary_rates_date_check" CHECK ("academy_salary_rates"."effective_to" IS NULL OR "academy_salary_rates"."effective_to" >= "academy_salary_rates"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "academy_payroll_payouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"period" varchar(7) NOT NULL,
	"employee_user_id" integer,
	"employee_name" varchar(255) NOT NULL,
	"position" varchar(255),
	"salary_rate_id" integer,
	"base_salary_uzs" integer NOT NULL,
	"bonus_uzs" integer DEFAULT 0 NOT NULL,
	"deduction_uzs" integer DEFAULT 0 NOT NULL,
	"amount_uzs" integer NOT NULL,
	"method" varchar(30) DEFAULT 'transfer' NOT NULL,
	"note" text,
	"status" varchar(30) DEFAULT 'paid' NOT NULL,
	"paid_by" integer,
	"paid_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "academy_payroll_payouts_amount_check" CHECK ("academy_payroll_payouts"."base_salary_uzs" >= 0 AND "academy_payroll_payouts"."bonus_uzs" >= 0 AND "academy_payroll_payouts"."deduction_uzs" >= 0 AND "academy_payroll_payouts"."amount_uzs" >= 0 AND "academy_payroll_payouts"."amount_uzs" = "academy_payroll_payouts"."base_salary_uzs" + "academy_payroll_payouts"."bonus_uzs" - "academy_payroll_payouts"."deduction_uzs"),
	CONSTRAINT "academy_payroll_payouts_method_check" CHECK ("academy_payroll_payouts"."method" IN ('cash', 'transfer', 'card')),
	CONSTRAINT "academy_payroll_payouts_status_check" CHECK ("academy_payroll_payouts"."status" = 'paid')
);
--> statement-breakpoint
ALTER TABLE "academy_operating_expenses" ADD CONSTRAINT "academy_operating_expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "academy_operating_expenses" ADD CONSTRAINT "academy_operating_expenses_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "academy_salary_rates" ADD CONSTRAINT "academy_salary_rates_employee_user_id_users_id_fk" FOREIGN KEY ("employee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "academy_salary_rates" ADD CONSTRAINT "academy_salary_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "academy_payroll_payouts" ADD CONSTRAINT "academy_payroll_payouts_employee_user_id_users_id_fk" FOREIGN KEY ("employee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "academy_payroll_payouts" ADD CONSTRAINT "academy_payroll_payouts_salary_rate_id_academy_salary_rates_id_fk" FOREIGN KEY ("salary_rate_id") REFERENCES "public"."academy_salary_rates"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "academy_payroll_payouts" ADD CONSTRAINT "academy_payroll_payouts_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "academy_operating_expenses_date_idx" ON "academy_operating_expenses" USING btree ("expense_date");
--> statement-breakpoint
CREATE INDEX "academy_operating_expenses_status_idx" ON "academy_operating_expenses" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "academy_operating_expenses_category_idx" ON "academy_operating_expenses" USING btree ("category");
--> statement-breakpoint
CREATE INDEX "academy_salary_rates_employee_idx" ON "academy_salary_rates" USING btree ("employee_user_id", "effective_from");
--> statement-breakpoint
CREATE UNIQUE INDEX "academy_salary_rates_employee_date_unique" ON "academy_salary_rates" USING btree ("employee_user_id", "effective_from");
--> statement-breakpoint
CREATE INDEX "academy_payroll_payouts_period_idx" ON "academy_payroll_payouts" USING btree ("period");
--> statement-breakpoint
CREATE INDEX "academy_payroll_payouts_employee_idx" ON "academy_payroll_payouts" USING btree ("employee_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "academy_payroll_payouts_employee_period_unique" ON "academy_payroll_payouts" USING btree ("employee_user_id", "period");
