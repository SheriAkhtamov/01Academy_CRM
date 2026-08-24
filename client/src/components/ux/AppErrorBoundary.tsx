import React from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useTranslation } from '@/hooks/useTranslation';
import { AlertCircle, Home, RotateCcw } from 'lucide-react';

type BoundaryState = {
  error: Error | null;
  resetKey: string;
  /** How many times the in-place retry has been attempted without success. */
  attempts: number;
};

class ErrorBoundaryRoot extends React.Component<{
  children: React.ReactNode;
  resetKey: string;
  fallback: (error: Error, reset: () => void, giveUpInPlace: boolean) => React.ReactNode;
}, BoundaryState> {
  state: BoundaryState = {
    error: null,
    resetKey: this.props.resetKey,
    attempts: 0,
  };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: BoundaryState): Partial<BoundaryState> | null {
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey, attempts: 0 };
    }
    return null;
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Always log: production crashes used to be invisible because this only
    // reported in DEV. Console output is the least teams can inspect remotely.
    console.error('[AppErrorBoundary]', error, errorInfo);
  }

  reset = () => this.setState((current) => ({ error: null, attempts: current.attempts + 1 }));

  render() {
    if (this.state.error) {
      // A failed lazy-route chunk keeps throwing when React retries it in
      // place, so after one failed attempt the fallback offers a full reload,
      // which is the only reliable recovery for a stale chunk.
      return this.props.fallback(this.state.error, this.reset, this.state.attempts >= 1);
    }

    return this.props.children;
  }
}

export function AppErrorBoundary({
  children,
  variant = 'root',
  resetKey,
}: {
  children: React.ReactNode;
  /** `root` replaces the whole shell; `page` sits inside the layout so the header/sidebar survive a page crash. */
  variant?: 'root' | 'page';
  /** Changing this value clears a caught error — pass the route so navigation recovers. */
  resetKey?: string;
}) {
  const [location] = useLocation();
  const [, setLocation] = useLocation();
  const { t } = useTranslation();

  const wrapperClassName = variant === 'root'
    ? 'mx-auto max-w-[1600px] p-6 lg:p-8'
    : 'p-6 lg:p-8';

  return (
    <ErrorBoundaryRoot
      resetKey={resetKey ?? location}
      fallback={(error, reset, giveUpInPlace) => (
        <div className={wrapperClassName}>
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>{t('errorOccurred')}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3">
              <span>{import.meta.env.DEV && error.message ? error.message : t('failedToLoadData')}</span>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={reset}>
                  <RotateCcw data-icon="inline-start" />
                  {t('retry')}
                </Button>
                {giveUpInPlace ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
                    {t('reloadPage')}
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" size="sm" onClick={() => setLocation('/')}>
                  <Home data-icon="inline-start" />
                  {t('goHome')}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        </div>
      )}
    >
      {children}
    </ErrorBoundaryRoot>
  );
}
