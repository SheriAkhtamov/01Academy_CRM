// @vitest-environment jsdom
import { useRef, useState } from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PlatformLayout } from '../client/src/components/ux/PlatformLayout';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogTitle, AlertDialogTrigger,
} from '../client/src/components/ui/alert-dialog';

let desktop = false;
function Probe() {
  const mainRef = useRef<HTMLElement | null>(null);
  const [route, setRoute] = useState('home');
  const [confirm, setConfirm] = useState(false);
  return (
    <AlertDialog open={confirm} onOpenChange={setConfirm}>
    <PlatformLayout
      mainRef={mainRef}
      navigationKey={route}
      renderHeader={({ onMenuToggle, menuButtonRef }) => <button ref={menuButtonRef} onClick={onMenuToggle}>Menu</button>}
      renderSidebar={({ onClose }) => <nav><AlertDialogTrigger asChild><button>Courses</button></AlertDialogTrigger><button onClick={onClose}>Close menu</button></nav>}
      overlays={(
          <AlertDialogContent>
            <AlertDialogTitle>Discard draft?</AlertDialogTitle>
            <AlertDialogDescription>The unsaved draft will be discarded.</AlertDialogDescription>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => setRoute('courses')}>Leave</AlertDialogAction>
          </AlertDialogContent>
      )}
    >
      <p data-testid="route">{route}</p>
      <label>Draft<input defaultValue="Unsent answer" /></label>
    </PlatformLayout>
    </AlertDialog>
  );
}
beforeEach(() => {
  desktop = false;
  vi.stubGlobal('matchMedia', () => ({ get matches() { return desktop; }, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const drawer = (state: 'open' | 'closed') => document.querySelector(`[data-platform-drawer="${state}"]`);
const main = () => screen.getByRole('main', { hidden: true });

it('cancels the top confirmation with Escape and leaves the dirty mobile drawer open until a second Escape', async () => {
  render(<Probe />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Menu' }));
  const courses = screen.getByRole('button', { name: 'Courses' });
  await user.click(courses);
  await screen.findByRole('alertdialog');
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(drawer('open')).toBeTruthy();
  expect(main().parentElement?.inert).toBe(true);
  expect(screen.getByTestId('route').textContent).toBe('home');
  expect((screen.getByLabelText('Draft') as HTMLInputElement).value).toBe('Unsent answer');
  await waitFor(() => expect(document.activeElement).toBe(courses));
  await user.keyboard('{Escape}');
  expect(drawer('closed')).toBeTruthy();
  expect(main().parentElement?.inert).toBe(false);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Menu' }));
});

it('keeps focus on the destination after a confirmation restores its old mobile navigation link', async () => {
  render(<Probe />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Menu' }));
  const courses = screen.getByRole('button', { name: 'Courses' });
  await user.click(courses);
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Leave' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(screen.getByTestId('route').textContent).toBe('courses');
  expect(drawer('closed')).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(main()));
  act(() => courses.focus());
  expect(document.activeElement).toBe(main());
  desktop = true;
  act(() => courses.focus());
  expect(document.activeElement).toBe(courses);
});
