// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ref } from 'react';
import Layout from '../client/src/components/Layout';
import { i18n } from '../client/src/lib/i18n';
import { MotionProvider } from '../client/src/components/ux/motion';
import { DEFAULT_MOTION_PREFERENCES, writeMotionPreferences } from '../client/src/lib/motionPreferences';

vi.mock('../client/src/hooks/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false, user: { id: 1, module: 'sales', fullName: 'Sales employee' } }),
}));
vi.mock('../client/src/hooks/useWebSocket', () => ({
  useWebSocket: () => ({ status: 'connected', reconnect: vi.fn() }),
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQuery: () => ({ data: { count: 0 } }),
}));
vi.mock('../client/src/components/Header', () => ({
  default: ({ onMenuToggle, menuButtonRef }: { onMenuToggle: () => void; menuButtonRef: Ref<HTMLButtonElement> }) => (
    <button ref={menuButtonRef} onClick={onMenuToggle}>{i18n.t('openNavigation')}</button>
  ),
}));

let desktop: MediaQueryList;
let changeDesktop: (matches: boolean) => void;
const backdrop = () => document.querySelector('.fixed.inset-0.backdrop-blur-sm');
const page = () => screen.getByRole('main').parentElement as HTMLDivElement;
const mount = () => render(<MotionProvider><Layout><p>Inbox content</p></Layout></MotionProvider>);
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: i18n.t('openNavigation') }));

beforeEach(() => {
  i18n.setLanguage('en');
  localStorage.clear();
  history.replaceState(null, '', '/sales/messages');
  Element.prototype.scrollTo = vi.fn();
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  desktop = {
    matches: false,
    media: '(min-width: 1024px)',
    onchange: null,
    addListener: (listener: (event: MediaQueryListEvent) => void) => { listeners.add(listener); },
    removeListener: (listener: (event: MediaQueryListEvent) => void) => { listeners.delete(listener); },
    addEventListener: (_name: string, listener: (event: MediaQueryListEvent) => void) => { listeners.add(listener); },
    removeEventListener: (_name: string, listener: (event: MediaQueryListEvent) => void) => { listeners.delete(listener); },
    dispatchEvent: vi.fn(() => true),
  } as MediaQueryList;
  changeDesktop = (matches) => {
    Object.assign(desktop, { matches });
    listeners.forEach((listener) => listener({ matches } as MediaQueryListEvent));
  };
  vi.stubGlobal('matchMedia', (query: string) => query === desktop.media ? desktop : {
    matches: false, addListener: vi.fn(), removeListener: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each([false, true])('mobile navigation backdrop (motion enabled: %s)', (enabled) => {
  beforeEach(() => writeMotionPreferences({ ...DEFAULT_MOTION_PREFERENCES, enabled }));

  it('enters the inbox without a backdrop or an inert page', () => {
    mount();
    expect(backdrop()).toBeNull();
    expect(page().inert).not.toBe(true);
  });

  it('removes the backdrop immediately when the drawer closes', () => {
    mount();
    openMenu();
    expect(backdrop()).not.toBeNull();
    expect(page().inert).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('close') }));
    expect(backdrop()).toBeNull();
    expect(page().inert).toBe(false);
  });

  it('closes when the page backdrop is clicked', () => {
    mount();
    openMenu();
    fireEvent.click(backdrop()!);
    expect(backdrop()).toBeNull();
    expect(page().inert).toBe(false);
  });

  it('closes on activation of the current inbox link itself', () => {
    mount();
    openMenu();
    // Keyboard activation targets the anchor, rather than its inner div.
    fireEvent.click(screen.getByRole('link', { name: i18n.t('salesInbox') }));
    expect(location.pathname).toBe('/sales/messages');
    expect(backdrop()).toBeNull();
    expect(page().inert).toBe(false);
  });

  it('closes on route changes even when navigation starts outside the sidebar', () => {
    history.replaceState(null, '', '/sales/calls');
    mount();
    openMenu();
    act(() => history.pushState(null, '', '/sales/messages'));
    expect(backdrop()).toBeNull();
    expect(page().inert).toBe(false);
  });

  it('clears the backdrop and focus lock on Escape and desktop resizing', () => {
    mount();
    openMenu();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(backdrop()).toBeNull();
    expect(page().inert).toBe(false);
    openMenu();
    act(() => changeDesktop(true));
    expect(backdrop()).toBeNull();
    expect(page().inert).toBe(false);
    act(() => changeDesktop(false));
    expect(backdrop()).toBeNull();
  });
});
