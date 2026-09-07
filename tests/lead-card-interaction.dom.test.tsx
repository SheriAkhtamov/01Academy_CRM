// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../client/src/components/ui/tooltip';
import { KanbanBoard, type KanbanLead } from '../client/src/components/ux/KanbanBoard';
import { i18n } from '../client/src/lib/i18n';

const statuses = [
  { code: 'new_request', name: 'New request', color: '#2563eb', sortOrder: 1 },
  { code: 'qualified', name: 'Qualified', color: '#14b8a6', sortOrder: 2 },
];
const lead: KanbanLead = {
  id: 1,
  contactName: 'Pipeline lead',
  courseName: 'English course',
  phone: '+998901234567',
  statusCode: 'new_request',
};

function renderBoard() {
  const onLeadClick = vi.fn();
  const onQuickAction = vi.fn();
  const onStatusChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider>
        <KanbanBoard
          statuses={statuses}
          leads={[lead]}
          onLeadClick={onLeadClick}
          onQuickAction={onQuickAction}
          onStatusChange={onStatusChange}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  const card = screen.getByRole('button', { name: /Pipeline lead.*Open lead/ });
  return { card, onLeadClick, onQuickAction, onStatusChange };
}

beforeEach(() => {
  i18n.setLanguage('en');
});

describe('lead card interactions', () => {
  it('opens the lead from the card body as well as its name', async () => {
    const user = userEvent.setup();
    const { card, onLeadClick } = renderBoard();

    await user.click(card);
    await user.click(within(card).getByText('English course'));
    await user.click(within(card).getByText('Pipeline lead'));

    expect(onLeadClick).toHaveBeenCalledTimes(3);
    expect(onLeadClick).toHaveBeenLastCalledWith(lead);
  });

  it('starts dragging from the card body and cancels without opening the lead', async () => {
    const { card, onLeadClick, onStatusChange } = renderBoard();
    const body = within(card).getByText('English course');

    fireEvent.mouseDown(body, { button: 0, clientX: 20, clientY: 20 });
    fireEvent.mouseMove(document, { clientX: 40, clientY: 20 });

    expect(card.getAttribute('aria-pressed')).toBe('true');
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
      // dnd-kit removes its document click suppression 50 ms after a drag.
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(card.getAttribute('aria-pressed')).not.toBe('true');
    expect(onLeadClick).not.toHaveBeenCalled();
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('opens the focused card with Enter', async () => {
    const user = userEvent.setup();
    const { card, onLeadClick } = renderBoard();

    card.focus();
    await user.keyboard('{Enter}');

    expect(onLeadClick).toHaveBeenCalledExactlyOnceWith(lead);
  });

  it('runs payment with Enter without also opening or dragging the card', async () => {
    const user = userEvent.setup();
    const { card, onLeadClick, onQuickAction } = renderBoard();

    within(card).getByRole('button', { name: 'Payment' }).focus();
    await user.keyboard('{Enter}');

    expect(onQuickAction).toHaveBeenCalledExactlyOnceWith('payment', lead);
    expect(onLeadClick).not.toHaveBeenCalled();
    expect(card.getAttribute('aria-pressed')).not.toBe('true');
  });

  it('does not drag the card when the pointer moves from a nested action', () => {
    const { card, onLeadClick, onStatusChange } = renderBoard();
    const payment = within(card).getByRole('button', { name: 'Payment' });

    fireEvent.mouseDown(payment, { button: 0, clientX: 20, clientY: 20 });
    fireEvent.mouseMove(document, { clientX: 40, clientY: 20 });
    fireEvent.mouseUp(document);

    expect(card.getAttribute('aria-pressed')).not.toBe('true');
    expect(onLeadClick).not.toHaveBeenCalled();
    expect(onStatusChange).not.toHaveBeenCalled();
  });
});
