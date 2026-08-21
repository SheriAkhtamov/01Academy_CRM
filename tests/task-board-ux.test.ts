import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const taskBoard = readFileSync(
  new URL('../client/src/components/ux/board/TaskBoard.tsx', import.meta.url),
  'utf8',
);
const tasksPage = readFileSync(
  new URL('../client/src/pages/tasks.tsx', import.meta.url),
  'utf8',
);
const salesKanban = readFileSync(
  new URL('../client/src/components/ux/KanbanBoard.tsx', import.meta.url),
  'utf8',
);
const dragOverlayPortal = readFileSync(
  new URL('../client/src/components/ux/DragOverlayPortal.tsx', import.meta.url),
  'utf8',
);

describe('task board interaction UX', () => {
  it('keeps the board height bounded so every column can scroll vertically', () => {
    // Bounded, but not clipped: the columns need a definite height to scroll
    // inside, and anything that outgrows it has to reach the shell scroller.
    expect(tasksPage).toContain('h-full min-h-0 flex-col p-6');
    expect(tasksPage).toContain('min-h-0 w-full max-w-[1600px]');
    expect(taskBoard).toContain('data-task-column-scroll');
    expect(taskBoard).toContain('overflow-y-auto overscroll-y-contain');
    expect(taskBoard).toContain('[scrollbar-gutter:stable]');
  });

  it('drags from the whole card without a separate handle and keeps one stable preview', () => {
    expect(taskBoard).toContain('dragProps={{ ...attributes, ...listeners }}');
    expect(taskBoard).not.toContain('setActivatorNodeRef');
    expect(taskBoard).not.toContain('GripVertical');
    expect(taskBoard).not.toContain('hasDragHandle');
    expect(taskBoard).not.toContain('CSS.Translate');
    expect(taskBoard).not.toContain('rotate-2');
    expect(taskBoard).toContain('adjustScale={false}');
  });

  it('renders both board previews outside paint-containment coordinates', () => {
    expect(taskBoard).toContain('<DragOverlayPortal');
    expect(salesKanban).toContain('<DragOverlayPortal');
    expect(dragOverlayPortal).toContain('createPortal(');
    expect(dragOverlayPortal).toContain('document.body');
    expect(salesKanban).not.toContain('CSS.Translate');
    expect(salesKanban).toContain('w-[296px]');
  });

  it('switches the section between the board and the calendar without leaving the route', () => {
    expect(tasksPage).toContain("useCalendarPreference<TaskViewMode>('taskSectionView', TASK_VIEWS, 'board')");
    expect(tasksPage).toContain("aria-label={t('taskViewMode')}");
    expect(tasksPage).toContain('aria-pressed={mode === taskView}');
    expect(tasksPage).toContain('<TaskCalendar');
    expect(tasksPage).toContain('<TaskBoard');
    // Both views drive the same query, so the page hands the network to the
    // board feature rather than reaching for the transport itself.
    expect(tasksPage).not.toContain('apiRequest(');
    expect(tasksPage).toContain('boardApi.updateTaskDueAt');
  });

  it('targets the column under the pointer and disables forbidden destinations', () => {
    expect(taskBoard).toContain('pointerWithin(args)');
    expect(taskBoard).toContain('rectIntersection(args)');
    expect(taskBoard).toContain('disabled: !canDrop');
  });
});
