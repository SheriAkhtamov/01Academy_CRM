// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useLocation } from 'wouter';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '../client/src/components/ux/UnsavedChangesGuard';
import { allowNavigation, initializeNavigationGuard } from '../client/src/lib/navigationGuard';
import { i18n } from '../client/src/lib/i18n';

function Editor() {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(true);
  const [location, navigate] = useLocation();
  const guard = useUnsavedChangesGuard({ open, isDirty: !!value, onOpenChange: setOpen });
  return <><input aria-label="Draft" value={value} onChange={(e) => setValue(e.target.value)} /><p>{location}</p>
    <button onClick={() => navigate('/tasks?task=42')}>Navigate</button>
    <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges} />
  </>;
}
beforeEach(() => { initializeNavigationGuard(); allowNavigation(() => history.replaceState(null, '', '/sales/pipeline')); i18n.setLanguage('en'); });
afterEach(cleanup);

it('keeps both the URL and the draft until navigation is confirmed', () => {
  render(<Editor />);
  fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Keep my work' } });
  fireEvent.click(screen.getByText('Navigate'));
  expect(location.pathname).toBe('/sales/pipeline');
  fireEvent.click(screen.getByRole('button', { name: i18n.t('keepEditing') }));
  expect((screen.getByLabelText('Draft') as HTMLInputElement).value).toBe('Keep my work');
  expect(location.pathname).toBe('/sales/pipeline');
  fireEvent.click(screen.getByText('Navigate'));
  fireEvent.click(screen.getByRole('button', { name: i18n.t('discardChanges') }));
  expect(location.pathname + location.search).toBe('/tasks?task=42');
});
it('does not block clean forms and removes the guard when an editor unmounts', () => {
  const view = render(<Editor />);
  fireEvent.click(screen.getByText('Navigate'));
  expect(location.pathname).toBe('/tasks');
  fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Draft' } });
  view.unmount();
  history.pushState(null, '', '/sales');
  expect(location.pathname).toBe('/sales');
});
