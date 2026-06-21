CREATE TABLE "academy_lead_assignment_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"from_manager_id" integer,
	"to_manager_id" integer NOT NULL,
	"changed_by" integer,
	"comment" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "academy_lead_assignment_history" ADD CONSTRAINT "academy_lead_assignment_history_lead_id_academy_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."academy_leads"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "academy_lead_assignment_history" ADD CONSTRAINT "academy_lead_assignment_history_from_manager_id_users_id_fk" FOREIGN KEY ("from_manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "academy_lead_assignment_history" ADD CONSTRAINT "academy_lead_assignment_history_to_manager_id_users_id_fk" FOREIGN KEY ("to_manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "academy_lead_assignment_history" ADD CONSTRAINT "academy_lead_assignment_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "academy_lead_assignment_history_lead_idx" ON "academy_lead_assignment_history" USING btree ("lead_id");
--> statement-breakpoint
CREATE INDEX "academy_lead_assignment_history_to_manager_idx" ON "academy_lead_assignment_history" USING btree ("to_manager_id");
