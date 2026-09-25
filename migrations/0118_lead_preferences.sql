ALTER TABLE academy_leads
  ADD COLUMN locality varchar(40),
  ADD COLUMN study_days varchar(20),
  ADD COLUMN study_time varchar(5),
  ADD COLUMN goal text,
  ADD COLUMN urgency text;
