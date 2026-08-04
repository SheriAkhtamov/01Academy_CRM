// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadFiltersDialog } from '../client/src/components/ux/LeadFiltersDialog';
import { i18n } from '../client/src/lib/i18n';
import { EMPTY_LEAD_FILTERS, type FilterableLead } from '../client/src/lib/leadFilters';

// Inside a form Radix renders a hidden input for the switch, and that input
// measures itself. jsdom has no layout engine, so the observer has to be stubbed.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

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

  it('keeps the filter list scrollable instead of clipping the lower filters', () => {
    const { container } = openDialog();

    // jsdom has no layout, so the guard is the class itself: a flex child
    // without min-h-0 refuses to shrink and the scroll area never scrolls.
    const scrollArea = container.ownerDocument.querySelector('[data-radix-scroll-area-viewport]')?.parentElement;
    expect(scrollArea?.className).toContain('min-h-0');
    expect(scrollArea?.className).toContain('flex-1');
  });

  it('shows how many leads the draft would leave before applying it', () => {
    const { onApply } = openDialog();

    expect(screen.getByRole('status').textContent).toBe('Matching leads: 3');

    fireEvent.click(screen.getByRole('switch', { name: /Only new leads/i }));

    // The count reacts immediately, but the board is untouched until Apply.
    expect(screen.getByRole('status').textContent).toBe('Matching leads: 1');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('toggles a source chip on and off', () => {
    openDialog();

    const chip = screen.getByRole('button', { name: 'Meta Lead Ads' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Matching leads: 2');

    fireEvent.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('status').textContent).toBe('Matching leads: 3');
  });

  it('reports the chosen conditions only when Apply is pressed', () => {
    const { onApply } = openDialog();

    fireEvent.click(screen.getByRole('switch', { name: /Only new leads/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0]).toMatchObject({ ...EMPTY_LEAD_FILTERS, onlyNew: true });
  });

  it('applies on Enter so the keyboard path does not end at a mouse click', () => {
    const { onApply, container } = openDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Instagram' }));
    fireEvent.submit(container.ownerDocument.querySelector('form')!);

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0]).toMatchObject({ sourceIds: [1] });
  });

  it('groups the deal amount as it is typed', () => {
    openDialog();

    const amountFrom = screen.getByLabelText('Deal amount, UZS: From') as HTMLInputElement;
    fireEvent.change(amountFrom, { target: { value: '1500000' } });

    expect(amountFrom.value).toBe('1 500 000');
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

    expect(screen.getByRole('button', { name: 'VIP' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Instagram' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Meta Lead Ads' })).toBeTruthy();
  });
});
