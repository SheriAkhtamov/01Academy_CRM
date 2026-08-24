// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataTable, type DataTableColumn } from '../client/src/components/ux/DataTable';
import { Tabs, TabsList, TabsTrigger } from '../client/src/components/ui/tabs';
import { i18n } from '../client/src/lib/i18n';

/**
 * jsdom ships no `matchMedia`, which is exactly why `useMediaQuery` treats its
 * absence as "roomy viewport" — every other DOM test in this suite is written
 * against the desktop table and must keep getting it. This installs a stub that
 * answers a single width so the phone branch can be exercised deliberately.
 */
// jsdom implements none of the pointer-capture surface Radix's Select leans on.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
});

const setViewportWidth = (width: number) => {
  vi.stubGlobal('matchMedia', (query: string) => {
    const maxWidth = Number(/max-width:\s*(\d+)px/.exec(query)?.[1] ?? Number.POSITIVE_INFINITY);
    return {
      matches: width <= maxWidth,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  });
};

interface Lead {
  id: number;
  name: string;
  manager: string;
  amount: number;
}

const rows: Lead[] = [
  { id: 1, name: 'Zara Usmanova', manager: 'Bek', amount: 300 },
  { id: 2, name: 'Alisher Karimov', manager: 'Dilnoza', amount: 100 },
];

const columns: DataTableColumn<Lead>[] = [
  { key: 'name', header: 'Lead', sortable: true, accessor: (row) => row.name },
  { key: 'manager', header: 'Manager', sortable: true, accessor: (row) => row.manager },
  {
    key: 'amount',
    header: 'Amount',
    sortable: true,
    accessor: (row) => row.amount,
    cellClassName: 'w-16 tabular-nums',
  },
  { key: 'actions', header: '', render: () => <button type="button">Restore</button> },
  { key: 'internal', header: 'Internal id', mobileHidden: true, accessor: (row) => `#${row.id}` },
];

const renderTable = (extra: Partial<React.ComponentProps<typeof DataTable<Lead>>> = {}) => render(
  <DataTable
    columns={columns}
    data={rows}
    keyExtractor={(row) => String(row.id)}
    {...extra}
  />,
);

describe('data table on a phone', () => {
  beforeEach(() => i18n.setLanguage('en'));
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the grid on a roomy viewport', () => {
    setViewportWidth(1280);
    renderTable();

    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('replaces the grid with one card per row below md', () => {
    setViewportWidth(375);
    renderTable();

    expect(screen.queryByRole('table')).toBeNull();
    const cards = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(cards).toHaveLength(2);

    // The first visible column becomes the headline; the rest stay labelled so
    // a value is never stranded without the column it came from.
    expect(cards[0].textContent).toContain('Zara Usmanova');
    expect(within(cards[0]).getByText('Manager')).toBeTruthy();
    expect(within(cards[0]).getByText('Bek')).toBeTruthy();
  });

  it('drops the columns a card has no room for and keeps the rest reachable', () => {
    setViewportWidth(375);
    renderTable();

    const card = within(screen.getByRole('list')).getAllByRole('listitem')[0];
    // `mobileHidden` is gone entirely…
    expect(card.textContent).not.toContain('#1');
    expect(screen.queryByText('Internal id')).toBeNull();
    // …while a header-less action column keeps its control and prints no
    // empty label beside it.
    expect(within(card).getByRole('button', { name: 'Restore' })).toBeTruthy();
  });

  it('keeps a cell class that describes type and drops one that describes a column', () => {
    setViewportWidth(375);
    renderTable();

    const card = within(screen.getByRole('list')).getAllByRole('listitem')[0];
    const amount = within(card).getByText('300');
    // `w-16` was sized for a table column, not for one value inside a card.
    expect(amount.className).toContain('tabular-nums');
    expect(amount.className).not.toContain('w-16');
  });

  it('offers sorting through a control instead of column headers there are none of', async () => {
    const user = userEvent.setup();
    setViewportWidth(375);
    renderTable();

    // Sorting lives in the header row on a desktop grid. Without one, the phone
    // needs its own way in or the list is stuck in insertion order.
    const reverse = screen.getByRole('button', { name: 'Reverse sort order' });
    expect(reverse).toBeTruthy();

    const namesInOrder = () => within(screen.getByRole('list'))
      .getAllByRole('listitem')
      .map((card) => card.textContent?.split('Manager')[0] ?? '');

    expect(namesInOrder()[0]).toContain('Zara');

    // Two comboboxes are on screen — this one and the page-size picker.
    await user.click(screen.getByRole('combobox', { name: 'Sort' }));
    await user.click(await screen.findByRole('option', { name: 'Lead' }));

    expect(namesInOrder()[0]).toContain('Alisher');

    await user.click(screen.getByRole('button', { name: 'Reverse sort order' }));
    expect(namesInOrder()[0]).toContain('Zara');
  });

  it('carries the row click through to the whole card', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    setViewportWidth(375);
    renderTable({ onRowClick });

    const card = screen.getByRole('button', { name: /Alisher Karimov/ });
    await user.click(card);

    expect(onRowClick).toHaveBeenCalledWith(rows[1]);

    // The clickable card is reachable and operable from the keyboard too.
    onRowClick.mockClear();
    card.focus();
    await user.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });

  it('shows the empty state as itself rather than inside a table cell', () => {
    setViewportWidth(375);
    render(
      <DataTable
        columns={columns}
        data={[]}
        keyExtractor={(row: Lead) => String(row.id)}
        emptyState={<p>Nothing archived yet</p>}
      />,
    );

    expect(screen.getByText('Nothing archived yet')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('scrolling tab strips', () => {
  it('never centres a strip that can scroll', () => {
    /*
      A flex or grid container with `justify-content: center` splits its
      overflow across both ends, and a scroll container can only reach the end
      one — the leading tabs go permanently out of reach. Content-sized strips
      look the same aligned to the start, so `start` is the only safe pairing
      with `overflow-x-auto`.
    */
    render(
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
        </TabsList>
      </Tabs>,
    );

    const list = screen.getByRole('tablist');
    expect(list.className).toContain('overflow-x-auto');
    expect(list.className).toContain('justify-start');
    expect(list.className).not.toContain('justify-center');
  });

  it('keeps the trigger focus ring inside the box that clips it', () => {
    // `ring-offset-2` paints the ring 4px outside the trigger, where the
    // scroll container above crops it away.
    render(
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
        </TabsList>
      </Tabs>,
    );

    const trigger = screen.getByRole('tab');
    expect(trigger.className).toContain('focus-visible:ring-inset');
    expect(trigger.className).not.toContain('focus-visible:ring-offset-2');
  });
});
