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
const taskDetail = readFileSync(
  new URL('../client/src/components/ux/board/TaskDetailSheet.tsx', import.meta.url),
  'utf8',
);
const boardTypes = readFileSync(
  new URL('../client/src/lib/boardTypes.ts', import.meta.url),
  'utf8',
);
const boardStorage = readFileSync(
  new URL('../server/storage/board.storage.ts', import.meta.url),
  'utf8',
);
const taskCalendar = readFileSync(
  new URL('../client/src/components/ux/board/TaskCalendar.tsx', import.meta.url),
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

  it('moves accepted tasks out of the board and into a separate archive view', () => {
    expect(boardTypes).not.toContain("{ status: 'accepted', labelKey: 'colAccepted' }");
    expect(tasksPage).toContain('data-testid="task-list-archive"');
    expect(tasksPage).toContain('boardApi.listTasks<BoardTasksResponse>(isArchiveView)');
    expect(tasksPage).toContain('<TaskCard key={task.id} task={task}');
    expect(taskDetail).toContain("statusMutation.mutate('accepted')");
    expect(taskDetail).toContain("t('taskAcceptedAndArchived')");
    expect(boardStorage).toContain("eq(boardTasks.status, 'accepted')");
    expect(boardStorage).toContain("ne(boardTasks.status, 'accepted')");
  });

  /* `useDraggable` registers a node under its id whether or not dragging is
     enabled, so a second copy of the chip inside the drag preview replaced the
     registry entry of the task being dragged — and, reading the same
     `isDragging`, drew the preview itself at 25% opacity. */
  it('keeps drag state out of the chip the calendar preview renders', () => {
    const chipStart = taskCalendar.indexOf('function TaskChip(');
    const chipEnd = taskCalendar.indexOf('function DraggableTaskChip(');
    expect(chipStart).toBeGreaterThan(-1);
    expect(chipEnd).toBeGreaterThan(chipStart);
    expect(taskCalendar.slice(chipStart, chipEnd)).not.toContain('useDraggable');
    expect(taskCalendar).toContain('dragProps={{ ...attributes, ...listeners, ref: setNodeRef }}');
  });

  it('lets a task be dropped onto a period that has nothing in it yet', () => {
    // The "nothing here" wash covers every day cell; if it took clicks, the one
    // moment you most want to plan something would be the one that cannot.
    expect(taskCalendar).toContain('pointer-events-none absolute inset-0 z-10');
    expect(taskCalendar).toContain('pointer-events-auto min-h-11');
  });

  it('targets the column under the pointer and disables forbidden destinations', () => {
    expect(taskBoard).toContain('pointerWithin(args)');
    expect(taskBoard).toContain('rectIntersection(args)');
    expect(taskBoard).toContain('disabled: !canDrop');
  });
});
