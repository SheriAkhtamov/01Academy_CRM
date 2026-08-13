// @vitest-environment jsdom
import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { KanbanBoard, type KanbanLead } from '../client/src/components/ux/KanbanBoard';
import { TooltipProvider } from '../client/src/components/ui/tooltip';
import { BulkLeadActionsDialog } from '../client/src/features/sales/ui/BulkLeadActionsDialog';
import { i18n } from '../client/src/lib/i18n';

const statuses = [
  { code: 'new_request', name: 'New request', color: '#2563eb', sortOrder: 1 },
  { code: 'qualified', name: 'Qualified', color: '#14b8a6', sortOrder: 2 },
];
const leads: KanbanLead[] = [
  { id: 1, contactName: 'First lead', statusCode: 'new_request' },
  { id: 2, contactName: 'Second lead', statusCode: 'new_request' },
  { id: 3, contactName: 'Other stage lead', statusCode: 'qualified' },
];

function SelectionHarness() {
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<number>>(() => new Set());
  return (
    <KanbanBoard
      statuses={statuses}
      leads={leads}
      onStatusChange={vi.fn()}
      selectedLeadIds={selectedLeadIds}
      onSelectedLeadIdsChange={setSelectedLeadIds}
    />
  );
}

const renderWithProviders = (node: ReactNode) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <TooltipProvider>{node}</TooltipProvider>
  </QueryClientProvider>,
);

describe('bulk actions on the sales pipeline', () => {
  it('selects a whole stage and reveals checked lead-card checkboxes', async () => {
    i18n.setLanguage('en');
    const user = userEvent.setup();
    renderWithProviders(<SelectionHarness />);

    expect(screen.queryByLabelText('Select lead First lead')).toBeNull();
    const stageCheckbox = screen.getByLabelText('Select all leads in New request');
    await user.click(stageCheckbox);

    expect(screen.getByLabelText('Select lead First lead').getAttribute('data-state')).toBe('checked');
    expect(screen.getByLabelText('Select lead Second lead').getAttribute('data-state')).toBe('checked');
    expect(screen.queryByLabelText('Select lead Other stage lead')).toBeNull();
    expect(stageCheckbox.getAttribute('data-state')).toBe('checked');
  });

  it('requires two destructive confirmations before bulk deletion', async () => {
    i18n.setLanguage('en');
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <BulkLeadActionsDialog
        open
        onOpenChange={vi.fn()}
        selectedCount={2}
        statuses={statuses}
        managers={[{ id: 7, fullName: 'Sales manager' }]}
        canManageAllLeads
        isPending={false}
        onMove={vi.fn()}
        onAssign={vi.fn()}
        onDelete={onDelete}
        onClearSelection={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('tab', { name: 'Delete leads' }));
    await user.click(screen.getByRole('button', { name: 'Delete leads' }));
    expect(screen.getByRole('heading', { name: 'Delete selected leads?' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Continue to final confirmation' }));
    expect(screen.getByRole('heading', { name: 'Final deletion confirmation' })).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete permanently' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
