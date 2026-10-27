import { createContext, useContext, type HTMLAttributes } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { OrbitSpinner } from './orbit-spinner';

const LoadingRegionContext = createContext(false);

type LoadingRegionProps = HTMLAttributes<HTMLDivElement> & {
  loading?: boolean;
  as?: 'div' | 'section';
};

/** One orbit per loading region; nested skeleton sections retain their layout. */
export function LoadingRegion({ loading = true, as: Comp = 'div', className, children, ...props }: LoadingRegionProps) {
  const { t } = useTranslation();
  const inherited = useContext(LoadingRegionContext);
  const showIndicator = loading && !inherited;
  return (
    <LoadingRegionContext.Provider value={inherited || loading}>
      <Comp
        {...props}
        className={cn('relative', className)}
        role={showIndicator ? 'status' : inherited && props.role === 'status' ? undefined : props.role}
        aria-label={showIndicator ? props['aria-label'] ?? t('loading') : inherited ? undefined : props['aria-label']}
        aria-busy={loading ? true : props['aria-busy']}
      >
        {showIndicator ? (
          <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center" aria-hidden="true">
            <OrbitSpinner className="size-6 text-muted-foreground" />
          </span>
        ) : null}
        {children}
      </Comp>
    </LoadingRegionContext.Provider>
  );
}
