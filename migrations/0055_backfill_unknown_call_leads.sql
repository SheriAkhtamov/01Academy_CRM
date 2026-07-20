DO $$
DECLARE
  unknown_call RECORD;
  telephony_source_id integer;
  matched_lead_id integer;
  actor_id integer;
  manager_id integer;
  current_phone text;
BEGIN
  SELECT id INTO telephony_source_id
  FROM academy_lead_sources
  WHERE code = 'telephony'
  LIMIT 1;

  IF telephony_source_id IS NULL THEN
    INSERT INTO academy_lead_sources
      (code, name, channel, is_system, is_active, updated_at)
    VALUES ('telephony', 'Телефония', 'call', true, true, NOW())
    ON CONFLICT (code) DO UPDATE
    SET name = EXCLUDED.name,
        channel = EXCLUDED.channel,
        is_system = true,
        is_active = true,
        updated_at = NOW()
    RETURNING id INTO telephony_source_id;
  END IF;

  FOR unknown_call IN
    SELECT DISTINCT ON (REGEXP_REPLACE(call.phone, '\D', '', 'g'))
      call.phone,
      call.user_id,
      call.direction,
      call.started_at
    FROM telephony_calls call
    WHERE call.lead_id IS NULL
      AND LENGTH(REGEXP_REPLACE(call.phone, '\D', '', 'g')) >= 7
    ORDER BY REGEXP_REPLACE(call.phone, '\D', '', 'g'), call.started_at DESC, call.id DESC
  LOOP
    current_phone := '+' || REGEXP_REPLACE(unknown_call.phone, '\D', '', 'g');
    PERFORM pg_advisory_xact_lock(hashtext('telephony-lead:' || current_phone));

    SELECT phone.lead_id INTO matched_lead_id
    FROM academy_lead_phones phone
    JOIN academy_leads lead ON lead.id = phone.lead_id
    WHERE REGEXP_REPLACE(phone.normalized_phone, '\D', '', 'g')
      = REGEXP_REPLACE(current_phone, '\D', '', 'g')
    ORDER BY lead.is_archived, lead.updated_at DESC NULLS LAST, lead.id DESC
    LIMIT 1;

    IF matched_lead_id IS NULL THEN
      actor_id := unknown_call.user_id;
      manager_id := NULL;

      SELECT user_account.id INTO manager_id
      FROM users user_account
      WHERE user_account.id = actor_id
        AND user_account.is_active = true
        AND (
          user_account.workspace = 'sales'
          OR EXISTS (
            SELECT 1
            FROM user_workspaces workspace
            WHERE workspace.user_id = user_account.id
              AND workspace.workspace = 'sales'
          )
        )
      LIMIT 1;

      INSERT INTO academy_leads (
        contact_name, phone, source_id, status_code, manager_id, language,
        comment, first_contact_channel, created_by, created_at, updated_at
      )
      VALUES (
        'Новый контакт ' || current_phone,
        current_phone,
        telephony_source_id,
        'new_request',
        manager_id,
        'ru',
        'Создан автоматически при переносе истории звонков.',
        'call',
        actor_id,
        COALESCE(unknown_call.started_at, NOW()),
        NOW()
      )
      RETURNING id INTO matched_lead_id;

      INSERT INTO academy_lead_phones
        (lead_id, phone, normalized_phone, is_primary)
      VALUES (matched_lead_id, current_phone, current_phone, true)
      ON CONFLICT (lead_id, normalized_phone) DO NOTHING;

      INSERT INTO academy_lead_stage_history
        (lead_id, from_status_code, to_status_code, entered_at, changed_by, comment)
      VALUES (
        matched_lead_id,
        NULL,
        'new_request',
        COALESCE(unknown_call.started_at, NOW()),
        actor_id,
        'Автоматически из истории звонков'
      );
    END IF;

    UPDATE telephony_calls call
    SET lead_id = matched_lead_id,
        contact_type = 'lead',
        contact_id = matched_lead_id,
        contact_name = COALESCE(
          call.contact_name,
          (SELECT lead.contact_name FROM academy_leads lead WHERE lead.id = matched_lead_id)
        ),
        updated_at = NOW()
    WHERE call.lead_id IS NULL
      AND REGEXP_REPLACE(call.phone, '\D', '', 'g')
        = REGEXP_REPLACE(current_phone, '\D', '', 'g');
  END LOOP;
END $$;
