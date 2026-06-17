import { useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowRight, MoreHorizontal, Phone, Send, UserPlus, Wallet } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/hooks/useTranslation';

interface KanbanStatus {
  code: string;
  name: string;
  color: string;
  sortOrder: number;
}

interface KanbanLead {
  id: number;
  contactName: string;
  phone?: string;
  courseName?: string;
  sourceName?: string;
  managerName?: string;
  studentAge?: number;
  expectedPaymentUzs?: number;
  offerPriceUzs?: number;
  statusCode: string;
}

interface KanbanBoardProps {
  statuses: readonly KanbanStatus[];
  leads: KanbanLead[];
  onStatusChange: (leadId: number, statusCode: string) => void;
  onQuickAction?: (action: 'qualify' | 'warm' | 'payment' | 'call' | 'message', lead: KanbanLead) => void;
  isPending?: boolean;
  showPaymentAction?: boolean;
}

export function KanbanBoard({ statuses, leads, onStatusChange, onQuickAction, isPending, showPaymentAction = true }: KanbanBoardProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  const getLeadsByStatus = (code: string) => leads.filter((lead) => lead.statusCode === code);

  const getNextStatuses = (currentStatus: KanbanStatus) => {
    return statuses.filter((status) => status.sortOrder > currentStatus.sortOrder);
  };

  const getPrevStatuses = (currentStatus: KanbanStatus) => {
    return statuses.filter((status) => status.sortOrder < currentStatus.sortOrder);
  };

  return (
    <div ref={scrollRef} className="-mx-2 overflow-x-auto pb-2">
      <div className="flex gap-4 min-w-max px-2">
        {statuses.map((status) => {
          const statusLeads = getLeadsByStatus(status.code);
          const nextStatuses = getNextStatuses(status);
          const prevStatuses = getPrevStatuses(status);

          return (
            <div
              key={status.code}
              className="w-80 flex-shrink-0 flex flex-col rounded-xl bg-slate-50/60 border border-slate-200/70 max-h-[calc(100vh-260px)]"
            >
              <div className="flex items-center justify-between gap-2 p-4 pb-3 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: status.color }} />
                  <span className="text-sm font-semibold text-slate-700 truncate">{status.name}</span>
                </div>
                <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-white border border-slate-200 px-1.5 text-xs font-semibold text-slate-600 shadow-2xs">
                  {statusLeads.length}
                </span>
              </div>

              <div className="p-3 pt-0 space-y-2.5 flex-1 overflow-y-auto">
                {statusLeads.map((lead) => (
                  <div
                    key={lead.id}
                    className="rounded-lg border border-slate-200/80 bg-white p-3 shadow-2xs transition-all duration-200 hover:shadow-md hover:border-slate-300 hover:-translate-y-0.5 group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-sm text-slate-900 truncate">{lead.contactName}</div>
                        {lead.phone && <div className="text-xs text-slate-500 truncate">{lead.phone}</div>}
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 -mr-1 -mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <MoreHorizontal className="h-4 w-4 text-slate-400" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          {nextStatuses.slice(0, 3).map((nextStatus) => (
                            <DropdownMenuItem
                              key={nextStatus.code}
                              onClick={() => onStatusChange(lead.id, nextStatus.code)}
                              disabled={isPending}
                            >
                              <ArrowRight className="h-4 w-4 mr-2" />
                              {t('moveTo')} {nextStatus.name}
                            </DropdownMenuItem>
                          ))}
                          {prevStatuses.length > 0 && nextStatuses.length > 0 && <hr className="my-1 border-slate-100" />}
                          {prevStatuses.slice(-2).map((prevStatus) => (
                            <DropdownMenuItem
                              key={prevStatus.code}
                              onClick={() => onStatusChange(lead.id, prevStatus.code)}
                              disabled={isPending}
                            >
                              {t('returnTo')} {prevStatus.name}
                            </DropdownMenuItem>
                          ))}
                          <hr className="my-1 border-slate-100" />
                          <DropdownMenuItem onClick={() => onQuickAction?.('call', lead)}>
                            <Phone className="h-4 w-4 mr-2" /> {t('call')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onQuickAction?.('message', lead)}>
                            <Send className="h-4 w-4 mr-2" /> {t('write')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1">
                      {lead.courseName && <Badge variant="secondary" className="text-xs">{lead.courseName}</Badge>}
                      {lead.sourceName && <Badge variant="outline" className="text-xs">{lead.sourceName}</Badge>}
                      {lead.studentAge && <Badge variant="outline" className="text-xs">{lead.studentAge} {t('years')}</Badge>}
                    </div>

                    <div className="mt-3 flex gap-1 flex-wrap">
                      {nextStatuses.slice(0, 1).map((nextStatus) => (
                        <Button
                          key={nextStatus.code}
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => onStatusChange(lead.id, nextStatus.code)}
                          disabled={isPending}
                        >
                          <ArrowRight className="h-3 w-3 mr-1" /> {nextStatus.name}
                        </Button>
                      ))}
                      {showPaymentAction && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs px-2"
                          onClick={() => onQuickAction?.('payment', lead)}
                        >
                          <Wallet className="h-3 w-3 mr-1" /> {t('payment')}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs px-2"
                        onClick={() => onQuickAction?.('qualify', lead)}
                      >
                        <UserPlus className="h-3 w-3 mr-1" /> {t('qualify')}
                      </Button>
                    </div>
                  </div>
                ))}
                {statusLeads.length === 0 && (
                  <div className="py-8 text-center">
                    <div className="mx-auto h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center mb-2">
                      <ArrowRight className="h-5 w-5 text-slate-300" />
                    </div>
                    <p className="text-xs text-slate-400">{t('noLeadsInStage')}</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Add statusCode to lead type for internal filtering
KanbanBoard.defaultProps = {};
