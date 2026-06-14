// Seeds the initial super-admin user and academy reference data (courses, lead sources, statuses).
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
  fullName: process.env.SUPER_FULLNAME || 'Sheri Super Admin',
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
  if (await exists('users', 'email = $1', [SUPER.email])) {
    console.log(`[skip] user "${SUPER.email}" already exists`);
    return;
  }
  const hash = await bcrypt.hash(SUPER.password, 10);
  await exec(
    `INSERT INTO users (email, password, full_name, position, role, has_report_access, is_active)
     VALUES ($1, $2, $3, $4, 'admin', true, true)`,
    [SUPER.email, hash, SUPER.fullName, 'Super Administrator'],
  );
  console.log(`[ok] created super-admin: login="${SUPER.email}" (or "${SUPER.username}"), password="${SUPER.password}"`);
}

async function seedStatuses() {
  for (const s of LEAD_STATUSES) {
    if (await exists('academy_lead_statuses', 'code = $1', [s.code])) continue;
    await exec(
      `INSERT INTO academy_lead_statuses (code, name, color, sort_order, is_system, is_active)
       VALUES ($1,$2,$3,$4,true,true)`,
      [s.code, s.name, s.color, s.sortOrder],
    );
  }
  console.log(`[ok] lead statuses ensured (${LEAD_STATUSES.length})`);
}

async function seedSources() {
  for (const code of DEFAULT_LEAD_SOURCES) {
    if (await exists('academy_lead_sources', 'code = $1', [code])) continue;
    await exec(
      `INSERT INTO academy_lead_sources (code, name, channel, is_system, is_active)
       VALUES ($1,$2,$3,true,true)`,
      [code, code, code.split('_')[0]],
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
    await seedSuperAdmin();
    await seedStatuses();
    await seedSources();
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
