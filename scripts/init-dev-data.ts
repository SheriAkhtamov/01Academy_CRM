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

async function exists(table: string, whereSql: string, params: any[] = []) {
  const r = await exec(`SELECT 1 FROM ${table} WHERE ${whereSql} LIMIT 1`, params);
  return r.rows.length > 0;
}

// 1. Super Admin and Staff Users
async function seedUsers() {
  const superHash = await bcrypt.hash(SUPER.password, 12);
  const staffHash = await bcrypt.hash('Sheri2001', 12);

  // Super Admin: Sheri
  const existingSuper = await exec(
    `SELECT id FROM users WHERE lower(email) = lower($1) OR lower(full_name) = lower($2) ORDER BY id LIMIT 1`,
    [SUPER.email, SUPER.username],
  );

  let superUserId: number;
  if (existingSuper.rows[0]?.id) {
    superUserId = existingSuper.rows[0].id;
    await exec(
      `UPDATE users
       SET email = $1,
           password = $2,
           full_name = $3,
           position = $4,
           module = 'administration',
           is_active = true,
           updated_at = now()
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

  // Grant Sheri all modules
  const allModules = ['administration', 'sales', 'teacher', 'marketing', 'finance'];
  for (const mod of allModules) {
    await exec(
      `INSERT INTO user_modules (user_id, module)
       VALUES ($1, $2)
       ON CONFLICT (user_id, module) DO NOTHING`,
      [superUserId, mod],
    );
  }

  // Staff users
  const staff = [
    {
      fullName: 'Азиз Рахимов',
      email: 'aziz@01academy.uz',
      phone: '+998901234567',
      position: 'Старший менеджер по продажам',
      module: 'sales',
      modules: ['sales'],
    },
    {
      fullName: 'Жасур Каримов',
      email: 'jasur@01academy.uz',
      phone: '+998902345678',
      position: 'Senior AI & Web Преподаватель',
      module: 'teacher',
      modules: ['teacher'],
    },
    {
      fullName: 'Елена Ким',
      email: 'elena@01academy.uz',
      phone: '+998903456789',
      position: 'Преподаватель курсов AI Kids',
      module: 'teacher',
      modules: ['teacher'],
    },
    {
      fullName: 'Дильноза Юсупова',
      email: 'dilnoza@01academy.uz',
      phone: '+998904567890',
      position: 'Маркетолог & Growth Lead',
      module: 'marketing',
      modules: ['marketing'],
    },
    {
      fullName: 'Фаррух Алиев',
      email: 'farrukh@01academy.uz',
      phone: '+998905678901',
      position: 'Финансовый менеджер',
      module: 'administration',
      modules: ['administration', 'finance'],
    },
  ];

  const userMap: Record<string, number> = {
    sheri: superUserId,
  };

  for (const s of staff) {
    const r = await exec(
      `SELECT id FROM users WHERE lower(email) = lower($1) OR lower(full_name) = lower($2) LIMIT 1`,
      [s.email, s.fullName],
    );
    let uid: number;
    if (r.rows[0]?.id) {
      uid = r.rows[0].id;
      await exec(
        `UPDATE users
         SET email = $1, password = $2, full_name = $3, phone = $4, position = $5, module = $6, is_active = true, updated_at = now()
         WHERE id = $7`,
        [s.email, staffHash, s.fullName, s.phone, s.position, s.module, uid],
      );
    } else {
      const inserted = await exec(
        `INSERT INTO users (email, password, full_name, phone, position, module, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         RETURNING id`,
        [s.email, staffHash, s.fullName, s.phone, s.position, s.module],
      );
      uid = inserted.rows[0].id;
    }

    userMap[s.email] = uid;
    for (const mod of s.modules) {
      await exec(
        `INSERT INTO user_modules (user_id, module)
         VALUES ($1, $2)
         ON CONFLICT (user_id, module) DO NOTHING`,
        [uid, mod],
      );
    }
  }

  console.log(`[ok] seeded users (Super Admin: ${SUPER.username} / Sheri2001, +${staff.length} staff)`);
  return userMap;
}

// 2. Schools and Rooms
async function seedSchoolsAndRooms() {
  let schoolId: number;
  const existingSchool = await exec(
    `SELECT id FROM academy_schools WHERE code = 'cyberpark' LIMIT 1`,
  );
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
    { name: '101', capacity: 12 },
    { name: '102', capacity: 12 },
    { name: '117', capacity: 16 },
    { name: 'Онлайн-класс', capacity: 25 },
  ];

  const roomMap: Record<string, number> = {};
  for (const rm of rooms) {
    const r = await exec(
      `SELECT id FROM academy_rooms WHERE school_id = $1 AND name = $2 LIMIT 1`,
      [schoolId, rm.name],
    );
    if (r.rows[0]?.id) {
      roomMap[rm.name] = r.rows[0].id;
    } else {
      const ins = await exec(
        `INSERT INTO academy_rooms (school_id, name, capacity, is_active)
         VALUES ($1, $2, $3, true)
         RETURNING id`,
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
          c.name,
          c.slug,
          c.ageCategory,
          c.lessonCount,
          c.lessonDurationMinutes,
          c.frequency,
          c.basePriceUzs,
          c.discountedPriceUzs,
          c.ltvTargetMinUzs,
          c.ltvTargetMaxUzs,
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
       SET name = EXCLUDED.name,
           color = EXCLUDED.color,
           sort_order = EXCLUDED.sort_order,
           is_pipeline = EXCLUDED.is_pipeline,
           is_system = true`,
      [s.code, s.name, s.color, s.sortOrder, s.activePipeline],
    );
  }

  const sourceMap: Record<string, number> = {};
  for (const s of DEFAULT_LEAD_SOURCES) {
    const r = await exec(
      `INSERT INTO academy_lead_sources (code, name, channel, is_system, is_active)
       VALUES ($1,$2,$3,true,true)
       ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name,
           channel = EXCLUDED.channel,
           is_system = true,
           is_active = true,
           updated_at = now()
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
    {
      fullName: 'Жасур Каримов',
      email: 'jasur@01academy.uz',
      courseSlugs: ['vibe-coding', 'ai-creator'],
    },
    {
      fullName: 'Елена Ким',
      email: 'elena@01academy.uz',
      courseSlugs: ['ai-kids'],
    },
  ];

  const teacherMap: Record<string, number> = {};
  for (const td of teacherDefs) {
    const uid = userMap[td.email];
    const cids = td.courseSlugs.map((s) => courseMap[s]).filter(Boolean);
    const existing = await exec(`SELECT id FROM academy_teachers WHERE user_id = $1 LIMIT 1`, [uid]);
    if (existing.rows[0]?.id) {
      teacherMap[td.fullName] = existing.rows[0].id;
      await exec(
        `UPDATE academy_teachers
         SET course_ids = $1, school_ids = $2, status = 'active', updated_at = now()
         WHERE id = $3`,
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

// 6. Course Groups (STRICTLY FOLLOWING AGENTS.MD RULE!)
// Format: [ФИЛИАЛ-ИЛИ-ОНЛАЙН]-[КУРС]-[ТИП]-[ГОД]-[НОМЕР]
// e.g. CYP-VC-GRP-26-0001
async function seedGroups(
  schoolId: number,
  roomMap: Record<string, number>,
  courseMap: Record<string, number>,
  teacherMap: Record<string, number>,
) {
  // Query all existing groups to respect global sequence number max + 1
  const existingGroups = await exec(`SELECT id, name FROM academy_groups ORDER BY id ASC`);
  let maxSeq = 0;
  for (const row of existingGroups.rows) {
    const parts = (row.name || '').split('-');
    const lastPart = parts[parts.length - 1];
    const num = parseInt(lastPart, 10);
    if (!isNaN(num) && num > maxSeq) {
      maxSeq = num;
    }
  }

  const desiredGroups = [
    {
      branch: 'CYP',
      courseCode: 'AIK',
      courseSlug: 'ai-kids',
      type: 'GRP',
      year: '26',
      roomName: '101',
      teacherName: 'Елена Ким',
      lessonCount: 16,
      lessonDurationMinutes: 120,
      frequency: '1 раз в неделю',
      maxStudents: 12,
      status: 'in_progress',
      startDate: new Date('2026-08-01T10:00:00Z'),
      endDate: new Date('2026-11-28T12:00:00Z'),
      schedule: [{ dayOfWeek: 6, startTime: '10:00', endTime: '12:00' }],
    },
    {
      branch: 'CYP',
      courseCode: 'AIC',
      courseSlug: 'ai-creator',
      type: 'GRP',
      year: '26',
      roomName: '102',
      teacherName: 'Жасур Каримов',
      lessonCount: 24,
      lessonDurationMinutes: 120,
      frequency: '1 раз в неделю',
      maxStudents: 12,
      status: 'in_progress',
      startDate: new Date('2026-08-02T14:00:00Z'),
      endDate: new Date('2026-12-20T16:00:00Z'),
      schedule: [{ dayOfWeek: 0, startTime: '14:00', endTime: '16:00' }],
    },
    {
      branch: 'CYP',
      courseCode: 'VC',
      courseSlug: 'vibe-coding',
      type: 'GRP',
      year: '26',
      roomName: '117',
      teacherName: 'Жасур Каримов',
      lessonCount: 60,
      lessonDurationMinutes: 120,
      frequency: '3 раза в неделю',
      maxStudents: 15,
      status: 'in_progress',
      startDate: new Date('2026-08-03T18:30:00Z'),
      endDate: new Date('2026-12-25T20:30:00Z'),
      schedule: [
        { dayOfWeek: 1, startTime: '18:30', endTime: '20:30' },
        { dayOfWeek: 3, startTime: '18:30', endTime: '20:30' },
        { dayOfWeek: 5, startTime: '18:30', endTime: '20:30' },
      ],
    },
    {
      branch: 'ONL',
      courseCode: 'VC',
      courseSlug: 'vibe-coding',
      type: 'GRP',
      year: '26',
      roomName: 'Онлайн-класс',
      teacherName: 'Жасур Каримов',
      lessonCount: 60,
      lessonDurationMinutes: 120,
      frequency: '3 раза в неделю',
      maxStudents: 20,
      status: 'open',
      startDate: new Date('2026-09-15T19:00:00Z'),
      endDate: new Date('2027-02-15T21:00:00Z'),
      schedule: [
        { dayOfWeek: 2, startTime: '19:00', endTime: '21:00' },
        { dayOfWeek: 4, startTime: '19:00', endTime: '21:00' },
        { dayOfWeek: 6, startTime: '19:00', endTime: '21:00' },
      ],
    },
    {
      branch: 'CYP',
      courseCode: 'AIK',
      courseSlug: 'ai-kids',
      type: 'IND',
      year: '26',
      roomName: '101',
      teacherName: 'Елена Ким',
      lessonCount: 16,
      lessonDurationMinutes: 120,
      frequency: '1 раз в неделю',
      maxStudents: 1,
      status: 'in_progress',
      startDate: new Date('2026-08-10T15:00:00Z'),
      endDate: new Date('2026-11-30T17:00:00Z'),
      schedule: [{ dayOfWeek: 1, startTime: '15:00', endTime: '17:00' }],
    },
  ];

  const groupMap: Record<string, number> = {};

  for (const dg of desiredGroups) {
    // Check if group of this branch & course & type already exists
    const prefix = `${dg.branch}-${dg.courseCode}-${dg.type}-${dg.year}-`;
    const found = await exec(
      `SELECT id, name FROM academy_groups WHERE name LIKE $1 LIMIT 1`,
      [`${prefix}%`],
    );

    if (found.rows[0]?.id) {
      groupMap[found.rows[0].name] = found.rows[0].id;
    } else {
      maxSeq += 1;
      const codeSuffix = String(maxSeq).padStart(4, '0');
      const groupCode = `${prefix}${codeSuffix}`;

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
          roomMap[dg.roomName],
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
  }

  console.log(`[ok] groups created strictly following AGENTS.md rules (${Object.keys(groupMap).join(', ')})`);
  return groupMap;
}

// 7. Students & Group Enrollments
async function seedStudents(
  schoolId: number,
  courseMap: Record<string, number>,
  groupMap: Record<string, number>,
  userMap: Record<string, number>,
) {
  const azizId = userMap['aziz@01academy.uz'];
  const sheriId = userMap['sheri'];

  // Map group code to id
  const findGroup = (part: string) => {
    const k = Object.keys(groupMap).find((code) => code.includes(part));
    return k ? groupMap[k] : Object.values(groupMap)[0];
  };

  const studentData = [
    // Vibe Coding group (CYP-VC-GRP)
    {
      studentName: 'Сардор Ахмедов',
      contactName: 'Рано Ахмедова (Мама)',
      phone: '+998901112233',
      studentAge: 16,
      courseSlug: 'vibe-coding',
      groupPart: 'CYP-VC-GRP',
      balanceUzs: 2000000,
      attendancePercent: 92,
      progressPercent: 65,
      status: 'studying',
      refCode: 'REF-001',
    },
    {
      studentName: 'Малика Исмаилова',
      contactName: 'Отабек Исмаилов (Отец)',
      phone: '+998902223344',
      studentAge: 17,
      courseSlug: 'vibe-coding',
      groupPart: 'CYP-VC-GRP',
      balanceUzs: 0,
      attendancePercent: 88,
      progressPercent: 60,
      status: 'studying',
      refCode: 'REF-002',
    },
    {
      studentName: 'Тимур Салимов',
      contactName: 'Дильфуза Салимова (Мама)',
      phone: '+998903334455',
      studentAge: 15,
      courseSlug: 'vibe-coding',
      groupPart: 'CYP-VC-GRP',
      balanceUzs: 2000000,
      attendancePercent: 95,
      progressPercent: 70,
      status: 'studying',
      refCode: 'REF-003',
    },
    {
      studentName: 'Бобур Назаров',
      contactName: 'Бобур Назаров',
      phone: '+998904445566',
      studentAge: 18,
      courseSlug: 'vibe-coding',
      groupPart: 'CYP-VC-GRP',
      balanceUzs: 2000000,
      attendancePercent: 85,
      progressPercent: 55,
      status: 'studying',
      refCode: 'REF-004',
    },
    {
      studentName: 'Джамшид Умаров',
      contactName: 'Нилуфар Умарова (Мама)',
      phone: '+998905556677',
      studentAge: 16,
      courseSlug: 'vibe-coding',
      groupPart: 'CYP-VC-GRP',
      balanceUzs: 0,
      attendancePercent: 78,
      progressPercent: 50,
      status: 'studying',
      refCode: 'REF-005',
    },

    // AI Creator group (CYP-AIC-GRP)
    {
      studentName: 'Камила Рустамова',
      contactName: 'Рустам Каримов (Отец)',
      phone: '+998906667788',
      studentAge: 12,
      courseSlug: 'ai-creator',
      groupPart: 'CYP-AIC-GRP',
      balanceUzs: 1440000,
      attendancePercent: 90,
      progressPercent: 45,
      status: 'studying',
      refCode: 'REF-006',
    },
    {
      studentName: 'Амир Темиров',
      contactName: 'Зарина Темирова (Мама)',
      phone: '+998907778899',
      studentAge: 13,
      courseSlug: 'ai-creator',
      groupPart: 'CYP-AIC-GRP',
      balanceUzs: 1440000,
      attendancePercent: 86,
      progressPercent: 40,
      status: 'studying',
      refCode: 'REF-007',
    },
    {
      studentName: 'Шахло Махмудова',
      contactName: 'Анвар Махмудов (Отец)',
      phone: '+998908889900',
      studentAge: 11,
      courseSlug: 'ai-creator',
      groupPart: 'CYP-AIC-GRP',
      balanceUzs: 0,
      attendancePercent: 95,
      progressPercent: 50,
      status: 'studying',
      refCode: 'REF-008',
    },
    {
      studentName: 'Даврон Зокиров',
      contactName: 'Лола Зокирова (Мама)',
      phone: '+998909990011',
      studentAge: 14,
      courseSlug: 'ai-creator',
      groupPart: 'CYP-AIC-GRP',
      balanceUzs: 1440000,
      attendancePercent: 80,
      progressPercent: 35,
      status: 'studying',
      refCode: 'REF-009',
    },

    // AI Kids group (CYP-AIK-GRP)
    {
      studentName: 'Руслан Юлдашев',
      contactName: 'Гульнора Юлдашева (Мама)',
      phone: '+998911112233',
      studentAge: 8,
      courseSlug: 'ai-kids',
      groupPart: 'CYP-AIK-GRP',
      balanceUzs: 1200000,
      attendancePercent: 100,
      progressPercent: 50,
      status: 'studying',
      refCode: 'REF-010',
    },
    {
      studentName: 'Самира Хакимова',
      contactName: 'Умид Хакимов (Отец)',
      phone: '+998912223344',
      studentAge: 9,
      courseSlug: 'ai-kids',
      groupPart: 'CYP-AIK-GRP',
      balanceUzs: 1200000,
      attendancePercent: 90,
      progressPercent: 45,
      status: 'studying',
      refCode: 'REF-011',
    },
    {
      studentName: 'Мухаммад Расулов',
      contactName: 'Надира Расулова (Мама)',
      phone: '+998913334455',
      studentAge: 7,
      courseSlug: 'ai-kids',
      groupPart: 'CYP-AIK-GRP',
      balanceUzs: 0,
      attendancePercent: 85,
      progressPercent: 40,
      status: 'studying',
      refCode: 'REF-012',
    },

    // Individual
    {
      studentName: 'Диана Цой',
      contactName: 'Артур Цой (Отец)',
      phone: '+998914445566',
      studentAge: 8,
      courseSlug: 'ai-kids',
      groupPart: 'CYP-AIK-IND',
      balanceUzs: 1500000,
      attendancePercent: 95,
      progressPercent: 55,
      status: 'studying',
      refCode: 'REF-013',
    },

    // Online
    {
      studentName: 'Бекзод Мирзаев',
      contactName: 'Саида Мирзаева (Мама)',
      phone: '+998915556677',
      studentAge: 16,
      courseSlug: 'vibe-coding',
      groupPart: 'ONL-VC-GRP',
      balanceUzs: 0,
      attendancePercent: 0,
      progressPercent: 0,
      status: 'trial',
      refCode: 'REF-014',
    },
    {
      studentName: 'Азиза Касымова',
      contactName: 'Бахтиёр Касымов (Отец)',
      phone: '+998916667788',
      studentAge: 15,
      courseSlug: 'vibe-coding',
      groupPart: 'ONL-VC-GRP',
      balanceUzs: 0,
      attendancePercent: 0,
      progressPercent: 0,
      status: 'trial',
      refCode: 'REF-015',
    },
  ];

  const studentIds: number[] = [];

  for (const s of studentData) {
    const groupId = findGroup(s.groupPart);
    const courseId = courseMap[s.courseSlug];

    const exist = await exec(
      `SELECT id FROM academy_students WHERE phone = $1 OR student_name = $2 LIMIT 1`,
      [s.phone, s.studentName],
    );

    let sid: number;
    if (exist.rows[0]?.id) {
      sid = exist.rows[0].id;
    } else {
      const ins = await exec(
        `INSERT INTO academy_students
          (contact_name, phone, student_name, student_age, course_id, school_id,
           group_id, manager_id, status, balance_uzs, attendance_percent,
           progress_percent, referral_code, enrolled_at, enrollment_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now() - interval '30 days',now() - interval '30 days')
         RETURNING id`,
        [
          s.contactName,
          s.phone,
          s.studentName,
          s.studentAge,
          courseId,
          schoolId,
          groupId,
          azizId || sheriId,
          s.status,
          s.balanceUzs,
          s.attendancePercent,
          s.progressPercent,
          s.refCode,
        ],
      );
      sid = ins.rows[0].id;
    }

    studentIds.push(sid);

    // Group enrollment
    await exec(
      `INSERT INTO academy_student_group_enrollments (student_id, group_id, status, is_primary, enrolled_at)
       VALUES ($1, $2, 'active', true, now() - interval '30 days')
       ON CONFLICT DO NOTHING`,
      [sid, groupId],
    );
  }

  console.log(`[ok] seeded ${studentIds.length} students & enrollments`);
  return studentIds;
}

// 8. Leads Pipeline
async function seedLeads(
  schoolId: number,
  courseMap: Record<string, number>,
  sourceMap: Record<string, number>,
  userMap: Record<string, number>,
) {
  const azizId = userMap['aziz@01academy.uz'];
  const sheriId = userMap['sheri'];

  const leads = [
    {
      contactName: 'Мурод Ибрагимов',
      phone: '+998971001122',
      studentName: 'Искандер',
      studentAge: 15,
      courseSlug: 'vibe-coding',
      sourceCode: 'instagram',
      statusCode: 'new_request',
      comment: 'Интересуется программированием с AI, увидел рекламу в сторис',
    },
    {
      contactName: 'Зарина Олимова',
      phone: '+998972002233',
      studentName: 'Ясмина',
      studentAge: 9,
      courseSlug: 'ai-kids',
      sourceCode: 'website',
      statusCode: 'new_request',
      comment: 'Оставила заявку на сайте на курс AI Kids',
    },
    {
      contactName: 'Одил Собиров',
      phone: '+998973003344',
      studentName: 'Сарвар',
      studentAge: 13,
      courseSlug: 'ai-creator',
      sourceCode: 'meta_lead_ads',
      statusCode: 'first_contact',
      comment: 'Позвонили, родитель просит перезвонить вечером после 19:00',
    },
    {
      contactName: 'Нигора Холматова',
      phone: '+998974004455',
      studentName: 'Азиз',
      studentAge: 16,
      courseSlug: 'vibe-coding',
      sourceCode: 'referral',
      statusCode: 'qualified',
      comment: 'Пришли по рекомендации Сардора Ахмедова, есть ноутбук, готов учиться',
    },
    {
      contactName: 'Улугбек Тахиров',
      phone: '+998975005566',
      studentName: 'Темур',
      studentAge: 12,
      courseSlug: 'ai-creator',
      sourceCode: 'instagram',
      statusCode: 'demo_invited',
      comment: 'Приглашен на вводный открытый урок в эту субботу',
    },
    {
      contactName: 'Гульбахор Валиева',
      phone: '+998976006677',
      studentName: 'Севара',
      studentAge: 8,
      courseSlug: 'ai-kids',
      sourceCode: 'website',
      statusCode: 'demo_attended',
      comment: 'Были на демо-уроке, ребенок в восторге, думают над оплатой',
    },
    {
      contactName: 'Алишер Курбанов',
      phone: '+998977007788',
      studentName: 'Асадбек',
      studentAge: 17,
      courseSlug: 'vibe-coding',
      sourceCode: 'telephony',
      statusCode: 'offer',
      comment: 'Выставлено предложение со скидкой 15% на первый модуль',
    },
    {
      contactName: 'Феруза Джалилова',
      phone: '+998978008899',
      studentName: 'Алишер',
      studentAge: 14,
      courseSlug: 'ai-creator',
      sourceCode: 'instagram',
      statusCode: 'thinking',
      comment: 'Сравнивают расписание со школой, ответят в среду',
    },
    {
      contactName: 'Шухрат Ганиев',
      phone: '+998979009900',
      studentName: 'Дилшод',
      studentAge: 16,
      courseSlug: 'vibe-coding',
      sourceCode: 'website',
      statusCode: 'enrolled',
      comment: 'Записан в группу CYP-VC-GRP, ждет старта занятий',
    },
    {
      contactName: 'Мавлюда Каримова',
      phone: '+998971110022',
      studentName: 'Карим',
      studentAge: 10,
      courseSlug: 'ai-creator',
      sourceCode: 'referral',
      statusCode: 'paid',
      comment: 'Оплатили первый месяц обучения перечислением',
    },
    {
      contactName: 'Баходир Бакиров',
      phone: '+998972221133',
      studentName: 'Саид',
      studentAge: 15,
      courseSlug: 'vibe-coding',
      sourceCode: 'telephony',
      statusCode: 'not_now',
      comment: 'Переехали в другой район, просили напомнить зимой',
    },
  ];

  const leadIds: number[] = [];

  for (const l of leads) {
    const courseId = courseMap[l.courseSlug];
    const sourceId = sourceMap[l.sourceCode] || Object.values(sourceMap)[0];

    const exist = await exec(`SELECT id FROM academy_leads WHERE phone = $1 LIMIT 1`, [l.phone]);
    let lid: number;
    if (exist.rows[0]?.id) {
      lid = exist.rows[0].id;
    } else {
      const ins = await exec(
        `INSERT INTO academy_leads
          (contact_name, phone, student_name, student_age, course_id, school_id,
           source_id, status_code, manager_id, comment, language, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ru', now() - interval '5 days')
         RETURNING id`,
        [
          l.contactName,
          l.phone,
          l.studentName,
          l.studentAge,
          courseId,
          schoolId,
          sourceId,
          l.statusCode,
          azizId || sheriId,
          l.comment,
        ],
      );
      lid = ins.rows[0].id;

      // Add phone to academy_lead_phones
      const normPhone = l.phone.replace(/\D/g, '');
      await exec(
        `INSERT INTO academy_lead_phones (lead_id, phone, normalized_phone, is_primary)
         VALUES ($1, $2, $3, true)
         ON CONFLICT DO NOTHING`,
        [lid, l.phone, normPhone],
      );

      // Add comment history
      await exec(
        `INSERT INTO academy_lead_comments (lead_id, author_id, body, created_at)
         VALUES ($1, $2, $3, now() - interval '3 days')`,
        [lid, azizId || sheriId, l.comment],
      );

      // Add stage history
      await exec(
        `INSERT INTO academy_lead_stage_history (lead_id, to_status_code, changed_by, entered_at)
         VALUES ($1, $2, $3, now() - interval '3 days')`,
        [lid, l.statusCode, azizId || sheriId],
      );
    }
    leadIds.push(lid);
  }

  console.log(`[ok] seeded ${leadIds.length} leads in pipeline`);
  return leadIds;
}

// 9. Demo Lessons
async function seedDemoLessons(
  schoolId: number,
  roomMap: Record<string, number>,
  courseMap: Record<string, number>,
  teacherMap: Record<string, number>,
  studentIds: number[],
  userMap: Record<string, number>,
) {
  const vcCourseId = courseMap['vibe-coding'];
  const jasurId = teacherMap['Жасур Каримов'];
  const room117Id = roomMap['117'];
  const sheriId = userMap['sheri'];

  const exist = await exec(
    `SELECT id FROM academy_demo_lessons WHERE course_id = $1 AND school_id = $2 LIMIT 1`,
    [vcCourseId, schoolId],
  );

  let demoLessonId: number;
  if (exist.rows[0]?.id) {
    demoLessonId = exist.rows[0].id;
  } else {
    const ins = await exec(
      `INSERT INTO academy_demo_lessons
        (course_id, school_id, room_id, teacher_id, scheduled_at, duration_minutes, format, status, notes, created_by)
       VALUES ($1, $2, $3, $4, now() + interval '2 days', 90, 'offline', 'scheduled', 'Вводный открытый урок: Создай свое первое AI-приложение за 90 минут', $5)
       RETURNING id`,
      [vcCourseId, schoolId, room117Id, jasurId, sheriId],
    );
    demoLessonId = ins.rows[0].id;
  }

  // Add participants from trial students if available
  if (studentIds.length > 0) {
    const trialStudentId = studentIds[studentIds.length - 1];
    await exec(
      `INSERT INTO academy_demo_lesson_participants (demo_lesson_id, student_id, status)
       VALUES ($1, $2, 'confirmed')
       ON CONFLICT (demo_lesson_id, student_id) DO NOTHING`,
      [demoLessonId, trialStudentId],
    );
  }

  console.log(`[ok] demo lesson created (id: ${demoLessonId})`);
}

// 10. Lessons & Attendance
async function seedLessonsAndAttendance(
  groupMap: Record<string, number>,
  courseMap: Record<string, number>,
  schoolId: number,
  roomMap: Record<string, number>,
  teacherMap: Record<string, number>,
  studentIds: number[],
  userMap: Record<string, number>,
) {
  const vcGroupId = Object.entries(groupMap).find(([k]) => k.includes('CYP-VC-GRP'))?.[1];
  if (!vcGroupId) return;

  const vcCourseId = courseMap['vibe-coding'];
  const jasurId = teacherMap['Жасур Каримов'];
  const room117Id = roomMap['117'];
  const sheriId = userMap['sheri'];

  const lessonTopics = [
    { num: 1, topic: 'Vibe Coding workflow: настройка окружения и первый промпт', daysAgo: 20 },
    { num: 2, topic: 'Архитектура современных AI-приложений и стек', daysAgo: 17 },
    { num: 3, topic: 'Frontend: быстрая сборка интерфейсов с Tailwind', daysAgo: 14 },
    { num: 4, topic: 'State Management и работа с данными', daysAgo: 11 },
    { num: 5, topic: 'Backend API и работа с базой данных', daysAgo: 7 },
    { num: 6, topic: 'Интеграция LLM моделей через SDK', daysAgo: 4 },
  ];

  for (const lt of lessonTopics) {
    const exist = await exec(
      `SELECT id FROM academy_lessons WHERE group_id = $1 AND lesson_number = $2 LIMIT 1`,
      [vcGroupId, lt.num],
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
        [vcGroupId, vcCourseId, schoolId, room117Id, jasurId, lt.num, lt.topic, String(lt.daysAgo)],
      );
      lessonId = ins.rows[0].id;

      // Mark attendance for students 0 to 4 (the Vibe Coding students)
      const vcStudents = studentIds.slice(0, 5);
      for (let i = 0; i < vcStudents.length; i++) {
        const sid = vcStudents[i];
        // 90% attendance: student 4 missed lesson 3
        const isPresent = !(i === 4 && lt.num === 3);
        await exec(
          `INSERT INTO academy_attendance (lesson_id, student_id, status, marked_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (lesson_id, student_id) DO NOTHING`,
          [lessonId, sid, isPresent ? 'present' : 'absent', sheriId],
        );
      }
    }
  }

  console.log(`[ok] seeded 6 conducted lessons with attendance for Vibe Coding group`);
}

// 11. Payments
async function seedPayments(
  studentIds: number[],
  groupMap: Record<string, number>,
  userMap: Record<string, number>,
) {
  const sheriId = userMap['sheri'];
  const vcGroupId = Object.entries(groupMap).find(([k]) => k.includes('CYP-VC-GRP'))?.[1];
  const aicGroupId = Object.entries(groupMap).find(([k]) => k.includes('CYP-AIC-GRP'))?.[1];
  const aikGroupId = Object.entries(groupMap).find(([k]) => k.includes('CYP-AIK-GRP'))?.[1];

  const payments = [
    { studentIdx: 0, groupId: vcGroupId, amount: 2000000, method: 'transfer', daysAgo: 25 },
    { studentIdx: 1, groupId: vcGroupId, amount: 2000000, method: 'card', daysAgo: 24 },
    { studentIdx: 2, groupId: vcGroupId, amount: 2000000, method: 'transfer', daysAgo: 22 },
    { studentIdx: 3, groupId: vcGroupId, amount: 2000000, method: 'cash', daysAgo: 20 },
    { studentIdx: 5, groupId: aicGroupId, amount: 1440000, method: 'card', daysAgo: 18 },
    { studentIdx: 6, groupId: aicGroupId, amount: 1440000, method: 'transfer', daysAgo: 15 },
    { studentIdx: 8, groupId: aicGroupId, amount: 1440000, method: 'cash', daysAgo: 12 },
    { studentIdx: 9, groupId: aikGroupId, amount: 1200000, method: 'card', daysAgo: 10 },
    { studentIdx: 10, groupId: aikGroupId, amount: 1200000, method: 'transfer', daysAgo: 8 },
    { studentIdx: 12, groupId: aikGroupId, amount: 1500000, method: 'transfer', daysAgo: 5 },
  ];

  for (const p of payments) {
    const sid = studentIds[p.studentIdx];
    if (!sid) continue;

    const exist = await exec(
      `SELECT id FROM academy_payments WHERE student_id = $1 AND amount_uzs = $2 LIMIT 1`,
      [sid, p.amount],
    );

    if (!exist.rows[0]?.id) {
      await exec(
        `INSERT INTO academy_payments
          (student_id, group_id, amount_uzs, type, method, status, paid_at, confirmed_by, comment)
         VALUES ($1, $2, $3, 'full', $4, 'paid', now() - ($5 || ' days')::interval, $6, 'Оплата за обучение')`,
        [sid, p.groupId, p.amount, p.method, String(p.daysAgo), sheriId],
      );
    }
  }

  console.log(`[ok] seeded payments (${payments.length} paid transactions)`);
}

// 12. Boards & Tasks
async function seedBoardsAndTasks(userMap: Record<string, number>, leadIds: number[]) {
  const sheriId = userMap['sheri'];
  const azizId = userMap['aziz@01academy.uz'] || sheriId;
  const jasurId = userMap['jasur@01academy.uz'] || sheriId;
  const dilnozaId = userMap['dilnoza@01academy.uz'] || sheriId;
  const farrukhId = userMap['farrukh@01academy.uz'] || sheriId;

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
    {
      title: 'Обзвонить новые заявки с Instagram и сайта',
      description: 'Связаться со всеми лидами в статусе "Новая заявка", квалифицировать и пригласить на демо.',
      status: 'todo',
      priority: 'urgent',
      color: 'rose',
      assigneeId: azizId,
      creatorId: sheriId,
      leadId: leadIds[0],
    },
    {
      title: 'Подготовить презентацию и воркшоп к открытому уроку Vibe Coding',
      description: 'Разработать демонстрационный AI-проект: интерактивный Telegram-бот за 20 минут.',
      status: 'in_progress',
      priority: 'normal',
      color: 'blue',
      assigneeId: jasurId,
      creatorId: sheriId,
      leadId: null,
    },
    {
      title: 'Запустить рекламную кампанию Meta Ads к осеннему набору',
      description: 'Протестировать 3 новых креатива для курса AI Creator и Vibe Coding с акцентом на портфолио.',
      status: 'todo',
      priority: 'normal',
      color: 'violet',
      assigneeId: dilnozaId,
      creatorId: sheriId,
      leadId: null,
    },
    {
      title: 'Сверить оплаты и подготовить финансовый отчет за август',
      description: 'Сверить выписки с расчетного счета и кассы, заполнить отчет о доходах и расходах.',
      status: 'done',
      priority: 'normal',
      color: 'emerald',
      assigneeId: farrukhId,
      creatorId: sheriId,
      leadId: null,
    },
    {
      title: 'Провести контрольный опрос родителей группы AI Kids',
      description: 'Узнать обратную связь по первым четырем урокам и прогрессу детей.',
      status: 'in_progress',
      priority: 'normal',
      color: 'amber',
      assigneeId: userMap['elena@01academy.uz'] || sheriId,
      creatorId: sheriId,
      leadId: null,
    },
  ];

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const exist = await exec(
      `SELECT id FROM board_tasks WHERE board_id = $1 AND title = $2 LIMIT 1`,
      [boardId, t.title],
    );
    if (!exist.rows[0]?.id) {
      await exec(
        `INSERT INTO board_tasks
          (board_id, title, description, status, priority, color, position, creator_id, assignee_id, lead_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [boardId, t.title, t.description, t.status, t.priority, t.color, i, t.creatorId, t.assigneeId, t.leadId],
      );
    }
  }

  console.log(`[ok] board & ${tasks.length} kanban tasks ensured`);
}

// 13. Telephony Calls
async function seedTelephonyCalls(userMap: Record<string, number>, leadIds: number[]) {
  const azizId = userMap['aziz@01academy.uz'] || userMap['sheri'];

  const calls = [
    {
      phone: '+998971001122',
      direction: 'inbound',
      status: 'answered',
      contactName: 'Мурод Ибрагимов',
      duration: 215,
      talkDuration: 195,
      note: 'Консультация по курсу Vibe Coding, ответил на вопросы по расписанию',
      leadId: leadIds[0],
    },
    {
      phone: '+998973003344',
      direction: 'outbound',
      status: 'answered',
      contactName: 'Одил Собиров',
      duration: 140,
      talkDuration: 125,
      note: 'Первый контакт, согласовали обратный звонок на вечер',
      leadId: leadIds[2],
    },
    {
      phone: '+998977007788',
      direction: 'outbound',
      status: 'answered',
      contactName: 'Алишер Курбанов',
      duration: 320,
      talkDuration: 305,
      note: 'Презентовали скидку 15% при оплате до пятницы',
      leadId: leadIds[6],
    },
    {
      phone: '+998901112233',
      direction: 'inbound',
      status: 'answered',
      contactName: 'Рано Ахмедова (Мама)',
      duration: 180,
      talkDuration: 165,
      note: 'Родитель уточнял время следующего урока в субботу',
      leadId: null,
    },
  ];

  for (const c of calls) {
    const exist = await exec(
      `SELECT id FROM telephony_calls WHERE phone = $1 AND contact_name = $2 LIMIT 1`,
      [c.phone, c.contactName],
    );
    if (!exist.rows[0]?.id) {
      await exec(
        `INSERT INTO telephony_calls
          (direction, status, phone, contact_name, duration_seconds, talk_seconds, note, lead_id, user_id, started_at, answered_at, ended_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() - interval '2 hours', now() - interval '2 hours' + interval '10 seconds', now() - interval '2 hours' + interval '215 seconds')`,
        [c.direction, c.status, c.phone, c.contactName, c.duration, c.talkDuration, c.note, c.leadId, azizId],
      );
    }
  }

  console.log(`[ok] telephony call records ensured`);
}

// 14. Company Settings & Operating Expenses
async function seedSettingsAndExpenses(userMap: Record<string, number>, sourceMap: Record<string, number>) {
  const sheriId = userMap['sheri'];
  const farrukhId = userMap['farrukh@01academy.uz'] || sheriId;

  // Company settings
  const existSettings = await exec(`SELECT id FROM academy_company_settings LIMIT 1`);
  if (!existSettings.rows[0]?.id) {
    await exec(
      `INSERT INTO academy_company_settings
        (target_revenue_monthly_uzs, target_new_leads_monthly, max_cac_uzs, target_roas, target_attendance_percent, target_nps, updated_by)
       VALUES (150000000, 80, 300000, 5, 85, 65, $1)`,
      [sheriId],
    );
  }

  // Marketing expenses
  const igSourceId = sourceMap['instagram'];
  const metaSourceId = sourceMap['meta_lead_ads'];

  const marketing = [
    { sourceId: metaSourceId, channel: 'instagram', campaign: 'Meta Ads - Август Vibe Coding', amount: 4500000 },
    { sourceId: igSourceId, channel: 'instagram', campaign: 'Блогеры & Инфлюенсеры', amount: 3000000 },
  ];

  for (const m of marketing) {
    const exist = await exec(
      `SELECT id FROM academy_marketing_expenses WHERE campaign_name = $1 LIMIT 1`,
      [m.campaign],
    );
    if (!exist.rows[0]?.id) {
      await exec(
        `INSERT INTO academy_marketing_expenses
          (source_id, channel, campaign_name, period_start, period_end, amount_uzs, status, created_by, approved_by, approved_at)
         VALUES ($1, $2, $3, now() - interval '30 days', now(), $4, 'approved', $5, $5, now() - interval '20 days')`,
        [m.sourceId, m.channel, m.campaign, m.amount, sheriId],
      );
    }
  }

  // Operating expenses
  const operating = [
    { category: 'rent', title: 'Аренда помещений Cyberpark (Август)', amount: 15000000, vendor: 'Cyberpark Management' },
    { category: 'utilities', title: 'Высокоскоростной интернет & Серверы', amount: 1800000, vendor: 'Uztelecom' },
    { category: 'software', title: 'Подписки на AI инструменты (OpenAI, Claude, Midjourney)', amount: 2500000, vendor: 'AI Services' },
    { category: 'supplies', title: 'Канцелярия и брендированные блокноты для учеников', amount: 950000, vendor: 'Office Print' },
  ];

  for (const o of operating) {
    const exist = await exec(
      `SELECT id FROM academy_operating_expenses WHERE title = $1 LIMIT 1`,
      [o.title],
    );
    if (!exist.rows[0]?.id) {
      await exec(
        `INSERT INTO academy_operating_expenses
          (category, title, amount_uzs, vendor, expense_date, status, method, created_by)
         VALUES ($1, $2, $3, $4, now() - interval '15 days', 'paid', 'transfer', $5)`,
        [o.category, o.title, o.amount, o.vendor, farrukhId],
      );
    }
  }

  console.log(`[ok] company settings and financial expenses seeded`);
}

async function main() {
  try {
    console.log('--- Initializing & Seeding Academy CRM Database ---');

    const userMap = await seedUsers();
    const { schoolId, roomMap } = await seedSchoolsAndRooms();
    const courseMap = await seedCourses();
    const sourceMap = await seedStatusesAndSources();
    const teacherMap = await seedTeachers(userMap, courseMap, schoolId);
    const groupMap = await seedGroups(schoolId, roomMap, courseMap, teacherMap);
    const studentIds = await seedStudents(schoolId, courseMap, groupMap, userMap);
    const leadIds = await seedLeads(schoolId, courseMap, sourceMap, userMap);
    await seedDemoLessons(schoolId, roomMap, courseMap, teacherMap, studentIds, userMap);
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
         (SELECT count(*) FROM board_tasks) AS tasks;`,
    );
    console.log('--- Database successfully populated with realistic demo data ---');
    console.log('Summary counts:', r.rows[0]);
    console.log('Login credentials:');
    console.log('  Login: Sheri');
    console.log('  Password: Sheri2001');
    console.log('---------------------------------------------------------------');
  } catch (e) {
    console.error('[error during seed]', e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
