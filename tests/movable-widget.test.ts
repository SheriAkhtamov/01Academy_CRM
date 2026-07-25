import { describe, expect, it } from 'vitest';
import {
  clampWidgetPosition,
  hasMovedPastDragThreshold,
  parseStoredWidgetPosition,
} from '../client/src/hooks/useMovableWidget';

describe('movable widget positioning', () => {
  it('keeps the widget inside every viewport edge', () => {
    const widget = { width: 380, height: 500 };
    const viewport = { width: 1280, height: 800 };

    expect(clampWidgetPosition({ x: -100, y: -40 }, widget, viewport, 12))
      .toEqual({ x: 12, y: 12 });
    expect(clampWidgetPosition({ x: 1200, y: 760 }, widget, viewport, 12))
      .toEqual({ x: 888, y: 288 });
  });

  it('pins an oversized widget to the safe viewport margin', () => {
    expect(clampWidgetPosition(
      { x: 200, y: 100 },
      { width: 500, height: 700 },
      { width: 320, height: 640 },
      12,
    )).toEqual({ x: 12, y: 12 });
  });

  it('only restores finite positions from the current storage version', () => {
    expect(parseStoredWidgetPosition('{"version":1,"x":120,"y":80}'))
      .toEqual({ x: 120, y: 80 });
    expect(parseStoredWidgetPosition('{"version":2,"x":120,"y":80}')).toBeNull();
    expect(parseStoredWidgetPosition('{"version":1,"x":"120","y":80}')).toBeNull();
    expect(parseStoredWidgetPosition('not-json')).toBeNull();
  });

  it('waits for real pointer movement before treating a click as a drag', () => {
    expect(hasMovedPastDragThreshold({ x: 100, y: 100 }, { x: 103, y: 104 })).toBe(false);
    expect(hasMovedPastDragThreshold({ x: 100, y: 100 }, { x: 106, y: 100 })).toBe(true);
  });
});
