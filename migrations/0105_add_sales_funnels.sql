CREATE TABLE "academy_sales_funnels" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "academy_sales_funnels_name_not_blank" CHECK (BTRIM("name") <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "academy_sales_funnels_name_unique" ON "academy_sales_funnels" USING btree (lower(BTRIM("name")));
--> statement-breakpoint
CREATE UNIQUE INDEX "academy_sales_funnels_default_unique" ON "academy_sales_funnels" USING btree ("is_default") WHERE "is_default" = true;
--> statement-breakpoint
INSERT INTO "academy_sales_funnels" ("name", "is_active", "is_default")
VALUES ('Основная воронка', true, true);
--> statement-breakpoint
ALTER TABLE "academy_leads" ADD COLUMN "funnel_id" integer;
--> statement-breakpoint
UPDATE "academy_leads"
SET "funnel_id" = (SELECT "id" FROM "academy_sales_funnels" WHERE "is_default" = true LIMIT 1)
WHERE "funnel_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "academy_leads" ALTER COLUMN "funnel_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "academy_leads" ADD CONSTRAINT "academy_leads_funnel_id_academy_sales_funnels_id_fk"
FOREIGN KEY ("funnel_id") REFERENCES "public"."academy_sales_funnels"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "academy_leads_funnel_idx" ON "academy_leads" USING btree ("funnel_id");
--> statement-breakpoint
CREATE TABLE "academy_integration_funnel_settings" (
	"provider" varchar(80) PRIMARY KEY NOT NULL,
	"funnel_id" integer NOT NULL,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "academy_integration_funnel_settings_provider_check"
		CHECK ("provider" IN ('website', 'instagram', 'meta', 'onlinepbx'))
);
--> statement-breakpoint
ALTER TABLE "academy_integration_funnel_settings"
ADD CONSTRAINT "academy_integration_funnel_settings_funnel_id_academy_sales_funnels_id_fk"
FOREIGN KEY ("funnel_id") REFERENCES "public"."academy_sales_funnels"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "academy_integration_funnel_settings"
ADD CONSTRAINT "academy_integration_funnel_settings_updated_by_users_id_fk"
FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "academy_integration_funnel_settings_funnel_idx"
ON "academy_integration_funnel_settings" USING btree ("funnel_id");
--> statement-breakpoint
INSERT INTO "academy_integration_funnel_settings" ("provider", "funnel_id")
SELECT provider, funnel."id"
FROM (VALUES ('website'), ('instagram'), ('meta'), ('onlinepbx')) AS configured(provider)
CROSS JOIN LATERAL (
	SELECT "id" FROM "academy_sales_funnels" WHERE "is_default" = true LIMIT 1
) AS funnel;
