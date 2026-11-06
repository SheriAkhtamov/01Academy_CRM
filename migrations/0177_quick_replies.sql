CREATE TABLE IF NOT EXISTS "academy_quick_replies" (
  "id" serial PRIMARY KEY NOT NULL,
  "text" text NOT NULL,
  "language" varchar(10) DEFAULT 'ru' NOT NULL,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "academy_quick_replies_language_idx" ON "academy_quick_replies" ("language");
--> statement-breakpoint
INSERT INTO "academy_quick_replies" ("text", "language") VALUES
('Здравствуйте! Чем мы можем вам помочь?', 'ru'),
('Добрый день! Подскажите, пожалуйста, какой курс вас интересует?', 'ru'),
('Уточните, пожалуйста, возраст будущего ученика?', 'ru'),
('Оставьте ваш номер телефона, и наш методист свяжется с вами для консультации.', 'ru'),
('Assalomu alaykum! Sizga qanday yordam bera olamiz?', 'uz'),
('Xayrli kun! Qaysi kursimiz sizni qiziqtirmoqda?', 'uz'),
('Iltimos, o''quvchining yoshini aytsangiz?', 'uz'),
('Telefon raqamingizni qoldiring, mutaxassisimiz siz bilan bog''lanadi.', 'uz');
