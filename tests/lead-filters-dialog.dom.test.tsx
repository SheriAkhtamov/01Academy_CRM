// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadFiltersDialog } from '../client/src/components/ux/LeadFiltersDialog';
import { i18n } from '../client/src/lib/i18n';
import { EMPTY_LEAD_FILTERS, type FilterableLead } from '../client/src/lib/leadFilters';

const sources = [
  { id: 1, name: 'Instagram', channel: 'instagram' },
  { id: 2, name: 'Meta Lead Ads', channel: 'meta' },
];

const leads: FilterableLead[] = [
  { id: 1, sourceId: 1, language: 'ru', phone: 'instagram:1', firstViewedAt: null, tags: [{ id: 7, name: 'VIP' }] },
  { id: 2, sourceId: 2, language: 'uz', phone: '+998901234567', firstViewedAt: '2026-08-04T10:00:00.000Z' },
  { id: 3, sourceId: 2, language: 'ru', phone: '+998907654321', firstViewedAt: '2026-08-04T10:00:00.000Z' },
];

const openDialog = (onApply = vi.fn(), filters = EMPTY_LEAD_FILTERS) => {
  const view = render(
    <LeadFiltersDialog filters={filters} onApply={onApply} sources={sources} leads={leads} />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Lead filters/i }));
  return { ...view, onApply };
};

describe('pipeline filter dialog', () => {
  beforeEach(() => {
    i18n.setLanguage('en');
  });

  it('opens the filters as a modal dialog', () => {
    openDialog();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Channels and contacts')).toBeTruthy();
    expect(within(dialog).getByText('Lead traits')).toBeTruthy();
    expect(within(dialog).getByText('Numbers and dates')).toBeTruthy();
  });

  it('shows how many leads the draft would leave before applying it', () => {
    const { onApply } = openDialog();

    expect(screen.getByRole('status').textContent).toBe('Matching leads: 3');

    fireEvent.click(screen.getByRole('switch', { name: /Only new leads/i }));

    // The count reacts immediately, but the board is untouched until Apply.
    expect(screen.getByRole('status').textContent).toBe('Matching leads: 1');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('reports the chosen conditions only when Apply is pressed', () => {
    const { onApply } = openDialog();

    fireEvent.click(screen.getByRole('switch', { name: /Only new leads/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0]).toMatchObject({ ...EMPTY_LEAD_FILTERS, onlyNew: true });
  });

  it('resets the draft without touching what is applied', () => {
    const applied = { ...EMPTY_LEAD_FILTERS, onlyNew: true, sourceIds: [1] };
    const { onApply } = openDialog(vi.fn(), applied);

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.getByRole('status').textContent).toBe('Matching leads: 3');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('reopens on the applied filters rather than an abandoned draft', () => {
    const applied = { ...EMPTY_LEAD_FILTERS, onlyNew: true };
    openDialog(vi.fn(), applied);

    expect(screen.getByRole('status').textContent).toBe('Matching leads: 1');
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('status').textContent).toBe('Matching leads: 3');

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /Lead filters/i }));

    expect(screen.getByRole('status').textContent).toBe('Matching leads: 1');
  });

  it('offers only the tags leads actually carry', () => {
    openDialog();

    expect(screen.getByText('VIP')).toBeTruthy();
    expect(screen.getByText('Instagram')).toBeTruthy();
    expect(screen.getByText('Meta Lead Ads')).toBeTruthy();
  });
});
