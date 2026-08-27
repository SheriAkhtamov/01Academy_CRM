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
  { id: 1, sourceId: 1, managerId: 11, language: 'ru', phone: 'instagram:1', firstViewedAt: null, tags: [{ id: 7, tagId: 9, name: 'VIP' }] },
  { id: 2, sourceId: 2, managerId: 12, language: 'uz', phone: '+998901234567', firstViewedAt: '2026-08-04T10:00:00.000Z', tags: [{ id: 8, tagId: 9, name: 'VIP' }] },
  { id: 3, sourceId: 2, managerId: null, language: 'ru', phone: '+998907654321', firstViewedAt: '2026-08-04T10:00:00.000Z' },
];

// The manager list only grows a search box once it is longer than a glance,
// so the fixture carries a team rather than a pair.
const managers = [
  { id: 11, fullName: 'Alice Manager' },
  { id: 12, fullName: 'Bob Manager' },
  { id: 13, fullName: 'Carol Manager' },
  { id: 14, fullName: 'Dave Manager' },
  { id: 15, fullName: 'Erin Manager' },
  { id: 16, fullName: 'Frank Manager' },
];

const openDialog = (onApply = vi.fn(), filters = EMPTY_LEAD_FILTERS) => {
  const view = render(
    <LeadFiltersDialog
      filters={filters}
      onApply={onApply}
      sources={sources}
      managers={managers}
      leads={leads}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Lead filters/i }));
  return { ...view, onApply };
};

/** Opens one multi-select, closing whichever one the press landed outside of. */
const openList = (name: string | RegExp) => {
  const trigger = screen.getByRole('combobox', { name });
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
  return trigger;
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

    // jsdom has no layout, so the guard is the class itself.
    // DialogContent ships a `grid` class that beats any `flex` added here, so
    // the layout has to declare rows; minmax(0,1fr) is what lets the middle row
    // shrink instead of pushing its content past the clipped edge.
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('grid-rows-[auto_minmax(0,1fr)]');
    expect(dialog.className).not.toMatch(/(^|\s)flex(\s|$)/);
    const scrollArea = container.ownerDocument.querySelector('[data-radix-scroll-area-viewport]')?.parentElement;
    expect(scrollArea?.className).toContain('min-h-0');
  });

  it('shows how many leads the draft would leave before applying it', () => {
    const { onApply } = openDialog();

    expect(screen.getByRole('status').textContent).toBe('Found 3 of 3 leads');

    fireEvent.click(screen.getByRole('switch', { name: /Only new leads/i }));

    // The count reacts immediately, but the board is untouched until Apply.
    expect(screen.getByRole('status').textContent).toBe('Found 1 of 3 leads');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('toggles a source on and off from its list', () => {
    openDialog();
    const trigger = openList(/^Source/);

    const option = screen.getByRole('option', { name: 'Meta Lead Ads' });
    expect(option.getAttribute('aria-selected')).toBe('false');

    fireEvent.click(option);
    expect(option.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Found 2 of 3 leads');
    // The closed control has to say what it holds, not just how much.
    expect(trigger.textContent).toContain('Meta Lead Ads');

    fireEvent.click(option);
    expect(option.getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('status').textContent).toBe('Found 3 of 3 leads');
  });

  it('sums the selected values on the closed control', () => {
    openDialog();
    const trigger = openList(/^Source/);

    fireEvent.click(screen.getByRole('option', { name: 'Instagram' }));
    fireEvent.click(screen.getByRole('option', { name: 'Meta Lead Ads' }));

    expect(trigger.textContent).toContain('Instagram +1');
  });

  it('counts the leads behind every option', () => {
    openDialog();
    openList(/^Source/);

    // Two of the three leads arrived through Meta Lead Ads.
    expect(screen.getByRole('option', { name: 'Meta Lead Ads' }).textContent).toContain('2');
    expect(screen.getByRole('option', { name: 'Instagram' }).textContent).toContain('1');
  });

  it('filters by several responsible managers and unassigned leads', () => {
    const { onApply } = openDialog();
    openList(/^Responsible manager/);

    fireEvent.click(screen.getByRole('option', { name: 'Alice Manager' }));
    expect(screen.getByRole('status').textContent).toBe('Found 1 of 3 leads');

    fireEvent.click(screen.getByRole('option', { name: 'Not assigned' }));
    expect(screen.getByRole('status').textContent).toBe('Found 2 of 3 leads');

    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(onApply.mock.calls[0][0]).toMatchObject({
      managerIds: [11],
      includeUnassignedManager: true,
    });
  });

  it('searches manager options without losing selected managers', () => {
    openDialog();
    openList(/^Responsible manager/);

    fireEvent.click(screen.getByRole('option', { name: 'Alice Manager' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search employees...' }), {
      target: { value: 'bob' },
    });

    expect(screen.queryByRole('option', { name: 'Alice Manager' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Bob Manager' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Found 1 of 3 leads');
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

    openList(/^Source/);
    fireEvent.click(screen.getByRole('option', { name: 'Instagram' }));
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

    expect(screen.getByRole('status').textContent).toBe('Found 3 of 3 leads');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('reopens on the applied filters rather than an abandoned draft', () => {
    const applied = { ...EMPTY_LEAD_FILTERS, onlyNew: true };
    openDialog(vi.fn(), applied);

    expect(screen.getByRole('status').textContent).toBe('Found 1 of 3 leads');
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('status').textContent).toBe('Found 3 of 3 leads');

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /Lead filters/i }));

    expect(screen.getByRole('status').textContent).toBe('Found 1 of 3 leads');
  });

  it('offers each global tag once and filters every lead carrying it', () => {
    openDialog();
    openList(/^Tags/);

    const vipTags = screen.getAllByRole('option', { name: 'VIP' });
    expect(vipTags).toHaveLength(1);
    fireEvent.click(vipTags[0]);
    expect(screen.getByRole('status').textContent).toBe('Found 2 of 3 leads');

    // Choosing a tag must leave the other groups alone.
    openList(/^Source/);
    expect(screen.getByRole('option', { name: 'Instagram' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Meta Lead Ads' })).toBeTruthy();
  });

  it('spells out every condition instead of only counting them', () => {
    openDialog();

    openList(/^Source/);
    fireEvent.click(screen.getByRole('option', { name: 'Instagram' }));
    fireEvent.click(screen.getByRole('switch', { name: /Only new leads/i }));

    const conditions = screen.getByRole('group', { name: 'Active conditions' });
    expect(within(conditions).getByText('Source: Instagram')).toBeTruthy();
    expect(within(conditions).getByText('Only new leads nobody opened')).toBeTruthy();
  });

  it('lifts a single condition without touching the others', () => {
    openDialog();

    openList(/^Source/);
    fireEvent.click(screen.getByRole('option', { name: 'Meta Lead Ads' }));
    fireEvent.click(screen.getByRole('switch', { name: /Only new leads/i }));
    // Both Meta leads have been opened already, so together the two conditions
    // leave nothing.
    expect(screen.getByRole('status').textContent).toBe('Found 0 of 3 leads');

    fireEvent.click(screen.getByRole('button', { name: 'Remove condition: Source: Meta Lead Ads' }));

    expect(screen.getByRole('status').textContent).toBe('Found 1 of 3 leads');
    expect(screen.getByRole('switch', { name: /Only new leads/i }).getAttribute('aria-checked')).toBe('true');
  });

  it('fills the created range from a preset and clears it on a second press', () => {
    openDialog();

    const preset = screen.getByRole('button', { name: 'Today' });
    fireEvent.click(preset);
    expect((screen.getByLabelText('Created date: From') as HTMLInputElement).value).not.toBe('');
    expect(preset.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(preset);
    expect((screen.getByLabelText('Created date: From') as HTMLInputElement).value).toBe('');
  });
});
