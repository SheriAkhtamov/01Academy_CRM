import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import type { PortalDeliveryFailure, PortalDeliveryQuery, PortalDeliveryRetry } from "@shared/contracts/portal-delivery-management";
import { hasLeadershipAccess } from "@shared/academy";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { portalDeliveryApi, PortalDeliveryRequestError } from "./delivery-api";

const messageLabels: Record<PortalDeliveryFailure["template"], TranslationKey> = {
  invitation: "portalDeliveryInvitation", recovery: "portalDeliveryRecovery", email_change: "portalDeliveryEmailChange", email_changed: "portalDeliveryEmailChanged", notification: "portalDeliveryNotification",
};
export type PortalDeliveryFailuresDialogProps = {
  open: boolean; onOpenChange: (open: boolean) => void; enabled?: boolean; canManageAccess?: boolean;
};
export function PortalDeliveryFailuresDialog({ open, onOpenChange, enabled = true, canManageAccess = true }: PortalDeliveryFailuresDialogProps) {
  const { user } = useAuth();
  const { t, language } = useTranslation();
  const client = useQueryClient();
  const [kind, setKind] = useState<PortalDeliveryQuery["kind"]>("all");
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [notice, setNotice] = useState<TranslationKey | null>(null);
  const [error, setError] = useState<TranslationKey | null>(null);
  const commands = useRef(new Map<string, PortalDeliveryRetry>());
  const allowed = enabled && canManageAccess && hasLeadershipAccess(user);
  const cursor = cursors[cursors.length - 1];
  const query = useQuery({ queryKey: ["staff-portal-delivery-failures", user?.id ?? 0, kind, cursor],
    queryFn: () => portalDeliveryApi.list({ kind, cursor, limit: 30 }), enabled: open && allowed, staleTime: 0 });
  useEffect(() => {
    if (!open) return;
    setKind("all"); setCursors([undefined]); setError(null); setNotice(null); commands.current.clear();
  }, [open]);
  const retry = useMutation({ mutationFn: (row: PortalDeliveryFailure) => {
    const key = `${row.kind}:${row.id}:${row.version}`;
    let command = commands.current.get(key);
    if (!command) { command = { version: row.version, idempotencyKey: crypto.randomUUID() }; commands.current.set(key, command); }
    return portalDeliveryApi.retry(row.kind, row.id, command);
  }, onSuccess: async () => {
    setError(null); setNotice("portalDeliveryRetryQueued");
    await client.invalidateQueries({ queryKey: ["staff-portal-delivery-failures", user?.id ?? 0] });
  }, onError: (failure) => {
    setNotice(null); setError(failure instanceof PortalDeliveryRequestError ? failure.code : "portalDeliveryLoadFailed");
  } });
  const format = useMemo(() => new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tashkent" }), [language]);
  if (!allowed) return null;
  return (
    <Dialog open={open} onOpenChange={(value) => { if (!retry.isPending) onOpenChange(value); }}>
      <DialogContent className="flex max-h-[92dvh] min-w-0 flex-col overflow-hidden sm:max-w-5xl" onEscapeKeyDown={(event) => { if (retry.isPending) event.preventDefault(); }} onPointerDownOutside={(event) => { if (retry.isPending) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>{t("portalDeliveryFailures")}</DialogTitle>
          <DialogDescription className="sr-only">{t("portalDeliveryFailures")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 space-y-2">
            <Label htmlFor="portal-delivery-kind">{t("portalDeliveryMessage")}</Label>
            <select id="portal-delivery-kind" className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={kind} disabled={retry.isPending} onChange={(event) => { setKind(event.target.value as PortalDeliveryQuery["kind"]); setCursors([undefined]); setNotice(null); setError(null); }}>
              <option value="all">{t("portalDeliveryAll")}</option>
              <option value="identity">{t("portalDeliveryIdentity")}</option>
              <option value="resource">{t("portalDeliveryResource")}</option>
            </select>
          </div>
          <Button type="button" variant="outline" className="min-h-11" disabled={query.isFetching || retry.isPending} onClick={() => void query.refetch()}><RefreshCw aria-hidden="true" />{t("retry")}</Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {query.isLoading ? <div className="space-y-3" aria-busy="true">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-14 w-full" />)}</div> : query.isError ? (
            <div className="space-y-3 p-4"><p role="alert">{t("portalDeliveryLoadFailed")}</p><Button type="button" variant="outline" onClick={() => void query.refetch()}>{t("retry")}</Button></div>
          ) : !query.data?.items.length ? <p className="p-6 text-sm text-muted-foreground">{t("portalDeliveryEmpty")}</p> : (
            <table className="w-full min-w-[680px] text-sm">
              <thead><tr className="border-b text-left"><th scope="col" className="p-3">{t("portalDeliveryRecipient")}</th><th scope="col" className="p-3">{t("portalDeliveryMessage")}</th><th scope="col" className="p-3">{t("portalDeliveryDate")}</th><th scope="col" className="p-3"><span className="sr-only">{t("portalDeliveryRetry")}</span></th></tr></thead>
              <tbody>{query.data.items.map((row) => (
                <tr key={`${row.kind}:${row.id}`} className="border-b align-top">
                  <td className="max-w-64 break-words p-3"><p className="font-medium">{row.account.fullName}</p><p className="break-all">{row.account.login}</p><p className="break-all text-muted-foreground">{row.recipient}</p></td>
                  <td className="p-3"><p>{t(messageLabels[row.template])}</p><p className="mt-1 text-muted-foreground">{t(row.reason === "delivery_interrupted" ? "portalDeliveryInterrupted" : "portalDeliveryFailed")}</p></td>
                  <td className="whitespace-nowrap p-3">{format.format(new Date(row.createdAt))}</td>
                  <td className="p-3">{row.canRetry ? <Button type="button" variant="outline" className="min-h-11" disabled={retry.isPending || query.isFetching} aria-label={`${t("portalDeliveryRetry")}: ${row.account.fullName}`} onClick={() => { setError(null); setNotice(null); retry.mutate(row); }}>{t("portalDeliveryRetry")}</Button> : <p className="max-w-48 text-muted-foreground">{t("portalDeliveryRetryUnavailable")}</p>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
        {notice ? <p role="status" className="text-sm">{t(notice)}</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{t(error)}</p> : null}
        <DialogFooter className="flex flex-wrap items-center gap-2 sm:justify-between">
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" disabled={cursors.length <= 1 || query.isFetching || retry.isPending} onClick={() => setCursors((current) => current.slice(0,-1))}>{t("portalDeliveryPrevious")}</Button>
            <span className="text-sm">{t("portalDeliveryPage")} {cursors.length}</span>
            <Button type="button" variant="outline" disabled={!query.data?.hasMore || query.isFetching || retry.isPending} onClick={() => { const next = query.data?.nextCursor; if (next) setCursors((current) => [...current,next]); }}>{t("portalDeliveryNext")}</Button>
          </div>
          <Button type="button" disabled={retry.isPending} onClick={() => onOpenChange(false)}>{t("portalDeliveryClose")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export function PortalDeliveryFailuresButton({ enabled = true, canManageAccess = true }: { enabled?: boolean; canManageAccess?: boolean }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!enabled || !canManageAccess || !hasLeadershipAccess(user)) return null;
  return <><Button type="button" variant="outline" onClick={() => setOpen(true)}>{t("portalDeliveryFailures")}</Button><PortalDeliveryFailuresDialog open={open} onOpenChange={setOpen} enabled={enabled} canManageAccess={canManageAccess} /></>;
}
