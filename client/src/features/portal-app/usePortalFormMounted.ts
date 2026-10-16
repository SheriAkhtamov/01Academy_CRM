import { useEffect, useRef } from "react";

/** A completed request must not act on a replacement dialog. */
export function usePortalFormMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return mounted;
}
