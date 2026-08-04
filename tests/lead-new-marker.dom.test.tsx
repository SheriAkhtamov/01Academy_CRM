// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../client/src/components/ui/tooltip';
import { KanbanBoard, type KanbanLead } from '../client/src/components/ux/KanbanBoard';
import { i18n } from '../client/src/lib/i18n';

const statuses = [{ code: 'new_request', name: 'New request', color: '#ef4444', sortOrder: 1 }];

const leadCard = (id: number, contactName: string, firstViewedAt: string | null): KanbanLead => ({
  id,
  contactName,
  statusCode: 'new_request',
  firstViewedAt,
});

const renderBoard = (leads: KanbanLead[]) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <TooltipProvider>
      <KanbanBoard statuses={statuses} leads={leads} onStatusChange={vi.fn()} />
    </TooltipProvider>
  </QueryClientProvider>,
);

describe('new lead marker on the sales pipeline', () => {
  it('dots only the cards nobody has opened yet', () => {
    i18n.setLanguage('en');
    const { container } = renderBoard([
      leadCard(1, 'Fresh Instagram lead', null),
      leadCard(2, 'Already opened lead', '2026-08-04T10:00:00.000Z'),
    ]);

    const cards = container.querySelectorAll('[aria-label*="lead"]');
    const newCard = screen.getByLabelText(/Fresh Instagram lead/);
    const seenCard = screen.getByLabelText(/Already opened lead/);

    expect(cards.length).toBeGreaterThanOrEqual(2);
    expect(newCard.querySelector('.bg-destructive')).toBeTruthy();
    expect(seenCard.querySelector('.bg-destructive')).toBeNull();
  });

  it('names the marker for assistive tech instead of relying on colour alone', () => {
    i18n.setLanguage('en');
    renderBoard([leadCard(1, 'Fresh Instagram lead', null)]);

    expect(screen.getByLabelText(/New lead, not opened yet\. Fresh Instagram lead/)).toBeTruthy();
  });

  it('counts the unopened leads in the column header', () => {
    i18n.setLanguage('en');
    renderBoard([
      leadCard(1, 'First new lead', null),
      leadCard(2, 'Second new lead', null),
      leadCard(3, 'Already opened lead', '2026-08-04T10:00:00.000Z'),
    ]);

    expect(screen.getByLabelText('2 new leads').textContent).toBe('2');
    // The column still reports its full size next to the new-lead badge.
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('hides the column badge once every lead has been opened', () => {
    i18n.setLanguage('en');
    renderBoard([leadCard(1, 'Already opened lead', '2026-08-04T10:00:00.000Z')]);

    expect(screen.queryByLabelText(/new leads/)).toBeNull();
  });
});
