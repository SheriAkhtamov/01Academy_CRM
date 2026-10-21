// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskCard } from '../client/src/components/ux/board/TaskCard';
import { TaskCardPeople } from '../client/src/components/ux/board/TaskCardPeople';
import { TooltipProvider } from '../client/src/components/ui/tooltip';
import { i18n } from '../client/src/lib/i18n';
import type { TaskSummary, UserMini } from '../client/src/lib/boardTypes';
import { EmployeeCardContext } from '../client/src/features/employees/employee-card-context';

const author: UserMini = { id: 7, fullName: 'Anna Karimova', position: null, module: 'sales' };
const assignee: UserMini = { id: 8, fullName: 'Sheri Akhtamov', position: null, module: 'administration' };
const photoUrl = '/api/users/photos/aaaaaaaaaaaaaaaaaaaaa';
const task = (overrides: Partial<TaskSummary> = {}): TaskSummary => ({
  id: 1, boardId: 1, title: 'Prepare contract', description: null, status: 'todo', priority: 'normal',
  color: null, position: 0, leadId: null, lead: null, dueAt: null, acceptedAt: null,
  createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z',
  creator: author, assignee, commentCount: 0, attachmentCount: 0, checklistTotal: 0, checklistDone: 0,
  ...overrides,
});

class ControlledImage extends EventTarget {
  src = '';
  complete = false;
  naturalWidth = 0;
  constructor() { super(); images.push(this); }
}
let images: ControlledImage[];
beforeEach(() => {
  i18n.setLanguage('en');
  images = [];
  vi.stubGlobal('Image', ControlledImage);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const renderCard = (overrides: Partial<TaskSummary> = {}, onClick = vi.fn(), onPointerDown = vi.fn()) => {
  render(<EmployeeCardContext.Provider value={vi.fn()}><TooltipProvider><TaskCard task={task(overrides)} onClick={onClick} dragProps={{ 'aria-roledescription': 'draggable', onPointerDown }} /></TooltipProvider></EmployeeCardContext.Provider>);
  return { card: screen.getByText('Prepare contract').closest('button')!, onClick, onPointerDown };
};

describe('task card author and assignee', () => {
  it('shows two visible role/name/avatar rows and opens the card from either name', async () => {
    const { card, onClick, onPointerDown } = renderCard();
    const creatorRow = within(card).getByTitle('Creator: Anna Karimova');
    const assigneeRow = within(card).getByTitle('Assignee: Sheri Akhtamov');
    expect(within(creatorRow).getByText('Creator:')).toBeTruthy();
    expect(within(creatorRow).getByText('Anna Karimova')).toBeTruthy();
    expect(within(creatorRow).getByText('AK')).toBeTruthy();
    expect(within(assigneeRow).getByText('Assignee:')).toBeTruthy();
    expect(within(assigneeRow).getByText('Sheri Akhtamov')).toBeTruthy();
    expect(within(assigneeRow).getByText('SA')).toBeTruthy();
    expect(creatorRow.compareDocumentPosition(assigneeRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.querySelectorAll('button, a, [role="button"]')).toHaveLength(0);
    expect(card.getAttribute('aria-roledescription')).toBe('draggable');
    const user = userEvent.setup();
    await user.click(within(creatorRow).getByText('Anna Karimova'));
    await user.click(within(assigneeRow).getByText('Sheri Akhtamov'));
    expect(onClick).toHaveBeenCalledTimes(2);
    fireEvent.pointerDown(within(creatorRow).getByText('Anna Karimova'));
    expect(onPointerDown).toHaveBeenCalled();
  });

  it('keeps both roles when the task author is also its assignee', () => {
    const { card } = renderCard({ assignee: author });
    expect(within(card).getAllByText('Anna Karimova')).toHaveLength(2);
    expect(within(card).getAllByText('AK')).toHaveLength(2);
    expect(within(card).getByTitle('Creator: Anna Karimova')).toBeTruthy();
    expect(within(card).getByTitle('Assignee: Anna Karimova')).toBeTruthy();
  });

  it('distinguishes a missing author from an unassigned task with neutral avatars', () => {
    const { card } = renderCard({ creator: null, assignee: null });
    const creatorRow = within(card).getByTitle('Creator: Unknown author');
    const assigneeRow = within(card).getByTitle('Assignee: Unassigned');
    expect(within(creatorRow).getByText('Unknown author')).toBeTruthy();
    expect(within(assigneeRow).getByText('Unassigned')).toBeTruthy();
    expect(creatorRow.querySelector('[aria-hidden="true"] svg')).toBeTruthy();
    expect(assigneeRow.querySelector('[aria-hidden="true"] svg')).toBeTruthy();
    expect(card.querySelector('img')).toBeNull();
  });

  it('handles blank profile names without claiming an existing assignee is unassigned', () => {
    const { card } = renderCard({ creator: { ...author, fullName: '  ' }, assignee: { ...assignee, fullName: '' } });
    expect(within(card).getByTitle('Creator: Unknown author')).toBeTruthy();
    const row = within(card).getByTitle('Assignee: Unknown');
    expect(row.querySelector('[aria-hidden="true"] svg')).toBeTruthy();
    expect(within(card).queryByText('Unassigned')).toBeNull();
  });

  it('loads the stored employee photo and keeps initials when an image fails', () => {
    const { card } = renderCard({ creator: { ...author, avatarUrl: photoUrl }, assignee: { ...assignee, avatarUrl: '/api/users/photos/bbbbbbbbbbbbbbbbbbbbb' } });
    const creatorRow = within(card).getByTitle('Creator: Anna Karimova');
    const assigneeRow = within(card).getByTitle('Assignee: Sheri Akhtamov');
    expect(within(creatorRow).getByText('AK')).toBeTruthy();
    act(() => {
      const image = images.find((image) => image.src === photoUrl)!;
      image.complete = true;
      image.naturalWidth = 80;
      image.dispatchEvent(new Event('load'));
    });
    const photo = creatorRow.querySelector('img')!;
    expect(photo.getAttribute('src')).toBe(photoUrl);
    expect(photo.alt).toBe('');
    expect(photo.draggable).toBe(false);
    expect(within(creatorRow).queryByText('AK')).toBeNull();
    act(() => images.find((image) => image.src.includes('bbbb'))!.dispatchEvent(new Event('error')));
    expect(assigneeRow.querySelector('img')).toBeNull();
    expect(within(assigneeRow).getByText('SA')).toBeTruthy();
  });

  it('retains readable Russian roles and full long names while constraining the name column', () => {
    i18n.setLanguage('ru');
    const fullName = 'Шери Акхтамов с очень длинным полным именем';
    render(<TaskCardPeople creator={null} assignee={{ ...assignee, fullName }} />);
    expect(screen.getByText('Автор:')).toBeTruthy();
    expect(screen.getByText('Автор неизвестен')).toBeTruthy();
    const row = screen.getByTitle(`Исполнитель: ${fullName}`);
    expect(row.className).toContain('minmax(0,1fr)');
    expect(within(row).getByText(fullName).classList.contains('truncate')).toBe(true);
    expect(within(row).getByText(fullName).classList.contains('min-w-0')).toBe(true);
  });

  it('preserves task counts, unread and acceptance markers above the people rows', () => {
    const { card } = renderCard({
      status: 'done', awaitingAcceptance: true, color: 'violet', lead: { id: 40, contactName: 'Potential student' },
      checklistTotal: 5, checklistDone: 2, commentCount: 3, unreadCommentCount: 1, attachmentCount: 4,
    });
    expect(within(card).getByText('2/5')).toBeTruthy();
    expect(within(card).getByText('3')).toBeTruthy();
    expect(within(card).getByText('4')).toBeTruthy();
    expect(within(card).getByText('Potential student')).toBeTruthy();
    expect(within(card).getByRole('img', { name: 'Unread comment' })).toBeTruthy();
    expect(within(card).getByRole('img', { name: 'Completed task awaiting acceptance' })).toBeTruthy();
    expect(within(card).getByText('2/5').compareDocumentPosition(within(card).getByText('Anna Karimova')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.className).toContain('border-violet-300');
  });
});
