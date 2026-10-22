// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUnsavedChangesGuard } from '../client/src/components/ux/UnsavedChangesGuard';

afterEach(cleanup);

describe('unsaved confirmation action lifecycle', () => {
  it('keeps a pending save protected even when the confirmation was already open', () => {
    const action = vi.fn();
    const onOpenChange = vi.fn();
    const onDiscard = vi.fn();
    const view = renderHook(({ pending }) => useUnsavedChangesGuard({ open: true, isDirty: true, isPending: pending, onOpenChange, onDiscard }), {
      initialProps: { pending: false },
    });
    act(() => view.result.current.requestAction(action));
    const discard = view.result.current.discardChanges;
    view.rerender({ pending: true });
    act(discard);
    act(() => view.result.current.setConfirmationOpen(false));
    expect(action).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
    expect(view.result.current.confirmationOpen).toBe(true);
    view.rerender({ pending: false });
    act(discard);
    act(discard);
    expect(action).toHaveBeenCalledOnce();
    expect(onDiscard).toHaveBeenCalledOnce();
    expect(view.result.current.confirmationOpen).toBe(false);
  });

  it('forgets the cancelled action and confirms only the next requested destination', () => {
    const oldAction = vi.fn();
    const nextAction = vi.fn();
    const onDiscard = vi.fn();
    const view = renderHook(() => useUnsavedChangesGuard({ open: true, isDirty: true, onOpenChange: vi.fn(), onDiscard }));
    act(() => view.result.current.requestAction(oldAction));
    act(() => view.result.current.setConfirmationOpen(false));
    act(view.result.current.discardChanges);
    expect(oldAction).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
    act(() => view.result.current.requestAction(nextAction));
    act(view.result.current.discardChanges);
    expect(nextAction).toHaveBeenCalledOnce();
    expect(onDiscard).toHaveBeenCalledOnce();
    expect(oldAction).not.toHaveBeenCalled();
  });

  it('never runs a stale discard action after external close or a later reopen', () => {
    const oldAction = vi.fn();
    const onOpenChange = vi.fn();
    const onDiscard = vi.fn();
    const view = renderHook(({ open }) => useUnsavedChangesGuard({ open, isDirty: true, onOpenChange, onDiscard }), { initialProps: { open: true } });
    act(() => view.result.current.requestAction(oldAction));
    const discard = view.result.current.discardChanges;
    view.rerender({ open: false });
    act(discard);
    view.rerender({ open: true });
    act(discard);
    expect(oldAction).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(view.result.current.confirmationOpen).toBe(false);
  });

  it('does not capture navigation or open a discard confirmation during a save', () => {
    const action = vi.fn();
    const onOpenChange = vi.fn();
    const view = renderHook(() => useUnsavedChangesGuard({ open: true, isDirty: true, isPending: true, onOpenChange }));
    act(() => view.result.current.requestAction(action));
    act(() => view.result.current.handleOpenChange(false));
    act(view.result.current.discardChanges);
    expect(action).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(view.result.current.confirmationOpen).toBe(false);
  });
});
