// Development-only seed for the initial super-admin user and academy reference
// data (courses, lead sources, statuses). Production deploys must not run it:
// the script updates existing rows and can overwrite live admin/reference data.
// Run with: node --import tsx scripts/init-dev-data.mjs  OR  tsx scripts/init-dev-data.ts
import bcrypt from 'bcrypt';
import { pool } from '../server/db';
import {
  DEFAULT_COURSES,
  DEFAULT_LEAD_SOURCES,
  LEAD_STATUSES,
} from '../shared/academy';

const SUPER = {
  username: process.env.SUPER_USERNAME || 'Sheri',
  fullName: process.env.SUPER_FULLNAME || process.env.SUPER_USERNAME || 'Sheri',
  email: process.env.SUPER_EMAIL || 'admin@01academy.uz',
  password: process.env.SUPER_PASSWORD || 'Sheri2001',
};

async function exec(sql, params = []) {
  return pool.query(sql, params);
}

async function exists(table, whereSql, params = []) {
  const r = await exec(`SELECT 1 FROM ${table} WHERE ${whereSql} LIMIT 1`, params);
  return r.rows.length > 0;
}

async function seedSuperAdmin() {
  const existingUser = await exec(
    `SELECT id FROM users WHERE email = $1 OR full_name = $2 ORDER BY id LIMIT 1`,
    [SUPER.email, SUPER.username],
  );
  const hash = await bcrypt.hash(SUPER.password, 10);

  if (existingUser.rows[0]?.id) {
    await exec(
      `UPDATE users
       SET email = $1,
           password = $2,
           full_name = $3,
           position = $4,
           workspace = 'administration',
           has_report_access = true,
           is_active = true,
           updated_at = now()
       WHERE id = $5`,
      [SUPER.email, hash, SUPER.fullName, 'Super Administrator', existingUser.rows[0].id],
    );
    console.log(`[ok] ensured super-admin login="${SUPER.username}"`);
    return;
  }

  await exec(
    `INSERT INTO users (email, password, full_name, position, workspace, has_report_access, is_active)
     VALUES ($1, $2, $3, $4, 'administration', true, true)`,
    [SUPER.email, hash, SUPER.fullName, 'Super Administrator'],
  );
  console.log(`[ok] created super-admin login="${SUPER.username}"`);
}

async function seedStatuses() {
  for (const s of LEAD_STATUSES) {
    await exec(
      `INSERT INTO academy_lead_statuses (code, name, color, sort_order, is_pipeline, is_system, is_active)
       VALUES ($1,$2,$3,$4,$5,true,true)
       ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name,
           color = EXCLUDED.color,
           sort_order = EXCLUDED.sort_order,
           is_pipeline = EXCLUDED.is_pipeline,
           is_system = true`,
      [s.code, s.name, s.color, s.sortOrder, s.activePipeline],
    );
  }
  console.log(`[ok] lead statuses ensured (${LEAD_STATUSES.length})`);
}

async function seedLeadSources() {
  for (const s of DEFAULT_LEAD_SOURCES) {
    await exec(
      `INSERT INTO academy_lead_sources (code, name, channel, is_system, is_active)
       VALUES ($1,$2,$3,true,true)
       ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name,
           channel = EXCLUDED.channel,
           is_system = true,
           is_active = true,
           updated_at = now()`,
      [s.code, s.name, s.channel],
    );
  }
  console.log(`[ok] lead sources ensured (${DEFAULT_LEAD_SOURCES.length})`);
}

async function seedCourses() {
  for (const c of DEFAULT_COURSES) {
    if (await exists('academy_courses', 'slug = $1', [c.slug])) continue;
    await exec(
      `INSERT INTO academy_courses
        (name, slug, age_category, lesson_count, lesson_duration_minutes, frequency,
         base_price_uzs, discounted_price_uzs, ltv_target_min_uzs, ltv_target_max_uzs, program, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)`,
      [
        c.name, c.slug, c.ageCategory, c.lessonCount, c.lessonDurationMinutes, c.frequency,
        c.basePriceUzs, c.discountedPriceUzs, c.ltvTargetMinUzs, c.ltvTargetMaxUzs,
        JSON.stringify(c.program),
      ],
    );
  }
  console.log(`[ok] courses ensured (${DEFAULT_COURSES.length})`);
}

async function main() {
  try {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DB_SEED !== 'true') {
      throw new Error('Refusing to seed production data without ALLOW_DB_SEED=true');
    }

    await seedSuperAdmin();
    await seedStatuses();
    await seedLeadSources();
    await seedCourses();
    const r = await exec(
      `SELECT
         (SELECT count(*) FROM users) AS users,
         (SELECT count(*) FROM academy_courses) AS courses,
         (SELECT count(*) FROM academy_lead_sources) AS sources,
         (SELECT count(*) FROM academy_lead_statuses) AS statuses;`,
    );
    console.log('[done] DB counts:', r.rows[0]);
  } catch (e) {
    console.error('[error]', e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
