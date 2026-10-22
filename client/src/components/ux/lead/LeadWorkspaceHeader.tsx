import { useState, type ReactNode } from 'react';
import { Copy, ExternalLink, Loader2, MessageSquare, Phone } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { LeadStageStepper, type StepperStageSource } from './LeadSheetControls';
import { LeadCallDialog } from './LeadCallDialog';
import { useTranslation } from '@/hooks/useTranslation';
import type { useOnlinePbxCall } from '@/hooks/useOnlinePbxCall';
import type { leadMessageTarget } from '@/lib/leadContact';
import { getInitials } from '@/lib/auth';
import { EmployeeIdentity } from '@/components/ux/EmployeeIdentity';

interface LeadWorkspaceHeaderProps {
  actionsDisabled?: boolean;
  lead: {
    contactName: string; statusCode: string; isArchived?: boolean;
    managerId?: number | null; managerName?: string | null; sourceName?: string | null;
  };
  visiblePhoneNumbers: string[];
  primaryPhone: string | null;
  messageTarget: ReturnType<typeof leadMessageTarget>;
  statuses: StepperStageSource[];
  leadStatusName: (code: string) => string;
  onlinePbxCall: ReturnType<typeof useOnlinePbxCall>;
  copyPhone: (phone: string) => void;
  tagsEditor: ReactNode;
  archiveAction: ReactNode;
  workflowActions?: ReactNode;
}

export function LeadWorkspaceHeader({
  lead, visiblePhoneNumbers, primaryPhone, messageTarget, statuses,
  leadStatusName, onlinePbxCall, copyPhone, tagsEditor, archiveAction, workflowActions,
  actionsDisabled = false,
}: LeadWorkspaceHeaderProps) {
  const { t } = useTranslation();
  const [callDialogOpen, setCallDialogOpen] = useState(false);
  return (
    <SheetHeader className="max-h-[38dvh] shrink-0 space-y-2.5 overflow-y-auto border-b border-border-strong bg-muted/70 px-3 py-3 text-left sm:px-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pr-9">
        <div className="flex min-w-0 flex-1 basis-48 items-center gap-2.5">
          <Avatar className="size-10 shrink-0 rounded-xl border border-primary/15">
            <AvatarFallback className="rounded-xl bg-primary/10 text-base font-semibold text-primary">{getInitials(lead.contactName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <SheetTitle className="break-words text-xl font-semibold leading-tight tracking-tight">{lead.contactName}</SheetTitle>
              {lead.isArchived ? (
                <Badge variant="outline">{t('leadInArchive')}</Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>{t('manager')}</span>
              <EmployeeIdentity userId={lead.managerId} name={lead.managerName || t('notAssigned')} avatarClassName="size-5 text-[9px]" />
            </div>
            <SheetDescription className="sr-only">{t('lead')}</SheetDescription>
          </div>
        </div>

        {/* Phone chips dial via tel:; the trailing button copies the number */}
        <div className="flex max-w-full flex-wrap items-center gap-1.5 sm:max-w-[45%] sm:justify-end">
          {visiblePhoneNumbers.length > 0 ? (
            visiblePhoneNumbers.map((phone) => (
              <span
                key={phone}
                className="group/phone inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border/60 bg-background py-0.5 pl-2.5 pr-0.5 text-xs font-medium text-foreground transition-colors hover:border-primary/25"
              >
                <Phone className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <a
                  data-lead-processing
                  href={actionsDisabled ? undefined : `tel:${phone.replace(/[^\d+]/g, '')}`}
                  aria-disabled={actionsDisabled || undefined}
                  className="truncate tabular-nums transition-colors hover:text-primary"
                >
                  {phone}
                </a>
                <button
                  type="button"
                  aria-label={`${t('telephonyCopyNumber')}: ${phone}`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => copyPhone(phone)}
                >
                  <Copy className="size-3" aria-hidden="true" />
                  <span className="sr-only">{t('telephonyCopyNumber')}</span>
                </button>
              </span>
            ))
          ) : (
            <span className="text-xs italic text-muted-foreground">{t('leadSheetNoContactInfo')}</span>
          )}
        </div>
      </div>

      <div className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] sm:gap-4">
        <fieldset data-lead-processing disabled={actionsDisabled} className="min-w-0">
          {tagsEditor}
        </fieldset>
        <LeadStageStepper
          statuses={statuses}
          currentStatusCode={lead.statusCode}
          leadStatusName={leadStatusName}
        />
      </div>

      {/* Quick actions — single prominent CTA + secondary outline buttons */}
      <fieldset data-lead-processing disabled={actionsDisabled} className="lead-workspace-actions flex flex-wrap gap-1.5">
        {primaryPhone ? (
          <Button
            type="button"
            size="sm" className="max-w-full whitespace-normal"
            variant="default"
            disabled={actionsDisabled || onlinePbxCall.isPending || onlinePbxCall.isLineBusyWithReminder}
            onClick={() => {
              if (visiblePhoneNumbers.length > 1) setCallDialogOpen(true);
              else onlinePbxCall.startCall(primaryPhone);
            }}
          >
            {onlinePbxCall.isPending ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <Phone data-icon="inline-start" />
            )}
            {onlinePbxCall.isLineBusyWithReminder ? onlinePbxCall.callButtonLabel : t('callShort')}
          </Button>
        ) : null}
        {messageTarget && !actionsDisabled ? (
          <Button asChild size="sm" variant="outline">
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
        {archiveAction}
        {workflowActions}
      </fieldset>
      <LeadCallDialog
        open={callDialogOpen}
        onOpenChange={setCallDialogOpen}
        leadName={lead.contactName}
        phoneNumbers={visiblePhoneNumbers}
        onCall={onlinePbxCall.startCall}
        disabled={actionsDisabled || onlinePbxCall.isPending}
        disabledLabel={onlinePbxCall.isLineBusyWithReminder ? onlinePbxCall.callButtonLabel : undefined}
      />
    </SheetHeader>
  );
}
