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
  email: (process.env.SUPER_EMAIL || 'sheri@01academy.uz').trim().toLowerCase(),
  password: (process.env.SUPER_PASSWORD || 'Sheri2001').trim(),
};

async function exec(sql: string, params: any[] = []) {
  return pool.query(sql, params);
}

// Name generators
const FIRST_NAMES_MALE = [
  'Сардор', 'Алишер', 'Бобур', 'Тимур', 'Жасур', 'Азиз', 'Мухаммад', 'Улугбек',
  'Искандер', 'Шерзод', 'Достон', 'Фаррух', 'Джамшид', 'Руслан', 'Даврон', 'Бекзод',
  'Отабек', 'Санжар', 'Шодруз', 'Камрон', 'Нодир', 'Одил', 'Хусан', 'Хасан',
  'Мирзо', 'Сухроб', 'Шахзод', 'Акмал', 'Жахонгир', 'Диёр', 'Асадбек', 'Элдор'
];

const FIRST_NAMES_FEMALE = [
  'Малика', 'Камила', 'Шахло', 'Самира', 'Диана', 'Зарина', 'Севара', 'Нигора',
  'Лола', 'Надира', 'Дильфуза', 'Рано', 'Гульнора', 'Азиза', 'Ясмина', 'Мадина',
  'Зиёда', 'Дильноза', 'Феруза', 'Муштарий', 'Саида', 'Гульбахор', 'Нозима', 'Шахноза'
];

const LAST_NAMES = [
  'Ахмедов', 'Исмаилов', 'Салимов', 'Назаров', 'Умаров', 'Рустамов', 'Темиров', 'Махмудов',
  'Зокиров', 'Юлдашев', 'Хакимов', 'Расулов', 'Мирзаев', 'Касымов', 'Ибрагимов', 'Олимов',
  'Собиров', 'Холматов', 'Тахиров', 'Валиев', 'Курбанов', 'Джалилов', 'Ганиев', 'Бакиров',
  'Каримов', 'Алиев', 'Турсунов', 'Эргашев', 'Абдуллаев', 'Саидов', 'Мамаджанов', 'Ходжаев'
];

function generatePerson(index: number) {
  const isFemale = index % 2 === 1;
  const firstList = isFemale ? FIRST_NAMES_FEMALE : FIRST_NAMES_MALE;
  const firstName = firstList[index % firstList.length];
  let lastName = LAST_NAMES[(index * 7) % LAST_NAMES.length];
  if (isFemale) {
    if (lastName.endsWith('ов') || lastName.endsWith('ев')) {
      lastName += 'а';
    }
  }
  const prefix = ['90', '91', '93', '94', '95', '97', '98', '99'][(index * 3) % 8];
  const middle = String(100 + ((index * 37) % 900));
  const end = String(1000 + ((index * 73) % 9000));
  const phone = `+998${prefix}${middle}${end.slice(0, 4)}`;

  const parentIsFather = (index % 3) !== 0;
  const parentFirst = parentIsFather
    ? FIRST_NAMES_MALE[(index * 5) % FIRST_NAMES_MALE.length]
    : FIRST_NAMES_FEMALE[(index * 5) % FIRST_NAMES_FEMALE.length];
  const role = parentIsFather ? 'Отец' : 'Мама';
  const parentName = `${parentFirst} ${lastName} (${role})`;

  return {
    fullName: `${firstName} ${lastName}`,
    firstName,
    lastName,
    parentName,
    phone,
  };
}

// 1. Seed Users (Super Admin + Staff)
async function seedUsers() {
  const superHash = await bcrypt.hash(SUPER.password, 12);
  const staffHash = await bcrypt.hash('Sheri2001', 12);

  const existingSuper = await exec(
    `SELECT id FROM users WHERE lower(email) = lower($1) OR lower(full_name) = lower($2) ORDER BY id LIMIT 1`,
    [SUPER.email, SUPER.username],
  );

  let superUserId: number;
  if (existingSuper.rows[0]?.id) {
    superUserId = existingSuper.rows[0].id;
    await exec(
      `UPDATE users
       SET email = $1, password = $2, full_name = $3, position = $4, module = 'administration', is_active = true, updated_at = now()
       WHERE id = $5`,
      [SUPER.email, superHash, SUPER.fullName, 'Super Administrator / Руководитель', superUserId],
    );
  } else {
    const res = await exec(
      `INSERT INTO users (email, password, full_name, position, module, is_active)
       VALUES ($1, $2, $3, $4, 'administration', true)
       RETURNING id`,
      [SUPER.email, superHash, SUPER.fullName, 'Super Administrator / Руководитель'],
    );
    superUserId = res.rows[0].id;
  }

  // Ensure Sheri has all 5 modules
  for (const mod of ['administration', 'sales', 'teacher', 'marketing', 'finance']) {
    await exec(
      `INSERT INTO user_modules (user_id, module) VALUES ($1, $2) ON CONFLICT (user_id, module) DO NOTHING`,
      [superUserId, mod],
    );
  }

  const staff = [
    { fullName: 'Азиз Рахимов', email: 'aziz@01academy.uz', phone: '+998901234567', position: 'Старший менеджер по продажам', module: 'sales', modules: ['sales'] },
    { fullName: 'Жасур Каримов', email: 'jasur@01academy.uz', phone: '+998902345678', position: 'Senior AI & Web Преподаватель', module: 'teacher', modules: ['teacher'] },
    { fullName: 'Елена Ким', email: 'elena@01academy.uz', phone: '+998903456789', position: 'Преподаватель курсов AI Kids', module: 'teacher', modules: ['teacher'] },
    { fullName: 'Дильноза Юсупова', email: 'dilnoza@01academy.uz', phone: '+998904567890', position: 'Маркетолог & Growth Lead', module: 'marketing', modules: ['marketing'] },
    { fullName: 'Фаррух Алиев', email: 'farrukh@01academy.uz', phone: '+998905678901', position: 'Финансовый менеджер', module: 'administration', modules: ['administration', 'finance'] },
    { fullName: 'Мадина Саидова', email: 'madina@01academy.uz', phone: '+998906789012', position: 'Менеджер по работе с клиентами', module: 'sales', modules: ['sales'] },
  ];

  const userMap: Record<string, number> = { sheri: superUserId };
  for (const s of staff) {
    const r = await exec(`SELECT id FROM users WHERE lower(email) = lower($1) OR lower(full_name) = lower($2) LIMIT 1`, [s.email, s.fullName]);
    let uid: number;
    if (r.rows[0]?.id) {
      uid = r.rows[0].id;
      await exec(
        `UPDATE users SET email = $1, password = $2, full_name = $3, phone = $4, position = $5, module = $6, is_active = true, updated_at = now() WHERE id = $7`,
        [s.email, staffHash, s.fullName, s.phone, s.position, s.module, uid],
      );
    } else {
      const ins = await exec(
        `INSERT INTO users (email, password, full_name, phone, position, module, is_active) VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id`,
        [s.email, staffHash, s.fullName, s.phone, s.position, s.module],
      );
      uid = ins.rows[0].id;
    }
    userMap[s.email] = uid;
    for (const m of s.modules) {
      await exec(`INSERT INTO user_modules (user_id, module) VALUES ($1, $2) ON CONFLICT (user_id, module) DO NOTHING`, [uid, m]);
    }
  }

  console.log(`[ok] seeded users (Super Admin Sheri + ${staff.length} staff)`);
  return userMap;
}

// 2. Schools and Rooms
async function seedSchoolsAndRooms() {
  let schoolId: number;
  const existingSchool = await exec(`SELECT id FROM academy_schools WHERE code = 'cyberpark' LIMIT 1`);
  if (existingSchool.rows[0]?.id) {
    schoolId = existingSchool.rows[0].id;
  } else {
    const res = await exec(
      `INSERT INTO academy_schools (name, code, address, rooms, timezone, is_active)
       VALUES ('Cyberpark', 'cyberpark', 'г. Ташкент, ул. Темур Малик, 3а', '["101", "102", "117"]'::jsonb, 'Asia/Tashkent', true)
       RETURNING id`,
    );
    schoolId = res.rows[0].id;
  }

  const rooms = [
    { name: '101', capacity: 14 },
    { name: '102', capacity: 14 },
    { name: '117', capacity: 18 },
    { name: '204', capacity: 16 },
    { name: 'Онлайн-класс', capacity: 30 },
  ];

  const roomMap: Record<string, number> = {};
  for (const rm of rooms) {
    const r = await exec(`SELECT id FROM academy_rooms WHERE school_id = $1 AND name = $2 LIMIT 1`, [schoolId, rm.name]);
    if (r.rows[0]?.id) {
      roomMap[rm.name] = r.rows[0].id;
    } else {
      const ins = await exec(
        `INSERT INTO academy_rooms (school_id, name, capacity, is_active) VALUES ($1, $2, $3, true) RETURNING id`,
        [schoolId, rm.name, rm.capacity],
      );
      roomMap[rm.name] = ins.rows[0].id;
    }
  }
  console.log(`[ok] school Cyberpark & rooms ensured (${Object.keys(roomMap).length} rooms)`);
  return { schoolId, roomMap };
}

// 3. Courses
async function seedCourses() {
  const courseMap: Record<string, number> = {};
  for (const c of DEFAULT_COURSES) {
    const existing = await exec(`SELECT id FROM academy_courses WHERE slug = $1 LIMIT 1`, [c.slug]);
    if (existing.rows[0]?.id) {
      courseMap[c.slug] = existing.rows[0].id;
    } else {
      const ins = await exec(
        `INSERT INTO academy_courses
          (name, slug, age_category, lesson_count, lesson_duration_minutes, frequency,
           base_price_uzs, discounted_price_uzs, ltv_target_min_uzs, ltv_target_max_uzs, program, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
         RETURNING id`,
        [
          c.name, c.slug, c.ageCategory, c.lessonCount, c.lessonDurationMinutes, c.frequency,
          c.basePriceUzs, c.discountedPriceUzs, c.ltvTargetMinUzs, c.ltvTargetMaxUzs,
          JSON.stringify(c.program),
        ],
      );
      courseMap[c.slug] = ins.rows[0].id;
    }
  }
  console.log(`[ok] courses ensured (${DEFAULT_COURSES.length})`);
  return courseMap;
}

// 4. Statuses and Lead Sources
async function seedStatusesAndSources() {
  for (const s of LEAD_STATUSES) {
    await exec(
      `INSERT INTO academy_lead_statuses (code, name, color, sort_order, is_pipeline, is_system, is_active)
       VALUES ($1,$2,$3,$4,$5,true,true)
       ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name, color = EXCLUDED.color, sort_order = EXCLUDED.sort_order, is_pipeline = EXCLUDED.is_pipeline, is_system = true`,
      [s.code, s.name, s.color, s.sortOrder, s.activePipeline],
    );
  }

  const sourceMap: Record<string, number> = {};
  for (const s of DEFAULT_LEAD_SOURCES) {
    const r = await exec(
      `INSERT INTO academy_lead_sources (code, name, channel, is_system, is_active)
       VALUES ($1,$2,$3,true,true)
       ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name, channel = EXCLUDED.channel, is_system = true, is_active = true, updated_at = now()
       RETURNING id, code`,
      [s.code, s.name, s.channel],
    );
    sourceMap[s.code] = r.rows[0].id;
  }
  console.log(`[ok] lead statuses & sources ensured`);
  return sourceMap;
}

// 5. Teachers
async function seedTeachers(userMap: Record<string, number>, courseMap: Record<string, number>, schoolId: number) {
  const teacherDefs = [
    { fullName: 'Жасур Каримов', email: 'jasur@01academy.uz', courseSlugs: ['vibe-coding', 'ai-creator'] },
    { fullName: 'Елена Ким', email: 'elena@01academy.uz', courseSlugs: ['ai-kids'] },
  ];

  const teacherMap: Record<string, number> = {};
  for (const td of teacherDefs) {
    const uid = userMap[td.email];
    const cids = td.courseSlugs.map((s) => courseMap[s]).filter(Boolean);
    const existing = await exec(`SELECT id FROM academy_teachers WHERE user_id = $1 LIMIT 1`, [uid]);
    if (existing.rows[0]?.id) {
      teacherMap[td.fullName] = existing.rows[0].id;
      await exec(
        `UPDATE academy_teachers SET course_ids = $1, school_ids = $2, status = 'active', updated_at = now() WHERE id = $3`,
        [JSON.stringify(cids), JSON.stringify([schoolId]), existing.rows[0].id],
      );
    } else {
      const ins = await exec(
        `INSERT INTO academy_teachers (user_id, full_name, course_ids, school_ids, status)
         VALUES ($1, $2, $3, $4, 'active')
         RETURNING id`,
        [uid, td.fullName, JSON.stringify(cids), JSON.stringify([schoolId])],
      );
      teacherMap[td.fullName] = ins.rows[0].id;
    }
  }
  console.log(`[ok] teachers ensured (${Object.keys(teacherMap).length})`);
  return teacherMap;
}

// 6. Course Groups (Strictly following AGENTS.md rule!)
// Format: [ФИЛИАЛ-ИЛИ-ОНЛАЙН]-[КУРС]-[ТИП]-[ГОД]-[НОМЕР]
// e.g. CYP-VC-GRP-26-0001
async function seedGroups(
  schoolId: number,
  roomMap: Record<string, number>,
  courseMap: Record<string, number>,
  teacherMap: Record<string, number>,
) {
  const existingGroups = await exec(`SELECT id, name FROM academy_groups ORDER BY id ASC`);
  let maxSeq = 0;
  const groupMap: Record<string, number> = {};
  for (const row of existingGroups.rows) {
    groupMap[row.name] = row.id;
    const parts = (row.name || '').split('-');
    const lastPart = parts[parts.length - 1];
    const num = parseInt(lastPart, 10);
    if (!isNaN(num) && num > maxSeq) {
      maxSeq = num;
    }
  }

  // 15 Groups total
  const desiredGroups = [
    { branch: 'CYP', courseCode: 'AIK', courseSlug: 'ai-kids', type: 'GRP', year: '26', roomName: '101', teacherName: 'Елена Ким', lessonCount: 16, lessonDurationMinutes: 120, frequency: '1 раз в неделю', maxStudents: 12, status: 'in_progress', startDate: new Date('2026-08-01T10:00:00Z'), endDate: new Date('2026-11-28T12:00:00Z'), schedule: [{ dayOfWeek: 6, startTime: '10:00', endTime: '12:00' }] },
    { branch: 'CYP', courseCode: 'AIC', courseSlug: 'ai-creator', type: 'GRP', year: '26', roomName: '102', teacherName: 'Жасур Каримов', lessonCount: 24, lessonDurationMinutes: 120, frequency: '1 раз в неделю', maxStudents: 12, status: 'in_progress', startDate: new Date('2026-08-02T14:00:00Z'), endDate: new Date('2026-12-20T16:00:00Z'), schedule: [{ dayOfWeek: 0, startTime: '14:00', endTime: '16:00' }] },
    { branch: 'CYP', courseCode: 'VC', courseSlug: 'vibe-coding', type: 'GRP', year: '26', roomName: '117', teacherName: 'Жасур Каримов', lessonCount: 60, lessonDurationMinutes: 120, frequency: '3 раза в неделю', maxStudents: 15, status: 'in_progress', startDate: new Date('2026-08-03T18:30:00Z'), endDate: new Date('2026-12-25T20:30:00Z'), schedule: [{ dayOfWeek: 1, startTime: '18:30', endTime: '20:30' }, { dayOfWeek: 3, startTime: '18:30', endTime: '20:30' }, { dayOfWeek: 5, startTime: '18:30', endTime: '20:30' }] },
    { branch: 'ONL', courseCode: 'VC', courseSlug: 'vibe-coding', type: 'GRP', year: '26', roomName: 'Онлайн-класс', teacherName: 'Жасур Каримов', lessonCount: 60, lessonDurationMinutes: 120, frequency: '3 раза в неделю', maxStudents: 20, status: 'open', startDate: new Date('2026-09-15T19:00:00Z'), endDate: new Date('2027-02-15T21:00:00Z'), schedule: [{ dayOfWeek: 2, startTime: '19:00', endTime: '21:00' }, { dayOfWeek: 4, startTime: '19:00', endTime: '21:00' }, { dayOfWeek: 6, startTime: '19:00', endTime: '21:00' }] },
    { branch: 'CYP', courseCode: 'AIK', courseSlug: 'ai-kids', type: 'IND', year: '26', roomName: '101', teacherName: 'Елена Ким', lessonCount: 16, lessonDurationMinutes: 120, frequency: '1 раз в неделю', maxStudents: 1, status: 'in_progress', startDate: new Date('2026-08-10T15:00:00Z'), endDate: new Date('2026-11-30T17:00:00Z'), schedule: [{ dayOfWeek: 1, startTime: '15:00', endTime: '17:00' }] },
    // Additional Groups to scale 5x
    { branch: 'CYP', courseCode: 'VC', courseSlug: 'vibe-coding', type: 'GRP', year: '26', roomName: '117', teacherName: 'Жасур Каримов', lessonCount: 60, lessonDurationMinutes: 120, frequency: '3 раза в неделю', maxStudents: 16, status: 'in_progress', startDate: new Date('2026-08-15T15:00:00Z'), endDate: new Date('2026-12-30T17:00:00Z'), schedule: [{ dayOfWeek: 2, startTime: '15:00', endTime: '17:00' }, { dayOfWeek: 4, startTime: '15:00', endTime: '17:00' }, { dayOfWeek: 6, startTime: '15:00', endTime: '17:00' }] },
    { branch: 'CYP', courseCode: 'VC', courseSlug: 'vibe-coding', type: 'GRP', year: '26', roomName: '204', teacherName: 'Жасур Каримов', lessonCount: 60, lessonDurationMinutes: 120, frequency: '3 раза в неделю', maxStudents: 15, status: 'open', startDate: new Date('2026-09-20T18:00:00Z'), endDate: new Date('2027-01-30T20:00:00Z'), schedule: [{ dayOfWeek: 1, startTime: '18:00', endTime: '20:00' }, { dayOfWeek: 3, startTime: '18:00', endTime: '20:00' }, { dayOfWeek: 5, startTime: '18:00', endTime: '20:00' }] },
    { branch: 'ONL', courseCode: 'VC', courseSlug: 'vibe-coding', type: 'GRP', year: '26', roomName: 'Онлайн-класс', teacherName: 'Жасур Каримов', lessonCount: 60, lessonDurationMinutes: 120, frequency: '3 раза в неделю', maxStudents: 25, status: 'in_progress', startDate: new Date('2026-08-10T20:00:00Z'), endDate: new Date('2026-12-28T22:00:00Z'), schedule: [{ dayOfWeek: 1, startTime: '20:00', endTime: '22:00' }, { dayOfWeek: 3, startTime: '20:00', endTime: '22:00' }, { dayOfWeek: 5, startTime: '20:00', endTime: '22:00' }] },
    { branch: 'CYP', courseCode: 'AIC', courseSlug: 'ai-creator', type: 'GRP', year: '26', roomName: '102', teacherName: 'Жасур Каримов', lessonCount: 24, lessonDurationMinutes: 120, frequency: '2 раза в неделю', maxStudents: 14, status: 'in_progress', startDate: new Date('2026-08-12T16:00:00Z'), endDate: new Date('2026-11-20T18:00:00Z'), schedule: [{ dayOfWeek: 3, startTime: '16:00', endTime: '18:00' }, { dayOfWeek: 5, startTime: '16:00', endTime: '18:00' }] },
    { branch: 'CYP', courseCode: 'AIC', courseSlug: 'ai-creator', type: 'GRP', year: '26', roomName: '204', teacherName: 'Жасур Каримов', lessonCount: 24, lessonDurationMinutes: 120, frequency: '1 раз в неделю', maxStudents: 12, status: 'open', startDate: new Date('2026-09-18T10:00:00Z'), endDate: new Date('2027-02-28T12:00:00Z'), schedule: [{ dayOfWeek: 5, startTime: '10:00', endTime: '12:00' }] },
    { branch: 'ONL', courseCode: 'AIC', courseSlug: 'ai-creator', type: 'GRP', year: '26', roomName: 'Онлайн-класс', teacherName: 'Жасур Каримов', lessonCount: 24, lessonDurationMinutes: 120, frequency: '2 раза в неделю', maxStudents: 20, status: 'in_progress', startDate: new Date('2026-08-05T17:00:00Z'), endDate: new Date('2026-11-15T19:00:00Z'), schedule: [{ dayOfWeek: 2, startTime: '17:00', endTime: '19:00' }, { dayOfWeek: 4, startTime: '17:00', endTime: '19:00' }] },
    { branch: 'CYP', courseCode: 'AIK', courseSlug: 'ai-kids', type: 'GRP', year: '26', roomName: '101', teacherName: 'Елена Ким', lessonCount: 16, lessonDurationMinutes: 120, frequency: '2 раза в неделю', maxStudents: 12, status: 'in_progress', startDate: new Date('2026-08-08T11:00:00Z'), endDate: new Date('2026-10-30T13:00:00Z'), schedule: [{ dayOfWeek: 2, startTime: '11:00', endTime: '13:00' }, { dayOfWeek: 4, startTime: '11:00', endTime: '13:00' }] },
    { branch: 'CYP', courseCode: 'AIK', courseSlug: 'ai-kids', type: 'GRP', year: '26', roomName: '101', teacherName: 'Елена Ким', lessonCount: 16, lessonDurationMinutes: 120, frequency: '1 раз в неделю', maxStudents: 10, status: 'open', startDate: new Date('2026-09-22T14:00:00Z'), endDate: new Date('2027-01-20T16:00:00Z'), schedule: [{ dayOfWeek: 6, startTime: '14:00', endTime: '16:00' }] },
    { branch: 'ONL', courseCode: 'AIK', courseSlug: 'ai-kids', type: 'GRP', year: '26', roomName: 'Онлайн-класс', teacherName: 'Елена Ким', lessonCount: 16, lessonDurationMinutes: 120, frequency: '1 раз в неделю', maxStudents: 15, status: 'in_progress', startDate: new Date('2026-08-14T10:00:00Z'), endDate: new Date('2026-12-05T12:00:00Z'), schedule: [{ dayOfWeek: 5, startTime: '10:00', endTime: '12:00' }] },
    { branch: 'CYP', courseCode: 'VC', courseSlug: 'vibe-coding', type: 'IND', year: '26', roomName: '117', teacherName: 'Жасур Каримов', lessonCount: 60, lessonDurationMinutes: 120, frequency: '2 раза в неделю', maxStudents: 1, status: 'in_progress', startDate: new Date('2026-08-18T12:00:00Z'), endDate: new Date('2027-03-01T14:00:00Z'), schedule: [{ dayOfWeek: 1, startTime: '12:00', endTime: '14:00' }, { dayOfWeek: 3, startTime: '12:00', endTime: '14:00' }] },
  ];

  for (let i = 0; i < desiredGroups.length; i++) {
    const dg = desiredGroups[i];
    // Check if group already created
    const existingKey = Object.keys(groupMap).find(
      (name) => name.startsWith(`${dg.branch}-${dg.courseCode}-${dg.type}-${dg.year}-`) && groupMap[name],
    );
    if (existingKey && i < 5) {
      continue; // Keep the original first 5 groups
    }

    maxSeq += 1;
    const codeSuffix = String(maxSeq).padStart(4, '0');
    const groupCode = `${dg.branch}-${dg.courseCode}-${dg.type}-${dg.year}-${codeSuffix}`;

    const ins = await exec(
      `INSERT INTO academy_groups
        (name, course_id, school_id, room_id, teacher_id, schedule, lesson_count,
         lesson_duration_minutes, frequency, max_students, status, start_date, end_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        groupCode,
        courseMap[dg.courseSlug],
        schoolId,
        roomMap[dg.roomName] || Object.values(roomMap)[0],
        teacherMap[dg.teacherName],
        JSON.stringify(dg.schedule),
        dg.lessonCount,
        dg.lessonDurationMinutes,
        dg.frequency,
        dg.maxStudents,
        dg.status,
        dg.startDate,
        dg.endDate,
      ],
    );
    groupMap[groupCode] = ins.rows[0].id;
  }

  console.log(`[ok] ${Object.keys(groupMap).length} groups verified and seeded per AGENTS.md format`);
  return groupMap;
}

// 7. Seed 80 Students
async function seedStudents(
  schoolId: number,
  courseMap: Record<string, number>,
  groupMap: Record<string, number>,
  userMap: Record<string, number>,
) {
  const azizId = userMap['aziz@01academy.uz'] || userMap['sheri'];
  const madinaId = userMap['madina@01academy.uz'] || azizId;
  const groupIds = Object.values(groupMap);
  const groupCodes = Object.keys(groupMap);

  const studentIds: number[] = [];
  const TOTAL_STUDENTS = 80;

  for (let i = 0; i < TOTAL_STUDENTS; i++) {
    const person = generatePerson(i + 1);
    const assignedGroupCode = groupCodes[i % groupCodes.length];
    const assignedGroupId = groupMap[assignedGroupCode];

    let courseSlug = 'vibe-coding';
    let studentAge = 16 + (i % 6);
    let basePrice = 2000000;
    if (assignedGroupCode.includes('AIK')) {
      courseSlug = 'ai-kids';
      studentAge = 7 + (i % 4);
      basePrice = 1200000;
    } else if (assignedGroupCode.includes('AIC')) {
      courseSlug = 'ai-creator';
      studentAge = 11 + (i % 4);
      basePrice = 1440000;
    }

    const courseId = courseMap[courseSlug];
    const refCode = `REF-${String(i + 1).padStart(4, '0')}`;
    const balance = (i % 3 === 0) ? 0 : basePrice;
    const attendance = 75 + (i * 7) % 25;
    const progress = 20 + (i * 5) % 75;
    const managerId = (i % 2 === 0) ? azizId : madinaId;
    const status = (i % 15 === 0) ? 'trial' : (i % 25 === 0 ? 'paused' : 'studying');

    const exist = await exec(
      `SELECT id FROM academy_students WHERE phone = $1 OR student_name = $2 LIMIT 1`,
      [person.phone, person.fullName],
    );

    let sid: number;
    if (exist.rows[0]?.id) {
      sid = exist.rows[0].id;
    } else {
      const daysAgo = 10 + (i % 40);
      const ins = await exec(
        `INSERT INTO academy_students
          (contact_name, phone, student_name, student_age, course_id, school_id,
           group_id, manager_id, status, balance_uzs, attendance_percent,
           progress_percent, referral_code, enrolled_at, enrollment_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now() - ($14 || ' days')::interval, now() - ($14 || ' days')::interval)
         RETURNING id`,
        [
          person.parentName,
          person.phone,
          person.fullName,
          studentAge,
          courseId,
          schoolId,
          assignedGroupId,
          managerId,
          status,
          balance,
          attendance,
          progress,
          refCode,
          String(daysAgo),
        ],
      );
      sid = ins.rows[0].id;

      // Group enrollment
      await exec(
        `INSERT INTO academy_student_group_enrollments (student_id, group_id, status, is_primary, enrolled_at)
         VALUES ($1, $2, 'active', true, now() - ($3 || ' days')::interval)
         ON CONFLICT DO NOTHING`,
        [sid, assignedGroupId, String(daysAgo)],
      );
    }
    studentIds.push(sid);
  }

  console.log(`[ok] seeded ${studentIds.length} students across all course groups`);
  return studentIds;
}

// 8. Seed 100+ Leads Pipeline
async function seedLeads(
  schoolId: number,
  courseMap: Record<string, number>,
  sourceMap: Record<string, number>,
  userMap: Record<string, number>,
) {
  const azizId = userMap['aziz@01academy.uz'] || userMap['sheri'];
  const madinaId = userMap['madina@01academy.uz'] || azizId;
  const sources = Object.keys(sourceMap);
  const courses = Object.keys(courseMap);

  const STAGE_DISTRIBUTION: { status: string; count: number; note: string }[] = [
    { status: 'new_request', count: 20, note: 'Новая заявка с таргетированной рекламы' },
    { status: 'first_contact', count: 15, note: 'Первый контакт установлен, уточняются детали' },
    { status: 'qualified', count: 15, note: 'Лид квалифицирован, подходит по возрасту и расписанию' },
    { status: 'demo_invited', count: 12, note: 'Приглашен на открытый демо-урок в Cyberpark' },
    { status: 'ne_prishli_na_vstrechu', count: 5, note: 'Не пришли на встречу, назначен перезвон' },
    { status: 'demo_attended', count: 10, note: 'Посетили вводный урок, высокий интерес ученика' },
    { status: 'offer', count: 8, note: 'Сформировано коммерческое предложение со скидкой 15%' },
    { status: 'thinking', count: 8, note: 'Думают над расписанием, ответят в конце недели' },
    { status: 'enrolled', count: 10, note: 'Записан в группу, ожидает дату первого занятия' },
    { status: 'paid', count: 15, note: 'Оплатил обучение за первый модуль' },
    { status: 'not_now', count: 6, note: 'Перенесли обучение на следующий сезон' },
  ];

  const leadIds: number[] = [];
  let personIdx = 100; // offset so phone numbers are unique from students

  for (const dist of STAGE_DISTRIBUTION) {
    for (let c = 0; c < dist.count; c++) {
      personIdx++;
      const p = generatePerson(personIdx);
      const courseSlug = courses[c % courses.length];
      const courseId = courseMap[courseSlug];
      const sourceCode = sources[(c * 3) % sources.length];
      const sourceId = sourceMap[sourceCode] || Object.values(sourceMap)[0];
      const managerId = (c % 2 === 0) ? azizId : madinaId;
      const daysAgo = 1 + (c % 25);

      const exist = await exec(`SELECT id FROM academy_leads WHERE phone = $1 LIMIT 1`, [p.phone]);
      let lid: number;
      if (exist.rows[0]?.id) {
        lid = exist.rows[0].id;
      } else {
        const expectedPayment = courseSlug === 'vibe-coding' ? 2000000 : (courseSlug === 'ai-creator' ? 1440000 : 1200000);
        const ins = await exec(
          `INSERT INTO academy_leads
            (contact_name, phone, student_name, student_age, course_id, school_id,
             source_id, status_code, manager_id, comment, language, expected_payment_uzs, offer_price_uzs, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ru',$11,$11, now() - ($12 || ' days')::interval)
           RETURNING id`,
          [
            p.parentName,
            p.phone,
            p.firstName,
            12 + (c % 6),
            courseId,
            schoolId,
            sourceId,
            dist.status,
            managerId,
            dist.note,
            expectedPayment,
            String(daysAgo),
          ],
        );
        lid = ins.rows[0].id;

        // Lead phone
        const normPhone = p.phone.replace(/\D/g, '');
        await exec(
          `INSERT INTO academy_lead_phones (lead_id, phone, normalized_phone, is_primary)
           VALUES ($1, $2, $3, true)
           ON CONFLICT DO NOTHING`,
          [lid, p.phone, normPhone],
        );

        // Lead comment
        await exec(
          `INSERT INTO academy_lead_comments (lead_id, author_id, body, created_at)
           VALUES ($1, $2, $3, now() - ($4 || ' days')::interval)`,
          [lid, managerId, dist.note, String(daysAgo)],
        );

        // Stage history
        await exec(
          `INSERT INTO academy_lead_stage_history (lead_id, to_status_code, changed_by, entered_at)
           VALUES ($1, $2, $3, now() - ($4 || ' days')::interval)`,
          [lid, dist.status, managerId, String(daysAgo)],
        );
      }
      leadIds.push(lid);
    }
  }

  console.log(`[ok] seeded ${leadIds.length} leads across all sales pipeline stages`);
  return leadIds;
}

// 9. Seed 60+ Payments (HUGE SALES)
async function seedPayments(
  studentIds: number[],
  groupMap: Record<string, number>,
  userMap: Record<string, number>,
) {
  const sheriId = userMap['sheri'];
  const farrukhId = userMap['farrukh@01academy.uz'] || sheriId;
  const groupIds = Object.values(groupMap);

  let totalSalesUzs = 0;
  let paymentCount = 0;

  // Create 60 payments from student list
  const TARGET_PAYMENTS = 60;
  for (let i = 0; i < TARGET_PAYMENTS; i++) {
    const sid = studentIds[i % studentIds.length];
    const gid = groupIds[i % groupIds.length];
    const daysAgo = 1 + (i % 45);

    // Varied amounts: 2,500,000 / 2,000,000 / 1,800,000 / 1,440,000 / 1,200,000
    const amounts = [2000000, 2500000, 1440000, 1800000, 1200000, 2000000];
    const amount = amounts[i % amounts.length];
    const methods = ['transfer', 'card', 'cash', 'card', 'transfer'];
    const method = methods[i % methods.length];
    const types = ['full', 'full', 'installment_1_2', 'full'];
    const type = types[i % types.length];

    const exist = await exec(
      `SELECT id FROM academy_payments WHERE student_id = $1 AND amount_uzs = $2 AND paid_at >= now() - ($3 || ' days')::interval - interval '1 hour' LIMIT 1`,
      [sid, amount, String(daysAgo)],
    );

    if (!exist.rows[0]?.id) {
      await exec(
        `INSERT INTO academy_payments
          (student_id, group_id, amount_uzs, type, method, status, paid_at, confirmed_by, comment)
         VALUES ($1, $2, $3, $4, $5, 'paid', now() - ($6 || ' days')::interval, $7, 'Оплата за обучение (модуль ' || (($8 % 4) + 1) || ')')`,
        [sid, gid, amount, type, method, String(daysAgo), (i % 2 === 0 ? sheriId : farrukhId), i],
      );
      totalSalesUzs += amount;
      paymentCount++;
    }
  }

  const formattedSales = new Intl.NumberFormat('ru-RU').format(totalSalesUzs);
  console.log(`[ok] seeded ${paymentCount} new payments. Total sales: ${formattedSales} UZS`);
}

// 10. Seed Demo Lessons & Participants
async function seedDemoLessons(
  schoolId: number,
  roomMap: Record<string, number>,
  courseMap: Record<string, number>,
  teacherMap: Record<string, number>,
  studentIds: number[],
  leadIds: number[],
  userMap: Record<string, number>,
) {
  const sheriId = userMap['sheri'];
  const vcCourseId = courseMap['vibe-coding'];
  const aicCourseId = courseMap['ai-creator'];
  const aikCourseId = courseMap['ai-kids'];
  const jasurId = teacherMap['Жасур Каримов'];
  const elenaId = teacherMap['Елена Ким'];

  const demos = [
    { courseId: vcCourseId, teacherId: jasurId, roomName: '117', hoursFromNow: 48, notes: 'Вводный открытый урок: Создай свое первое AI-приложение за 90 минут', status: 'scheduled' },
    { courseId: aicCourseId, teacherId: jasurId, roomName: '102', hoursFromNow: 72, notes: 'Мастер-класс: Генерация видео и контента с помощью искусственного интеллекта', status: 'scheduled' },
    { courseId: aikCourseId, teacherId: elenaId, roomName: '101', hoursFromNow: -24, notes: 'Пробный интерактивный урок по AI Kids для детей 7-10 лет', status: 'completed' },
    { courseId: vcCourseId, teacherId: jasurId, roomName: '117', hoursFromNow: -72, notes: 'Открытый демо-урок Vibe Coding для старшеклассников', status: 'completed' },
  ];

  for (const d of demos) {
    const roomId = roomMap[d.roomName] || Object.values(roomMap)[0];
    const exist = await exec(
      `SELECT id FROM academy_demo_lessons WHERE course_id = $1 AND teacher_id = $2 AND status = $3 LIMIT 1`,
      [d.courseId, d.teacherId, d.status],
    );

    let demoId: number;
    if (exist.rows[0]?.id) {
      demoId = exist.rows[0].id;
    } else {
      const ins = await exec(
        `INSERT INTO academy_demo_lessons
          (course_id, school_id, room_id, teacher_id, scheduled_at, duration_minutes, format, status, notes, created_by)
         VALUES ($1, $2, $3, $4, now() + ($5 || ' hours')::interval, 90, 'offline', $6, $7, $8)
         RETURNING id`,
        [d.courseId, schoolId, roomId, d.teacherId, String(d.hoursFromNow), d.status, d.notes, sheriId],
      );
      demoId = ins.rows[0].id;

      // Add 4-6 student participants for each demo lesson
      const startIdx = (demos.indexOf(d) * 5) % studentIds.length;
      for (let j = 0; j < 5; j++) {
        const sid = studentIds[(startIdx + j) % studentIds.length];
        const partStatus = d.status === 'completed' ? 'attended' : 'confirmed';
        await exec(
          `INSERT INTO academy_demo_lesson_participants (demo_lesson_id, student_id, status)
           VALUES ($1, $2, $3)
           ON CONFLICT (demo_lesson_id, student_id) DO NOTHING`,
          [demoId, sid, partStatus],
        );
      }
    }
  }
  console.log(`[ok] seeded demo lessons and participants`);
}

// 11. Seed Conducted Lessons & Attendance
async function seedLessonsAndAttendance(
  groupMap: Record<string, number>,
  courseMap: Record<string, number>,
  schoolId: number,
  roomMap: Record<string, number>,
  teacherMap: Record<string, number>,
  studentIds: number[],
  userMap: Record<string, number>,
) {
  const sheriId = userMap['sheri'];
  const jasurId = teacherMap['Жасур Каримов'];
  const elenaId = teacherMap['Елена Ким'];

  const groupsToSeed = Object.entries(groupMap).slice(0, 5); // first 5 active groups
  let totalLessons = 0;

  for (const [groupCode, groupId] of groupsToSeed) {
    const isVibe = groupCode.includes('VC');
    const isAik = groupCode.includes('AIK');
    const courseId = isVibe ? courseMap['vibe-coding'] : (isAik ? courseMap['ai-kids'] : courseMap['ai-creator']);
    const teacherId = isAik ? elenaId : jasurId;
    const roomName = isVibe ? '117' : (isAik ? '101' : '102');
    const roomId = roomMap[roomName] || Object.values(roomMap)[0];

    const lessonCount = 8;
    for (let num = 1; num <= lessonCount; num++) {
      const daysAgo = (lessonCount - num) * 3 + 2;
      const topic = `Урок ${num}: ${isVibe ? 'Промпт-инжиниринг и код' : (isAik ? 'AI сказки и арт' : 'AI видео и анимация')}`;

      const exist = await exec(
        `SELECT id FROM academy_lessons WHERE group_id = $1 AND lesson_number = $2 LIMIT 1`,
        [groupId, num],
      );

      let lessonId: number;
      if (exist.rows[0]?.id) {
        lessonId = exist.rows[0].id;
      } else {
        const ins = await exec(
          `INSERT INTO academy_lessons
            (group_id, course_id, school_id, room_id, teacher_id, lesson_number, topic, scheduled_at, duration_minutes, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,now() - ($8 || ' days')::interval, 120, 'conducted')
           RETURNING id`,
          [groupId, courseId, schoolId, roomId, teacherId, num, topic, String(daysAgo)],
        );
        lessonId = ins.rows[0].id;
        totalLessons++;

        // Mark attendance for 6-8 students
        const groupStudents = studentIds.slice(0, 15);
        for (let s = 0; s < groupStudents.length; s++) {
          const sid = groupStudents[s];
          const isPresent = !((s + num) % 7 === 0); // ~85% attendance rate
          await exec(
            `INSERT INTO academy_attendance (lesson_id, student_id, status, marked_by)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (lesson_id, student_id) DO NOTHING`,
            [lessonId, sid, isPresent ? 'present' : 'absent', sheriId],
          );
        }
      }
    }
  }

  console.log(`[ok] seeded conducted lessons and student attendance records`);
}

// 12. Seed 25 Kanban Board Tasks
async function seedBoardsAndTasks(userMap: Record<string, number>, leadIds: number[]) {
  const sheriId = userMap['sheri'];
  const azizId = userMap['aziz@01academy.uz'] || sheriId;
  const jasurId = userMap['jasur@01academy.uz'] || sheriId;
  const dilnozaId = userMap['dilnoza@01academy.uz'] || sheriId;
  const farrukhId = userMap['farrukh@01academy.uz'] || sheriId;
  const madinaId = userMap['madina@01academy.uz'] || azizId;
  const elenaId = userMap['elena@01academy.uz'] || sheriId;

  let boardId: number;
  const existBoard = await exec(`SELECT id FROM boards WHERE is_default = true LIMIT 1`);
  if (existBoard.rows[0]?.id) {
    boardId = existBoard.rows[0].id;
  } else {
    const ins = await exec(
      `INSERT INTO boards (name, description, is_default, created_by)
       VALUES ('Главная доска задач', 'Операционные и стратегические задачи команды 01 Academy', true, $1)
       RETURNING id`,
      [sheriId],
    );
    boardId = ins.rows[0].id;
  }

  const tasks = [
    { title: 'Срочный обзвон 20 новых лидов с Meta Ads', description: 'Квалифицировать новые заявки, записать на демо-урок этой субботы.', status: 'todo', priority: 'urgent', color: 'rose', assigneeId: azizId },
    { title: 'Подготовить демо-проект Vibe Coding: AI помощник', description: 'Разработать демонстрационный Telegram-бот на глазах у родителей.', status: 'in_progress', priority: 'normal', color: 'blue', assigneeId: jasurId },
    { title: 'Запустить масштабирование кампании Meta Ads (бюджет 10M UZS)', description: 'Протестировать новые креативы с видео-отзывами выпускников.', status: 'todo', priority: 'urgent', color: 'violet', assigneeId: dilnozaId },
    { title: 'Сверить финансовые поступления за август и начало сентября', description: 'Закрыть реестр оплат, выставить счета на следующий месяц.', status: 'done', priority: 'normal', color: 'emerald', assigneeId: farrukhId },
    { title: 'Опрос родителей групп AI Kids (Cyberpark каб. 101)', description: 'Собрать обратную связь по прогрессу детей и домашним проектам.', status: 'in_progress', priority: 'normal', color: 'amber', assigneeId: elenaId },
    { title: 'Перезвонить лидам в статусе "Думает"', description: 'Предложить спецпредложение со скидкой 15% при оплате до 10 сентября.', status: 'todo', priority: 'normal', color: 'rose', assigneeId: madinaId },
    { title: 'Обновить учебный план Vibe Coding (модуль Backend)', description: 'Добавить тему по работе с PostgreSQL и drizzle-orm.', status: 'in_progress', priority: 'normal', color: 'blue', assigneeId: jasurId },
    { title: 'Оформить заявки на закупку дополнительных мониторов', description: '10 мониторов 27 дюймов для учебного класса 117.', status: 'done', priority: 'normal', color: 'emerald', assigneeId: farrukhId },
    { title: 'Провести рассылку по базе отказников с предложением интенсива', description: 'Email и SMS рассылка для 50 лидов в архиве.', status: 'backlog', priority: 'low', color: 'cyan', assigneeId: dilnozaId },
    { title: 'Индивидуальная консультация родителя по курсу AI Creator', description: 'Встреча в офисе Cyberpark в пятницу 16:00.', status: 'todo', priority: 'normal', color: 'amber', assigneeId: azizId },
    { title: 'Контроль посещаемости онлайн-групп ONL-VC-GRP', description: 'Проверить записи занятий и активность студентов в чате.', status: 'in_progress', priority: 'normal', color: 'blue', assigneeId: jasurId },
    { title: 'Подготовить сертификаты для завершивших 1 модуль', description: '25 сертификатов для студентов Vibe Coding и AI Creator.', status: 'todo', priority: 'normal', color: 'emerald', assigneeId: madinaId },
  ];

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const exist = await exec(`SELECT id FROM board_tasks WHERE board_id = $1 AND title = $2 LIMIT 1`, [boardId, t.title]);
    if (!exist.rows[0]?.id) {
      await exec(
        `INSERT INTO board_tasks
          (board_id, title, description, status, priority, color, position, creator_id, assignee_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [boardId, t.title, t.description, t.status, t.priority, t.color, i, sheriId, t.assigneeId],
      );
    }
  }
  console.log(`[ok] ${tasks.length} kanban tasks seeded`);
}

// 13. Seed 30 Telephony Calls
async function seedTelephonyCalls(userMap: Record<string, number>, leadIds: number[]) {
  const azizId = userMap['aziz@01academy.uz'] || userMap['sheri'];
  const madinaId = userMap['madina@01academy.uz'] || azizId;

  const notes = [
    'Консультация по курсу Vibe Coding, объяснили формат и расписание',
    'Первый звонок по заявке с сайта, лид готов прийти на демо в субботу',
    'Звонок родителю: обсудили оплату и рассрочку на 2 месяца',
    'Уточнение расписания занятий в классе Cyberpark',
    'Обратный звонок: согласовали время открытого урока',
    'Входящий звонок: вопрос по скидке на семейное обучение двух детей',
    'Напоминание о предстоящем занятии в понедельник',
    'Лид попросил перезвонить после 18:00',
  ];

  for (let i = 0; i < 30; i++) {
    const person = generatePerson(i + 50);
    const direction = i % 3 === 0 ? 'inbound' : 'outbound';
    const status = i % 6 === 0 ? 'missed' : 'answered';
    const duration = status === 'missed' ? 0 : 90 + (i * 17) % 240;
    const talkDuration = status === 'missed' ? 0 : Math.max(0, duration - 15);
    const leadId = leadIds[i % leadIds.length];
    const managerId = i % 2 === 0 ? azizId : madinaId;
    const note = notes[i % notes.length];
    const hoursAgo = 1 + (i * 3);

    const exist = await exec(`SELECT id FROM telephony_calls WHERE phone = $1 LIMIT 1`, [person.phone]);
    if (!exist.rows[0]?.id) {
      await exec(
        `INSERT INTO telephony_calls
          (direction, status, phone, contact_name, duration_seconds, talk_seconds, note, lead_id, user_id, started_at, answered_at, ended_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() - ($10 || ' hours')::interval, now() - ($10 || ' hours')::interval + interval '10 seconds', now() - ($10 || ' hours')::interval + ($11 || ' seconds')::interval)`,
        [direction, status, person.phone, person.fullName, duration, talkDuration, note, leadId, managerId, String(hoursAgo), String(duration)],
      );
    }
  }
  console.log(`[ok] seeded 30 telephony call records`);
}

// 14. Company Settings & Expenses
async function seedSettingsAndExpenses(userMap: Record<string, number>, sourceMap: Record<string, number>) {
  const sheriId = userMap['sheri'];
  const farrukhId = userMap['farrukh@01academy.uz'] || sheriId;

  // Company settings - higher targets for active business
  await exec(
    `UPDATE academy_company_settings
     SET target_revenue_monthly_uzs = 200000000,
         target_new_leads_monthly = 150,
         max_cac_uzs = 350000,
         target_roas = 6,
         target_attendance_percent = 85,
         target_nps = 70,
         updated_by = $1`,
    [sheriId],
  );

  const igSourceId = sourceMap['instagram'];
  const metaSourceId = sourceMap['meta_lead_ads'];
  const webSourceId = sourceMap['website'];

  const marketing = [
    { sourceId: metaSourceId, channel: 'instagram', campaign: 'Meta Ads - Осенний набор Vibe Coding', amount: 8500000 },
    { sourceId: igSourceId, channel: 'instagram', campaign: 'Инфлюенсеры & IT блогеры Ташкента', amount: 5000000 },
    { sourceId: metaSourceId, channel: 'instagram', campaign: 'Meta Ads - AI Creator для подростков', amount: 6200000 },
    { sourceId: webSourceId, channel: 'website', campaign: 'Контекстная реклама Google & Яндекс', amount: 3800000 },
  ];

  for (const m of marketing) {
    const exist = await exec(`SELECT id FROM academy_marketing_expenses WHERE campaign_name = $1 LIMIT 1`, [m.campaign]);
    if (!exist.rows[0]?.id) {
      await exec(
        `INSERT INTO academy_marketing_expenses
          (source_id, channel, campaign_name, period_start, period_end, amount_uzs, status, created_by, approved_by, approved_at)
         VALUES ($1, $2, $3, now() - interval '30 days', now(), $4, 'approved', $5, $5, now() - interval '15 days')`,
        [m.sourceId, m.channel, m.campaign, m.amount, sheriId],
      );
    }
  }

  const operating = [
    { category: 'rent', title: 'Аренда учебных аудиторий Cyberpark (Август-Сентябрь)', amount: 28000000, vendor: 'Cyberpark LLC' },
    { category: 'utilities', title: 'Высокоскоростной оптоволоконный интернет & Хостинг', amount: 3200000, vendor: 'Uztelecom' },
    { category: 'software', title: 'Корпоративные подписки OpenAI API, Anthropic, Midjourney', amount: 6500000, vendor: 'AI Providers' },
    { category: 'supplies', title: 'Учебные материалы, тетради и мерч для студентов', amount: 4200000, vendor: 'Print House' },
    { category: 'maintenance', title: 'Техническое обслуживание ПК и сетевого оборудования', amount: 2100000, vendor: 'Tech Service' },
  ];

  for (const o of operating) {
    const exist = await exec(`SELECT id FROM academy_operating_expenses WHERE title = $1 LIMIT 1`, [o.title]);
    if (!exist.rows[0]?.id) {
      await exec(
        `INSERT INTO academy_operating_expenses
          (category, title, amount_uzs, vendor, expense_date, status, method, created_by)
         VALUES ($1, $2, $3, $4, now() - interval '10 days', 'paid', 'transfer', $5)`,
        [o.category, o.title, o.amount, o.vendor, farrukhId],
      );
    }
  }
  console.log(`[ok] updated company targets and financial expenses`);
}

async function main() {
  try {
    console.log('--- Scaling & Seeding 5x Demo Data for Academy CRM ---');

    const userMap = await seedUsers();
    const { schoolId, roomMap } = await seedSchoolsAndRooms();
    const courseMap = await seedCourses();
    const sourceMap = await seedStatusesAndSources();
    const teacherMap = await seedTeachers(userMap, courseMap, schoolId);
    const groupMap = await seedGroups(schoolId, roomMap, courseMap, teacherMap);
    const studentIds = await seedStudents(schoolId, courseMap, groupMap, userMap);
    const leadIds = await seedLeads(schoolId, courseMap, sourceMap, userMap);
    await seedDemoLessons(schoolId, roomMap, courseMap, teacherMap, studentIds, leadIds, userMap);
    await seedLessonsAndAttendance(groupMap, courseMap, schoolId, roomMap, teacherMap, studentIds, userMap);
    await seedPayments(studentIds, groupMap, userMap);
    await seedBoardsAndTasks(userMap, leadIds);
    await seedTelephonyCalls(userMap, leadIds);
    await seedSettingsAndExpenses(userMap, sourceMap);

    const r = await exec(
      `SELECT
         (SELECT count(*) FROM users) AS users,
         (SELECT count(*) FROM academy_courses) AS courses,
         (SELECT count(*) FROM academy_groups) AS groups,
         (SELECT count(*) FROM academy_students) AS students,
         (SELECT count(*) FROM academy_leads) AS leads,
         (SELECT count(*) FROM academy_payments) AS payments,
         (SELECT coalesce(sum(amount_uzs), 0) FROM academy_payments WHERE status = 'paid') AS total_sales_uzs,
         (SELECT count(*) FROM academy_lessons) AS lessons,
         (SELECT count(*) FROM academy_attendance) AS attendance_records,
         (SELECT count(*) FROM board_tasks) AS tasks,
         (SELECT count(*) FROM telephony_calls) AS calls;`,
    );
    console.log('===============================================================');
    console.log('--- Database successfully populated with 5x expanded dataset ---');
    console.log('Database Statistics:', r.rows[0]);
    console.log('Total sales revenue:', new Intl.NumberFormat('ru-RU').format(Number(r.rows[0].total_sales_uzs)), 'UZS');
    console.log('===============================================================');
  } catch (e) {
    console.error('[error during seed]', e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
