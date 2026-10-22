import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useTranslation } from '@/hooks/useTranslation';
import '@/components/ux/compact-modal.css';

interface ConfirmDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    variant?: 'default' | 'destructive';
    isPending?: boolean;
    keepOpenOnConfirm?: boolean;
    children?: ReactNode;
    error?: string;
    confirmDisabled?: boolean;
    compact?: boolean;
    /** Where focus goes once the dialog has closed; call `event.preventDefault()` to place it yourself. */
    onCloseAutoFocus?: (event: Event) => void;
}

export default function ConfirmDialog({
    open,
    onOpenChange,
    title,
    description,
    confirmLabel,
    cancelLabel,
    onConfirm,
    variant = 'default',
    isPending = false,
    keepOpenOnConfirm = false,
    children,
    error,
    confirmDisabled = false,
    compact = false,
    onCloseAutoFocus,
}: ConfirmDialogProps) {
    const { t } = useTranslation();
    const finalConfirmLabel = confirmLabel || t('ok');
    const finalCancelLabel = cancelLabel || t('cancel');

    return (
        <AlertDialog open={open} onOpenChange={(next) => { if (!isPending) onOpenChange(next); }}>
            <AlertDialogContent
                onCloseAutoFocus={onCloseAutoFocus}
                className={compact ? 'compact-modal flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0' : undefined}
            >
                <AlertDialogHeader className={compact ? 'compact-modal-header' : undefined}>
                    <AlertDialogTitle className={compact ? 'text-base leading-6' : undefined}>{title}</AlertDialogTitle>
                    {compact ? null : <AlertDialogDescription>{description}</AlertDialogDescription>}
                </AlertDialogHeader>
                {compact ? (
                    <div className="compact-modal-body min-h-0 space-y-3 overflow-y-auto overscroll-contain">
                        <AlertDialogDescription className="break-words">{description}</AlertDialogDescription>
                        {children}
                        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                    </div>
                ) : <>
                    {children}
                    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                </>}
                <AlertDialogFooter className={compact ? 'compact-modal-footer' : undefined}>
                    <AlertDialogCancel disabled={isPending}>{finalCancelLabel}</AlertDialogCancel>
                    <AlertDialogAction
                        disabled={isPending || confirmDisabled}
                        onClick={(event) => {
                            if (keepOpenOnConfirm) event.preventDefault();
                            onConfirm();
                        }}
                        className={variant === 'destructive' ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground' : ''}
                    >
                        {isPending ? <Loader2 className="animate-spin mr-1.5 h-4 w-4 inline-block" /> : null}
                        {isPending ? t('saving') : finalConfirmLabel}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
