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
}: ConfirmDialogProps) {
    const { t } = useTranslation();
    const finalConfirmLabel = confirmLabel || t('ok');
    const finalCancelLabel = cancelLabel || t('cancel');

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isPending}>{finalCancelLabel}</AlertDialogCancel>
                    <AlertDialogAction
                        disabled={isPending}
                        onClick={(event) => {
                            if (keepOpenOnConfirm) event.preventDefault();
                            onConfirm();
                        }}
                        className={variant === 'destructive' ? 'bg-red-600 hover:bg-red-700 text-white' : ''}
                    >
                        {isPending ? t('saving') : finalConfirmLabel}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
