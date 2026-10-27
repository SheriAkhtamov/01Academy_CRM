import { useContext, useEffect, type ReactNode } from 'react';
import { MotionConfigContext, useReducedMotionConfig } from 'framer-motion';
import { installErrorShake } from '@/lib/errorShake';
import './error-shake.css';

/** Shared validation feedback for native controls, RHF fields and portalled dialogs. */
export function ErrorShakeProvider({ children }: { children: ReactNode }) {
  const reduced = useReducedMotionConfig();
  const config = useContext(MotionConfigContext);
  const instant = config.transition?.duration === 0;
  useEffect(() => {
    if (reduced || instant) return;
    return installErrorShake(document, () => document.documentElement.dataset.motion !== 'off' && !document.hidden);
  }, [reduced, instant]);
  return <>{children}</>;
}
