// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConfirmDialog from '../client/src/components/ConfirmDialog';
import { LeadMergeConflictDialog } from '../client/src/components/ux/LeadMergeConflictDialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogBody, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../client/src/components/ui/alert-dialog';
import { i18n } from '../client/src/lib/i18n';

beforeEach(() => i18n.setLanguage('en'));
afterEach(cleanup);

const labels = { title: 'Delete the file', description: 'The attached file will be removed.', confirmLabel: 'Delete file' };
const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

describe('shared action confirmation', () => {
  it('keeps long targets inside the scroll body, with a fixed patterned header and footer', () => {
    const target = 'Very long filename '.repeat(150).trim();
    render(<ConfirmDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} target={target} {...labels} />);
    const dialog = screen.getByRole('alertdialog');
    const body = screen.getByText(target).closest('.compact-modal-body');
    expect(dialog.className).toContain('overflow-hidden');
    expect(body?.className).toContain('overflow-y-auto');
    expect(body?.contains(screen.getByRole('button', { name: 'Delete file' }))).toBe(false);
    expect(dialog.querySelector('[data-topographic="header"]')).toBeTruthy();
    expect(dialog.querySelector('.compact-modal-footer')).toBeTruthy();
    expect(document.getElementById(dialog.getAttribute('aria-describedby') ?? '')?.textContent).toContain(labels.description);
  });

  it('focuses Cancel first and returns focus to the opener after cancelling', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return <>
        <button onClick={() => setOpen(true)}>Open confirmation</button>
        <ConfirmDialog open={open} onOpenChange={setOpen} onConfirm={vi.fn()} variant="destructive" {...labels} />
      </>;
    }
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open confirmation' });
    await user.click(opener);
    const cancel = screen.getByRole('button', { name: i18n.t('cancel') });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    await user.click(cancel);
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('rejects a second synchronous activation and preserves the existing keep-open behavior', () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(<ConfirmDialog open keepOpenOnConfirm onOpenChange={onOpenChange} onConfirm={onConfirm} {...labels} />);
    const confirm = screen.getByRole('button', { name: 'Delete file' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('keeps the default synchronous close behavior', () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    render(<ConfirmDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} {...labels} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('blocks cancellation, Escape and repeated confirmation while pending, then allows retry', () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    const view = render(<ConfirmDialog open isPending onOpenChange={onOpenChange} onConfirm={onConfirm} {...labels} />);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: i18n.t('confirmProcessing') }));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('cancel') }));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    view.rerender(<ConfirmDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} {...labels} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('awaits a returned Promise before closing and never submits it twice', async () => {
    const action = deferred();
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn(() => action.promise);
    render(<ConfirmDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} {...labels} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('confirmProcessing') }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => action.resolve());
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('retains the failed confirmation and target, allowing a successful retry', async () => {
    const first = deferred();
    const second = deferred();
    const onConfirm = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const onOpenChange = vi.fn();
    render(<ConfirmDialog open target="contract.pdf" onOpenChange={onOpenChange} onConfirm={onConfirm} {...labels} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    await act(async () => first.reject(new Error('private transport failure')));
    expect(screen.getByRole('alert').textContent).toBe(i18n.t('errorOccurred'));
    expect(screen.getByText('contract.pdf')).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    await act(async () => second.resolve());
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('does not let a late Promise close or unlock a reopened confirmation', async () => {
    const oldAction = deferred();
    const newAction = deferred();
    const onConfirm = vi.fn().mockReturnValueOnce(oldAction.promise).mockReturnValueOnce(newAction.promise);
    const onOpenChange = vi.fn();
    const view = render(<ConfirmDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} {...labels} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    view.rerender(<ConfirmDialog open={false} onOpenChange={onOpenChange} onConfirm={onConfirm} {...labels} />);
    view.rerender(<ConfirmDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} {...labels} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    await act(async () => oldAction.resolve());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: i18n.t('confirmProcessing') }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => newAction.resolve());
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('keeps async keep-open confirmations open after success', async () => {
    const onOpenChange = vi.fn();
    render(<ConfirmDialog open keepOpenOnConfirm onOpenChange={onOpenChange} onConfirm={async () => undefined} {...labels} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: i18n.t('confirmProcessing') })).toBeNull());
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)('ignores an old Promise %s when the visible target changes without closing', async (outcome) => {
    const oldAction = deferred();
    const newAction = deferred();
    const onConfirm = vi.fn().mockReturnValueOnce(oldAction.promise).mockReturnValueOnce(newAction.promise);
    const onOpenChange = vi.fn();
    const view = render(<ConfirmDialog open target="first.pdf" onOpenChange={onOpenChange} onConfirm={onConfirm} {...labels} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    view.rerender(<ConfirmDialog open target="second.pdf" description="The second file will be removed." title={labels.title} confirmLabel={labels.confirmLabel} onOpenChange={onOpenChange} onConfirm={onConfirm} />);
    await act(async () => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    await act(async () => {
      if (outcome === 'resolve') oldAction.resolve();
      else oldAction.reject(new Error('stale result'));
    });
    expect(screen.getByText('second.pdf')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: i18n.t('confirmProcessing') }) as HTMLButtonElement).disabled).toBe(true);
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => newAction.resolve());
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });
});

describe('direct AlertDialog consumers', () => {
  const content = (onClick: (event: React.MouseEvent<HTMLButtonElement>) => void) => <AlertDialogContent>
    <AlertDialogHeader><AlertDialogTitle>Remove attachment</AlertDialogTitle></AlertDialogHeader>
    <AlertDialogBody><AlertDialogDescription>contract.pdf</AlertDialogDescription></AlertDialogBody>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={onClick}>Remove</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>;

  it('guards direct actions before mutation state renders', () => {
    const onClick = vi.fn((event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault());
    render(<AlertDialog open>{content(onClick)}</AlertDialog>);
    const action = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' });
    fireEvent.click(action);
    fireEvent.click(action);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('blocks Escape and action buttons through the shared pending state', () => {
    const onOpenChange = vi.fn();
    const onClick = vi.fn();
    render(<AlertDialog open pending onOpenChange={onOpenChange}>{content(onClick)}</AlertDialog>);
    const dialog = screen.getByRole('alertdialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('shares the merge lock between alternative retained leads and permits retry on the next turn', async () => {
    const onKeepCurrent = vi.fn();
    const onMergeIntoExisting = vi.fn();
    render(<LeadMergeConflictDialog open mode="persisted" currentLead={{ contactName: 'Current lead' }}
      existingLead={{ contactName: 'Existing lead' }} isPending={false} onCancel={vi.fn()}
      onOpenExisting={vi.fn()} onKeepCurrent={onKeepCurrent} onMergeIntoExisting={onMergeIntoExisting} />);
    const keepCurrent = screen.getByRole('button', { name: i18n.t('keepLeadNamed').replace('{name}', 'Current lead') });
    const keepExisting = screen.getByRole('button', { name: i18n.t('keepLeadNamed').replace('{name}', 'Existing lead') });
    fireEvent.click(keepCurrent);
    fireEvent.click(keepCurrent);
    fireEvent.click(keepExisting);
    expect(onKeepCurrent).toHaveBeenCalledOnce();
    expect(onMergeIntoExisting).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    await act(async () => undefined);
    fireEvent.click(keepExisting);
    expect(onMergeIntoExisting).toHaveBeenCalledOnce();
  });
});
