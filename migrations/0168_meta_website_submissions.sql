-- One landing submission is one acquisition fact. Retrying that HTTP request
-- must not create a second fact, including after a lost successful response.
CREATE UNIQUE INDEX IF NOT EXISTS meta_website_submission_unique
  ON meta_lead_attributions (referral_ref)
  WHERE provider = 'meta' AND channel = 'website' AND referral_type = 'landing_form';
