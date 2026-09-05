import { CheckCircle2, Copy, ExternalLink, Loader2, MessageSquare, Phone, Plus } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { LeadStageStepper, type StepperStageSource } from './LeadSheetControls';
import { useTranslation } from '@/hooks/useTranslation';
import type { useOnlinePbxCall } from '@/hooks/useOnlinePbxCall';
import type { leadMessageTarget } from '@/lib/leadContact';
import { getInitials } from '@/lib/auth';

interface LeadWorkspaceHeaderProps {
  lead: {
    contactName: string; statusCode: string; isArchived?: boolean;
    managerName?: string | null; sourceName?: string | null;
  };
  visiblePhoneNumbers: string[];
  primaryPhone: string | null;
  messageTarget: ReturnType<typeof leadMessageTarget>;
  statuses: StepperStageSource[];
  leadStatusName: (code: string) => string;
  onlinePbxCall: ReturnType<typeof useOnlinePbxCall>;
  copyPhone: (phone: string) => void;
  onNote: () => void;
  onTask: () => void;
}

export function LeadWorkspaceHeader({
  lead, visiblePhoneNumbers, primaryPhone, messageTarget, statuses,
  leadStatusName, onlinePbxCall, copyPhone, onNote, onTask,
}: LeadWorkspaceHeaderProps) {
  const { t } = useTranslation();
  return (
    <SheetHeader className="max-h-[38dvh] shrink-0 space-y-2 overflow-y-auto border-b border-border bg-background px-4 pb-3 pt-4 text-left sm:px-6">
      <div className="flex items-start gap-3 pr-10">
        <Avatar className="size-11 shrink-0 border border-primary/15 bg-primary/5">
          <AvatarFallback>{getInitials(lead.contactName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle className="break-words text-lg leading-tight sm:text-xl">{lead.contactName}</SheetTitle>
            {lead.statusCode === 'paid' ? (
              <Badge variant="success">
                <CheckCircle2 className="size-3" aria-hidden="true" />
                {leadStatusName('paid')}
              </Badge>
            ) : null}
            {lead.isArchived ? (
              <Badge variant="outline">{t('leadInArchive')}</Badge>
            ) : null}
          </div>
          <SheetDescription className="sr-only">{t('lead')}</SheetDescription>

          {/* Phone chips dial via tel:; the trailing button copies the number */}
          <div className="flex flex-wrap items-center gap-1.5">
            {visiblePhoneNumbers.length > 0 ? (
              visiblePhoneNumbers.map((phone) => (
                <span
                  key={phone}
                  className="group/phone inline-flex max-w-full items-center gap-1 rounded-md bg-muted/60 py-1 pl-2 pr-1 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Phone className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <a
                    href={`tel:${phone.replace(/[^\d+]/g, '')}`}
                    title={t('callShort')}
                    className="truncate tabular-nums transition-colors hover:text-primary"
                  >
                    {phone}
                  </a>
                  <button
                    type="button"
                    title={t('clickToCopy')}
                    aria-label={`${t('clickToCopy')}: ${phone}`}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => copyPhone(phone)}
                  >
                    <Copy className="size-3" aria-hidden="true" />
                    <span className="sr-only">{t('clickToCopy')}</span>
                  </button>
                </span>
              ))
            ) : (
              <span className="text-xs italic text-muted-foreground">{t('leadSheetNoContactInfo')}</span>
            )}
          </div>

          {/* Quiet single-line meta */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span>{t('manager')}: {lead.managerName || t('notAssigned')}</span>
            <span aria-hidden="true">·</span>
            <span>{lead.sourceName || t('unknownSource')}</span>
          </div>
        </div>
      </div>

      <LeadStageStepper
        statuses={statuses}
        currentStatusCode={lead.statusCode}
        leadStatusName={leadStatusName}
      />

      {/* Quick actions — single prominent CTA + secondary outline buttons */}
      <div className="grid grid-cols-4 gap-1 sm:flex sm:flex-wrap sm:gap-2">
        {primaryPhone ? (
          <Button
            type="button"
            size="sm" className="px-1 text-xs sm:px-3 sm:text-sm [&>svg]:hidden sm:[&>svg]:block"
            variant="default"
            disabled={onlinePbxCall.isPending}
            onClick={() => onlinePbxCall.startCall(primaryPhone)}
          >
            {onlinePbxCall.isPending && onlinePbxCall.pendingPhone === primaryPhone ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <Phone data-icon="inline-start" />
            )}
            {t('callShort')}
          </Button>
        ) : null}
        {messageTarget ? (
          <Button asChild size="sm" className="px-1 text-xs sm:px-3 sm:text-sm [&>svg]:hidden sm:[&>svg]:block" variant="outline">
            <a
              href={messageTarget.href}
              target={messageTarget.external ? '_blank' : undefined}
              rel={messageTarget.external ? 'noreferrer' : undefined}
            >
              <MessageSquare data-icon="inline-start" />
              {t('writeShort')}
              {messageTarget.external ? <ExternalLink data-icon="inline-end" /> : null}
            </a>
          </Button>
        ) : null}
        <Button type="button" size="sm" className="px-1 text-xs sm:px-3 sm:text-sm [&>svg]:hidden sm:[&>svg]:block" variant="ghost" onClick={onNote}>
          <MessageSquare data-icon="inline-start" />
          {t('leadWorkspaceNote')}
        </Button>
        <Button type="button" size="sm" className="px-1 text-xs sm:px-3 sm:text-sm [&>svg]:hidden sm:[&>svg]:block" variant="ghost" onClick={onTask}>
          <Plus data-icon="inline-start" />
          {t('leadWorkspaceTask')}
        </Button>
      </div>
    </SheetHeader>
  );
}
