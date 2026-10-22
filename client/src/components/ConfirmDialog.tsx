import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogBody,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useTranslation } from '@/hooks/useTranslation';

interface ConfirmDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: string;
    target?: string;
    confirmationKey?: string | number;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void | Promise<unknown>;
    variant?: 'default' | 'destructive';
    isPending?: boolean;
    keepOpenOnConfirm?: boolean;
    children?: ReactNode;
    error?: string;
    confirmDisabled?: boolean;
    /** Retained for existing callers; confirmation windows now share one compact layout. */
    compact?: boolean;
    /** Where focus goes once the dialog has closed; call `event.preventDefault()` to place it yourself. */
    onCloseAutoFocus?: (event: Event) => void;
}

export default function ConfirmDialog({
    open,
    onOpenChange,
    title,
    description,
    target,
    confirmationKey,
    confirmLabel,
    cancelLabel,
    onConfirm,
    variant = 'default',
    isPending = false,
    keepOpenOnConfirm = false,
    children,
    error,
    confirmDisabled = false,
    onCloseAutoFocus,
}: ConfirmDialogProps) {
    const { t } = useTranslation();
    const [awaitingResult, setAwaitingResult] = useState(false);
    const [callbackFailed, setCallbackFailed] = useState(false);
    const submitted = useRef(false);
    const session = useRef(0);
    const current = useRef({ open, isPending, onOpenChange });
    current.current = { open, isPending, onOpenChange };
    const busy = isPending || awaitingResult;

    useEffect(() => {
        // An older callback may finish after the controlled dialog has closed
        // and reopened. It must not close or unlock the new confirmation.
        session.current += 1;
        submitted.current = false;
        setAwaitingResult(false);
        setCallbackFailed(false);
        return () => { session.current += 1; };
    }, [open, title, description, target, confirmationKey]);

    useEffect(() => {
        if (!isPending && !awaitingResult) submitted.current = false;
    }, [isPending, awaitingResult]);

    const confirm = () => {
        if (!open || busy || confirmDisabled || submitted.current) return;
        submitted.current = true;
        setCallbackFailed(false);
        const startedInSession = session.current;
        const finish = (failed: boolean) => {
            if (session.current !== startedInSession || !current.current.open) return;
            setAwaitingResult(false);
            submitted.current = current.current.isPending;
            setCallbackFailed(failed);
            if (!failed && !keepOpenOnConfirm) current.current.onOpenChange(false);
        };

        try {
            const result = onConfirm();
            if (result && typeof result.then === 'function') {
                setAwaitingResult(true);
                void Promise.resolve(result).then(() => finish(false), () => finish(true));
            } else {
                if (!keepOpenOnConfirm) onOpenChange(false);
                // Keep synchronous keep-open callers retryable, while rejecting
                // a second click before their mutation state has rendered.
                queueMicrotask(() => {
                    if (session.current === startedInSession) submitted.current = current.current.isPending;
                });
            }
        } catch {
            finish(true);
        }
    };

    return (
        <AlertDialog open={open} pending={busy} onOpenChange={onOpenChange}>
            <AlertDialogContent
                onCloseAutoFocus={onCloseAutoFocus}
            >
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                </AlertDialogHeader>
                <AlertDialogBody>
                    {target ? <p className="rounded-md border border-border-strong bg-card px-3 py-2 text-sm font-semibold [overflow-wrap:anywhere]">{target}</p> : null}
                    <AlertDialogDescription className={description ? undefined : 'sr-only'}>{description}</AlertDialogDescription>
                    {children}
                    {error || callbackFailed ? <p role="alert" className="text-sm text-destructive">{error || t('errorOccurred')}</p> : null}
                </AlertDialogBody>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>{cancelLabel || t('cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                        disabled={busy || confirmDisabled}
                        onClick={(event) => {
                            event.preventDefault();
                            confirm();
                        }}
                        className={variant === 'destructive' ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground' : ''}
                    >
                        {busy ? <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                        {busy ? t('confirmProcessing') : confirmLabel || t('ok')}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
