import { type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { DragOverlay } from '@dnd-kit/core';

type DragOverlayPortalProps = ComponentProps<typeof DragOverlay>;

export function DragOverlayPortal({ children, ...props }: DragOverlayPortalProps) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <DragOverlay {...props}>{children}</DragOverlay>,
    document.body,
  );
}
