// @vitest-environment jsdom
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadTagsEditor } from '../client/src/components/ux/lead/LeadTagsEditor';
import { TagInputTag } from '../client/src/components/ui/tag-input';
import { i18n } from '../client/src/lib/i18n';
import type { LeadTagView } from '../shared/lead-tags';

const mocks = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn(), invalidate: vi.fn(), toast: vi.fn(), dropdown: vi.fn() }));
vi.mock('../client/src/features/leads/api', () => ({ leadsApi: { addTag: mocks.add, removeTag: mocks.remove } }));
vi.mock('../client/src/features/leads/queries', () => ({ invalidateLeadData: mocks.invalidate }));
vi.mock('../client/src/hooks/use-toast', () => ({ toast: mocks.toast }));

let client: QueryClient;
let savedTags: LeadTagView[];
const design = { id: 11, tagId: 1, name: 'design' };
const options = [{ id: 1, name: 'design' }, { id: 2, name: 'motion' }];

beforeEach(() => {
  vi.resetAllMocks();
  i18n.setLanguage('en');
  savedTags = [design];
  client = new QueryClient({ defaultOptions: { queries: {
    retry: false, staleTime: Infinity, gcTime: 0, queryFn: async () => options,
  } } });
  client.setQueryData(['/api/academy/lead-tags'], options);
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.add.mockImplementation(async (_leadId: number, payload: { tagId?: number; name?: string }) => {
    savedTags = [...savedTags, { id: 22, tagId: payload.tagId ?? 3, name: payload.name ?? options.find((option) => option.id === payload.tagId)!.name }];
    return { created: true };
  });
  mocks.remove.mockImplementation(async (_leadId: number, id: number) => {
    savedTags = savedTags.filter((tag) => tag.id !== id);
  });
});
afterEach(() => { cleanup(); client.clear(); });

function Editor({ leadId = 7, tags: suppliedTags }: { leadId?: number; tags?: LeadTagView[] }) {
  const [tags, setTags] = useState(savedTags);
  return <LeadTagsEditor leadId={leadId} automaticTag="Instagram" tags={suppliedTags ?? tags}
    onChanged={() => setTags([...savedTags])} onDropdownOpenChange={mocks.dropdown} />;
}
const element = (props = {}) => <MotionConfig reducedMotion="always" transition={{ duration: 0 }}>
  <QueryClientProvider client={client}><Editor {...props} /></QueryClientProvider>
</MotionConfig>;
const input = () => screen.getByRole('combobox', { name: i18n.t('leadTags') }) as HTMLInputElement;
const removeButton = (name: string) => screen.getByRole('button', { name: `${i18n.t('removeLeadTag')} ${name}` });
const confirm = () => within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('delete') });

describe('animated lead tag input', () => {
  it('adds a reusable tag with keyboard and keeps the input mounted', async () => {
    const user = userEvent.setup();
    render(element());
    const original = input();
    await user.click(original);
    await user.type(original, 'motion{Enter}');
    await screen.findByRole('button', { name: `${i18n.t('removeLeadTag')} motion` });
    expect(mocks.add).toHaveBeenCalledWith(7, { tagId: 2 });
    expect(input()).toBe(original);
    expect(input().value).toBe('');
    expect(removeButton('design')).toBeTruthy();
    expect(mocks.invalidate).toHaveBeenCalledWith(client, 7);
  });

  it('creates a new tag only after saving succeeds', async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    mocks.add.mockImplementation(() => new Promise((resolve) => {
      finish = () => {
        savedTags = [...savedTags, { id: 30, tagId: 3, name: 'frontend' }];
        resolve({ created: true });
      };
    }));
    render(element());
    await user.type(input(), 'frontend{Enter}');
    expect(input().disabled).toBe(true);
    expect(screen.queryByRole('button', { name: `${i18n.t('removeLeadTag')} frontend` })).toBeNull();
    await act(async () => finish());
    await screen.findByRole('button', { name: `${i18n.t('removeLeadTag')} frontend` });
    expect(input().disabled).toBe(false);
  });

  it('keeps the draft on an add error and allows a retry', async () => {
    const user = userEvent.setup();
    mocks.add.mockRejectedValueOnce(new Error('Connection lost'));
    render(element());
    await user.type(input(), 'motion{Enter}');
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: i18n.t('leadTagAddFailed') })));
    expect(input().value).toBe('motion');
    expect(screen.queryByRole('button', { name: `${i18n.t('removeLeadTag')} motion` })).toBeNull();
    await user.keyboard('{Enter}');
    await screen.findByRole('button', { name: `${i18n.t('removeLeadTag')} motion` });
    expect(mocks.add).toHaveBeenCalledTimes(2);
  });

  it('preserves the tag after cancelling removal, then removes it after confirmation succeeds', async () => {
    const user = userEvent.setup();
    render(element());
    await user.click(removeButton('design'));
    expect(screen.getByRole('alertdialog').textContent).toContain('design');
    expect(mocks.remove).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('cancel') }));
    expect(removeButton('design')).toBeTruthy();
    await user.click(removeButton('design'));
    await user.click(confirm());
    await waitFor(() => expect(screen.queryByText('design')).toBeNull());
    expect(mocks.remove).toHaveBeenCalledWith(7, 11);
    expect(screen.getByText('Instagram')).toBeTruthy();
    expect(input()).toBeTruthy();
  });

  it('keeps a tag on removal failure and permits retrying the same confirmation', async () => {
    const user = userEvent.setup();
    mocks.remove.mockRejectedValueOnce(new Error('Connection lost'));
    render(element());
    await user.click(removeButton('design'));
    await user.click(confirm());
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: i18n.t('leadTagRemoveFailed') })));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    // The editor remains behind the active confirmation, and the tag has not exited.
    expect(screen.getByText('design').parentElement?.getAttribute('aria-hidden')).toBeNull();
    await user.click(confirm());
    await waitFor(() => expect(screen.queryByText('design')).toBeNull());
    expect(mocks.remove).toHaveBeenCalledTimes(2);
  });

  it('protects automatic tags and rejects duplicate names', async () => {
    const user = userEvent.setup();
    render(element());
    expect(screen.queryByRole('button', { name: `${i18n.t('removeLeadTag')} Instagram` })).toBeNull();
    expect(screen.getByText(i18n.t('automaticTag'))).toBeTruthy();
    await user.type(input(), 'DESIGN{Enter}');
    expect(mocks.add).not.toHaveBeenCalled();
    expect(screen.getByText(i18n.t('leadTagAlreadyAssigned'))).toBeTruthy();
  });

  it('switches lead identity without leaving old tags in the new editor', () => {
    const view = render(element());
    const original = input();
    view.rerender(element({ leadId: 8, tags: [{ id: 81, tagId: 2, name: 'motion' }] }));
    expect(screen.queryByText('design')).toBeNull();
    expect(removeButton('motion')).toBeTruthy();
    expect(input()).toBe(original);
    expect(input().id).toBe('lead-8-tag-input');
  });
});

it('makes a tag inert during its exit and prevents another removal click', async () => {
  const removed = vi.fn();
  function List() {
    const [visible, setVisible] = useState(true);
    return <MotionConfig reducedMotion="always"><div>
      <AnimatePresence initial={false}>{visible ? <TagInputTag key="design"><span>design</span>
        <button type="button" onClick={() => { removed(); setVisible(false); }}>Remove design</button>
      </TagInputTag> : null}</AnimatePresence>
      <input aria-label="Add tag" />
    </div></MotionConfig>;
  }
  render(<List />);
  const button = screen.getByRole('button', { name: 'Remove design' });
  fireEvent.click(button);
  expect(button.parentElement?.hasAttribute('inert')).toBe(true);
  expect(screen.queryByRole('button', { name: 'Remove design' })).toBeNull();
  fireEvent.click(button);
  expect(removed).toHaveBeenCalledOnce();
  expect(screen.getByRole('textbox', { name: 'Add tag' })).toBeTruthy();
  await waitFor(() => expect(screen.queryByText('design')).toBeNull());
});
