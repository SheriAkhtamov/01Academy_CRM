import { useRef } from 'react';
import { Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslation } from '@/hooks/useTranslation';

interface LeadCallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadName: string;
  phoneNumbers: string[];
  onCall: (phone: string) => void;
  disabled?: boolean;
}

export function LeadCallDialog({
  open, onOpenChange, leadName, phoneNumbers, onCall, disabled = false,
}: LeadCallDialogProps) {
  const { t } = useTranslation();
  const openerRef = useRef<HTMLElement | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-sm"
        onOpenAutoFocus={() => {
          openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          if (!openerRef.current?.isConnected) return;
          event.preventDefault();
          openerRef.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="pr-6">{t('chooseLeadCallPhone')}</DialogTitle>
          <DialogDescription className="break-words">{leadName}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {phoneNumbers.map((phone) => (
            <Button
              key={phone}
              type="button"
              variant="outline"
              className="h-auto min-h-12 justify-start py-3"
              disabled={disabled}
              onClick={() => {
                onOpenChange(false);
                onCall(phone);
              }}
            >
              <Phone className="shrink-0" data-icon="inline-start" aria-hidden="true" />
              <span className="min-w-0 break-all tabular-nums">{phone}</span>
            </Button>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
