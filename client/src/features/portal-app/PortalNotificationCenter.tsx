import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UnreadCountBadge } from "@/components/ux/UnreadCountBadge";
import { Sheet, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useTranslation } from "@/hooks/useTranslation";
import { PortalFormScope, portalGrantFingerprint, usePortal, usePortalFormScope } from "./context";
import { PortalSheetContent } from "./modal-content";
import { PortalNotifications } from "./notifications";
import { portalResourcesApi } from "./resources-api";

export function PortalNotificationCenter({ navigationKey }: { navigationKey: string }) {
  const { t } = useTranslation();
  const { account, allSubjects } = usePortal();
  const [open, setOpen] = useState(false);
  const scope = usePortalFormScope();
  useEffect(() => { setOpen(false); }, [navigationKey, account?.id]);
  const query = useQuery({
    queryKey: ["portal-account", account?.id, "notifications-badge", portalGrantFingerprint(allSubjects)],
    queryFn: ({ signal }) => portalResourcesApi.notifications(signal),
    enabled: Boolean(account),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  return (
    <>
      <Button size="icon" variant="ghost" className="relative rounded-full" aria-label={t("portalNotifications")} onClick={() => setOpen(true)}>
        <Bell className="h-5 w-5" />
        <UnreadCountBadge
          count={query.data?.unreadCount ?? 0}
          className="pointer-events-none absolute -right-0.5 -top-0.5"
          announce
          label={t("portalUnreadCount").replace("{count}", String(query.data?.unreadCount ?? 0))}
        />
      </Button>
      <Sheet open={open} onOpenChange={(next) => {
        if (next) setOpen(true);
        else scope.guarded(() => setOpen(false));
      }}>
        <PortalSheetContent side="right" aria-describedby={undefined} className="flex w-full max-w-none flex-col overflow-y-auto sm:max-w-xl">
          <SheetHeader><SheetTitle>{t("portalNotifications")}</SheetTitle></SheetHeader>
          {open && (
            <PortalFormScope id={scope.id}>
              <div className="space-y-4">
                <PortalNotifications key={account?.id} embedded onNavigate={() => setOpen(false)} />
              </div>
            </PortalFormScope>
          )}
        </PortalSheetContent>
      </Sheet>
    </>
  );
}
