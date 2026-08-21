// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MOTION_PREFERENCES,
  MOTION_STORAGE_KEY,
  applyMotionAttributes,
  normalizeMotionPreferences,
  readMotionPreferences,
  writeMotionPreferences,
} from '../client/src/lib/motionPreferences';
import {
  MotionProvider,
  StaggerGroup,
  StaggerItem,
  useChartEntrance,
  useMotionFeature,
} from '../client/src/components/ux/motion';

const root = () => document.documentElement;

beforeEach(() => {
  window.localStorage.clear();
  for (const attribute of ['motion', 'motionEntrances', 'motionDecor']) {
    delete root().dataset[attribute];
  }
});

afterEach(() => {
  window.localStorage.clear();
});

describe('motion preferences storage', () => {
  it('starts with every animation on', () => {
    expect(readMotionPreferences()).toEqual(DEFAULT_MOTION_PREFERENCES);
  });

  it('survives a round trip through localStorage', () => {
    writeMotionPreferences({ ...DEFAULT_MOTION_PREFERENCES, decorative: false });
    expect(readMotionPreferences().decorative).toBe(false);
    expect(readMotionPreferences().charts).toBe(true);
  });

  it('falls back to full motion on unreadable storage', () => {
    window.localStorage.setItem(MOTION_STORAGE_KEY, 'not json');
    expect(readMotionPreferences()).toEqual(DEFAULT_MOTION_PREFERENCES);
  });

  it('fills in switches a stored payload does not mention', () => {
    expect(normalizeMotionPreferences({ enabled: false, charts: 'yes' })).toEqual({
      ...DEFAULT_MOTION_PREFERENCES,
      enabled: false,
    });
  });
});

describe('motion attributes on the document root', () => {
  it('marks everything off when the master switch is off', () => {
    applyMotionAttributes({ ...DEFAULT_MOTION_PREFERENCES, enabled: false });

    expect(root().dataset.motion).toBe('off');
    expect(root().dataset.motionEntrances).toBe('off');
    expect(root().dataset.motionDecor).toBe('off');
  });

  it('narrows to a single feature when only that one is off', () => {
    applyMotionAttributes({ ...DEFAULT_MOTION_PREFERENCES, decorative: false });

    expect(root().dataset.motion).toBe('on');
    expect(root().dataset.motionEntrances).toBe('on');
    expect(root().dataset.motionDecor).toBe('off');
  });
});

describe('components read the switches', () => {
  const ChartProbe = () => <span data-testid="chart">{String(useChartEntrance())}</span>;
  const BoardProbe = () => <span data-testid="board">{String(useMotionFeature('boardReflow'))}</span>;

  const renderProbes = () => render(
    <MotionProvider>
      <ChartProbe />
      <BoardProbe />
      <StaggerGroup data-testid="group">
        <StaggerItem data-testid="item">tile</StaggerItem>
      </StaggerGroup>
    </MotionProvider>,
  );

  it('animates by default', () => {
    renderProbes();

    expect(screen.getByTestId('chart').textContent).toBe('true');
    expect(screen.getByTestId('board').textContent).toBe('true');
    // framer parks the item at its hidden variant before the entrance runs.
    expect(screen.getByTestId('item').getAttribute('style')).toContain('opacity');
  });

  it('drops the animation work when the master switch is off', () => {
    writeMotionPreferences({ ...DEFAULT_MOTION_PREFERENCES, enabled: false });
    renderProbes();

    expect(screen.getByTestId('chart').textContent).toBe('false');
    expect(screen.getByTestId('board').textContent).toBe('false');
    // A plain div, not a motion component parked at opacity 0.
    expect(screen.getByTestId('item').getAttribute('style')).toBeNull();
    expect(root().dataset.motion).toBe('off');
  });

  it('leaves the other switches alone when one feature is turned off', () => {
    writeMotionPreferences({ ...DEFAULT_MOTION_PREFERENCES, charts: false });
    renderProbes();

    expect(screen.getByTestId('chart').textContent).toBe('false');
    expect(screen.getByTestId('board').textContent).toBe('true');
    expect(screen.getByTestId('item').getAttribute('style')).toContain('opacity');
  });
});
