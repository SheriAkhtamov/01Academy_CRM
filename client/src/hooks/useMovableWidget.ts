import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

export type WidgetPosition = {
  x: number;
  y: number;
};

type DragState = {
  pointerId: number;
  startPointerX: number;
  startPointerY: number;
  startWidgetX: number;
  startWidgetY: number;
};

const POSITION_VERSION = 1;
const KEYBOARD_STEP = 16;
const KEYBOARD_LARGE_STEP = 48;

export const clampWidgetPosition = (
  position: WidgetPosition,
  widgetSize: { width: number; height: number },
  viewportSize: { width: number; height: number },
  margin = 12,
): WidgetPosition => ({
  x: Math.min(
    Math.max(margin, position.x),
    Math.max(margin, viewportSize.width - widgetSize.width - margin),
  ),
  y: Math.min(
    Math.max(margin, position.y),
    Math.max(margin, viewportSize.height - widgetSize.height - margin),
  ),
});

export const parseStoredWidgetPosition = (value: string | null): WidgetPosition | null => {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as {
      version?: number;
      x?: number;
      y?: number;
    };

    if (
      parsed.version !== POSITION_VERSION
      || typeof parsed.x !== 'number'
      || typeof parsed.y !== 'number'
      || !Number.isFinite(parsed.x)
      || !Number.isFinite(parsed.y)
    ) {
      return null;
    }

    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
};

export function useMovableWidget<T extends HTMLElement>(
  storageKey: string,
  defaultMargin = 20,
  layoutKey?: unknown,
) {
  const widgetRef = useRef<T | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [position, setPosition] = useState<WidgetPosition | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      return parseStoredWidgetPosition(window.localStorage.getItem(storageKey));
    } catch {
      return null;
    }
  });
  const [isDragging, setIsDragging] = useState(false);

  const getClampedPosition = useCallback((nextPosition: WidgetPosition): WidgetPosition => {
    const widget = widgetRef.current;
    if (!widget || typeof window === 'undefined') return nextPosition;

    const bounds = widget.getBoundingClientRect();
    return clampWidgetPosition(
      nextPosition,
      { width: bounds.width, height: bounds.height },
      { width: window.innerWidth, height: window.innerHeight },
      defaultMargin,
    );
  }, [defaultMargin]);

  const moveTo = useCallback((nextPosition: WidgetPosition) => {
    setPosition(getClampedPosition(nextPosition));
  }, [getClampedPosition]);

  const resetToDefault = useCallback(() => {
    setPosition(null);
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // The widget still works when browser storage is unavailable.
    }
  }, [storageKey]);

  useEffect(() => {
    if (!position) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({
        version: POSITION_VERSION,
        ...position,
      }));
    } catch {
      // Persisting the position is a convenience, not a requirement.
    }
  }, [position, storageKey]);

  useEffect(() => {
    const widget = widgetRef.current;
    if (!widget) return undefined;

    const keepInsideViewport = () => {
      setPosition((current) => {
        if (!current) return current;
        const clamped = getClampedPosition(current);
        return clamped.x === current.x && clamped.y === current.y ? current : clamped;
      });
    };

    keepInsideViewport();
    window.addEventListener('resize', keepInsideViewport);
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(keepInsideViewport);
    resizeObserver?.observe(widget);

    return () => {
      window.removeEventListener('resize', keepInsideViewport);
      resizeObserver?.disconnect();
    };
  }, [getClampedPosition, layoutKey]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      event.preventDefault();
      moveTo({
        x: dragState.startWidgetX + event.clientX - dragState.startPointerX,
        y: dragState.startWidgetY + event.clientY - dragState.startPointerY,
      });
    };

    const finishDrag = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      dragStateRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
    };
  }, [moveTo]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !widgetRef.current) return;
    const bounds = widgetRef.current.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startWidgetX: bounds.left,
      startWidgetY: bounds.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPosition({ x: bounds.left, y: bounds.top });
    setIsDragging(true);
    event.preventDefault();
  }, []);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Home') {
      event.preventDefault();
      resetToDefault();
      return;
    }

    const directions: Partial<Record<string, [number, number]>> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const direction = directions[event.key];
    if (!direction || !widgetRef.current) return;

    event.preventDefault();
    const bounds = widgetRef.current.getBoundingClientRect();
    const step = event.shiftKey ? KEYBOARD_LARGE_STEP : KEYBOARD_STEP;
    moveTo({
      x: bounds.left + direction[0] * step,
      y: bounds.top + direction[1] * step,
    });
  }, [moveTo, resetToDefault]);

  const dragHandleProps: ButtonHTMLAttributes<HTMLButtonElement> = {
    onPointerDown: handlePointerDown,
    onKeyDown: handleKeyDown,
  };

  const widgetStyle: CSSProperties = position
    ? { left: `${position.x}px`, top: `${position.y}px` }
    : { bottom: `${defaultMargin}px`, right: `${defaultMargin}px` };

  return {
    widgetRef,
    widgetStyle,
    dragHandleProps,
    isDragging,
    resetToDefault,
  };
}
