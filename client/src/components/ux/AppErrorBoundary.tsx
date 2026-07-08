import React from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useTranslation } from '@/hooks/useTranslation';
import { AlertCircle, RotateCcw } from 'lucide-react';

type BoundaryState = {
  error: Error | null;
  resetKey: string;
};

class ErrorBoundaryRoot extends React.Component<{
  children: React.ReactNode;
  resetKey: string;
  fallback: (error: Error, reset: () => void) => React.ReactNode;
}, BoundaryState> {
  state: BoundaryState = {
    error: null,
    resetKey: this.props.resetKey,
  };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: BoundaryState): Partial<BoundaryState> | null {
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[AppErrorBoundary]', error, errorInfo);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error, this.reset);
    }

    return this.props.children;
  }
}

export function AppErrorBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { t } = useTranslation();

  return (
    <ErrorBoundaryRoot
      resetKey={location}
      fallback={(error, reset) => (
        <div className="mx-auto max-w-[1600px] p-6 lg:p-8">
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>{t('errorOccurred')}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3">
              <span>{error.message || t('failedToLoadData')}</span>
              <Button type="button" variant="outline" size="sm" onClick={reset}>
                <RotateCcw data-icon="inline-start" />
                {t('retry')}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}
    >
      {children}
    </ErrorBoundaryRoot>
  );
}
