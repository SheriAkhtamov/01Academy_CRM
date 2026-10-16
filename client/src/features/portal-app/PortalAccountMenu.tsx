import { useRef, type MutableRefObject } from "react";
import { User } from "lucide-react";
import { UserAvatar } from "@/components/ux/UserAvatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "@/hooks/useTranslation";
import { usePortal } from "./context";

export function PortalAccountMenu({
  triggerRef,
  onProfile,
  onLogout,
  loggingOut,
}: {
  triggerRef: MutableRefObject<HTMLButtonElement | null>;
  onProfile: (opener: HTMLElement) => void;
  onLogout: () => void;
  loggingOut: boolean;
}) {
  const { t } = useTranslation();
  const { account } = usePortal();
  const handingOff = useRef(false);
  return (
    <DropdownMenu onOpenChange={(open) => { if (open) handingOff.current = false; }}>
      <DropdownMenuTrigger asChild>
        <Button ref={triggerRef} variant="ghost" size="icon" className="rounded-full" aria-label={t("currentAccount")}>
          <UserAvatar user={account} className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="portal-ui w-[min(16rem,calc(100vw-1.5rem))]"
        onCloseAutoFocus={(event) => { if (handingOff.current) event.preventDefault(); }}
      >
        <div className="px-3 py-2">
          <p className="text-xs text-muted-foreground">{t("currentAccount")}</p>
          <div className="mt-1 flex items-center gap-2">
            <UserAvatar user={account} className="h-7 w-7 shrink-0 rounded-full text-[10px]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{account?.fullName}</p>
              <p className="truncate text-xs text-muted-foreground">{account?.email ?? account?.login}</p>
            </div>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => {
          if (!triggerRef.current) return;
          handingOff.current = true;
          onProfile(triggerRef.current);
        }}>
          <User className="mr-2 h-4 w-4" />
          {t("portalProfile")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={loggingOut} onSelect={onLogout}>
          {t("portalSignOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
