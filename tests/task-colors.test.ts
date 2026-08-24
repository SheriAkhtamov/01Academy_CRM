import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../migrations/0095_add_board_task_colors.sql', import.meta.url),
  'utf8',
).replace(/\s+/g, ' ').trim();
const schema = readFileSync(new URL('../server/db/schema/index.ts', import.meta.url), 'utf8');
const storage = readFileSync(new URL('../server/storage/board.storage.ts', import.meta.url), 'utf8');
const taskCard = readFileSync(
  new URL('../client/src/components/ux/board/TaskCard.tsx', import.meta.url),
  'utf8',
);
const taskDetail = readFileSync(
  new URL('../client/src/components/ux/board/TaskDetailSheet.tsx', import.meta.url),
  'utf8',
);
const createTask = readFileSync(
  new URL('../client/src/components/ux/board/CreateTaskDialog.tsx', import.meta.url),
  'utf8',
);
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };

describe('task colours', () => {
  it('adds a nullable, constrained palette code to board tasks', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "color" varchar(20)');
    expect(migration).toContain('ADD CONSTRAINT "board_tasks_color_check"');
    expect(migration).toContain("'blue', 'emerald', 'amber', 'violet', 'rose', 'cyan'");
    expect(schema).toContain('color: varchar("color", { length: 20 })');
    expect(journal.entries.filter((entry) => entry.idx === 95)).toEqual([
      expect.objectContaining({ tag: '0095_add_board_task_colors' }),
    ]);
  });

  it('returns colours in summaries and detail, then renders them everywhere tasks appear', () => {
    expect(storage.match(/color: boardTasks\.color/g)).toHaveLength(2);
    expect(taskCard).toContain('taskColor?.card');
    expect(createTask).toContain('<TaskColorPicker value={color}');
    expect(taskDetail).toContain('<TaskColorPicker value={draftColor}');
    expect(taskDetail).toContain("case 'color_changed':");
  });
});
