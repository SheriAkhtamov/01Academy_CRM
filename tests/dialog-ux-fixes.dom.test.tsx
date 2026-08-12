// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog, DialogContent, DialogTitle } from '../client/src/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
} from '../client/src/components/ui/alert-dialog';
import { CreateTaskDialog } from '../client/src/components/ux/board/CreateTaskDialog';
import { submitOnEnter } from '../client/src/lib/submitOnEnter';

afterEach(() => {
  vi.restoreAllMocks();
});

const dialogElement = () => screen.getByRole('dialog');

describe('dialog viewport clipping', () => {
  it('caps DialogContent to the viewport and scrolls the overflow', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Test</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    const classes = dialogElement().className;
    expect(classes).toContain('max-h-[calc(100dvh-2rem)]');
    expect(classes).toContain('overflow-y-auto');
  });

  it('caps AlertDialogContent the same way so confirm buttons stay reachable', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Test</AlertDialogTitle>
        </AlertDialogContent>
      </AlertDialog>,
    );

    const classes = screen.getByRole('alertdialog').className;
    expect(classes).toContain('max-h-[calc(100dvh-2rem)]');
    expect(classes).toContain('overflow-y-auto');
  });

  it('lets a dialog that scrolls its own body opt out of both defaults', () => {
    render(
      <Dialog open>
        <DialogContent className="grid max-h-[85vh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
          <DialogTitle>Test</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    // tailwind-merge must drop the base classes rather than emit both, or the
    // inner scroll container would be clipped against a second scroll container.
    const classes = dialogElement().className;
    expect(classes).toContain('max-h-[85vh]');
    expect(classes).toContain('overflow-hidden');
    expect(classes).not.toContain('max-h-[calc(100dvh-2rem)]');
    expect(classes).not.toContain('overflow-y-auto');
  });
});

describe('submitOnEnter', () => {
  it('runs the action on Enter', () => {
    const submit = vi.fn();
    const preventDefault = vi.fn();
    submitOnEnter(submit)({
      key: 'Enter',
      shiftKey: false,
      nativeEvent: { isComposing: false },
      preventDefault,
    } as never);

    expect(submit).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('stays inert while the action is disabled, on Shift+Enter, and mid-IME', () => {
    const submit = vi.fn();
    const base = { key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false }, preventDefault: vi.fn() };

    submitOnEnter(submit, { disabled: true })(base as never);
    submitOnEnter(submit)({ ...base, shiftKey: true } as never);
    submitOnEnter(submit)({ ...base, nativeEvent: { isComposing: true } } as never);
    submitOnEnter(submit)({ ...base, key: 'a' } as never);

    expect(submit).not.toHaveBeenCalled();
  });
});

describe('CreateTaskDialog', () => {
  const renderDialog = () => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CreateTaskDialog
        open
        onOpenChange={vi.fn()}
        users={[]}
        currentUser={{ id: 1, fullName: 'Tester', position: null, module: 'sales' }}
        canAssignUsers={false}
      />
    </QueryClientProvider>,
  );

  it('submits on plain Enter in the title field', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    renderDialog();

    const title = dialogElement().querySelector('#create-task-title') as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'Call the lead back' } });
    expect(title.value).toBe('Call the lead back');

    // The title lives in a <form>, so Enter reaches the submit handler natively —
    // before the fix it needed Cmd/Ctrl+Enter and plain Enter did nothing.
    expect(title.closest('form')).toBeTruthy();
    fireEvent.submit(title.closest('form') as HTMLFormElement);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/board/tasks');
  });

  it('associates every visible label with its control', () => {
    renderDialog();
    const content = dialogElement();

    for (const label of Array.from(content.querySelectorAll('label'))) {
      const target = label.getAttribute('for');
      expect(target).toBeTruthy();
      expect(content.querySelector(`#${target}`)).toBeTruthy();
    }
  });
});
