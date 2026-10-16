import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  CalendarDays,
  CheckSquare,
  Home,
  Bell,
  User,
  TrendingUp,
  FolderHeart,
  Wallet,
  MessageCircle,
  Menu,
  LogOut,
} from "lucide-react";
import type { PortalPermission } from "@shared/contracts/portal-identity";
import type { TranslationKey } from "@/lib/i18n";
import { useTranslation } from "@/hooks/useTranslation";
import { usePortalViewportNavigation } from "./usePortalViewportNavigation";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import Logo from "@/components/Logo";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ux/ThemeToggle";
import { ModulePage } from "@/components/ux/ModulePage";
import { UnreadCountBadge } from "@/components/ux/UnreadCountBadge";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { portalIdentityApi } from "./api";
import {
  usePortal,
  portalSessionKey,
  portalGrantFingerprint,
  PortalFormScope,
  usePortalFormScope,
} from "./context";
import { allowNavigation } from "@/lib/navigationGuard";
import { useQueryClient } from "@tanstack/react-query";
import {
  PortalDialogContent as DialogContent,
  PortalSheetContent as SheetContent,
  usePortalError,
} from "./ui";
import { PortalProfile } from "../portal-identity/PortalProfile";
import { PortalNotifications } from "./notifications";
import { portalResourcesApi } from "./resources-api";

type NavItem = {
  route: string;
  key: TranslationKey;
  icon: typeof Home;
  permission?: PortalPermission;
  permissions?: PortalPermission[];
};
const studentNav: NavItem[] = [
  {
    route: "/learn",
    key: "portalToday",
    icon: Home,
    permission: "learning.read",
  },
  {
    route: "/learn/courses",
    key: "portalCourses",
    icon: BookOpen,
    permission: "learning.read",
  },
  {
    route: "/learn/assignments",
    key: "portalAssignments",
    icon: CheckSquare,
    permission: "learning.read",
  },
  {
    route: "/learn/schedule",
    key: "portalSchedule",
    icon: CalendarDays,
    permissions: ["learning.read", "attendance.read"],
  },
  {
    route: "/learn/progress",
    key: "portalProgress",
    icon: TrendingUp,
    permissions: ["learning.read", "feedback.read"],
  },
  {
    route: "/learn/portfolio",
    key: "portalPortfolio",
    icon: FolderHeart,
    permissions: ["learning.read", "portfolio.approve"],
  },
  {
    route: "/learn/payments",
    key: "portalPayments",
    icon: Wallet,
    permission: "finance.read",
  },
  {
    route: "/learn/makeup",
    key: "portalMakeup",
    icon: BookOpen,
    permissions: ["learning.read", "attendance.read"],
  },
  {
    route: "/learn/attendance",
    key: "portalAttendance",
    icon: CalendarDays,
    permission: "attendance.read",
  },
  {
    route: "/learn/feedback",
    key: "portalFeedback",
    icon: MessageCircle,
    permission: "feedback.read",
  },
  {
    route: "/learn/help",
    key: "portalHelp",
    icon: MessageCircle,
    permission: "communication.create",
  },
  { route: "/learn/notifications", key: "portalNotifications", icon: Bell },
  { route: "/learn/profile", key: "portalProfile", icon: User },
];
export function PortalShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [path, navigate] = useLocation();
  const search = useSearch();
  const { subject, subjects, selectSubject, guarded, account } = usePortal();
  const client = useQueryClient();
  const errorMessage = usePortalError();
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRoute = path === "/learn/profile";
  const profileVisible = profileRoute || profileOpen;
  const profileScope = usePortalFormScope();
  const profileOpener = useRef<HTMLElement | null>(null);
  const profileButton = useRef<HTMLButtonElement | null>(null);
  const profileClosedForNavigation = useRef(false);
  const [menu, setMenu] = useState(false);
  const menuOpen = useRef(false);
  const menuClosedForNavigation = useRef(false);
  const changeMenu = (open: boolean) => {
    menuOpen.current = open;
    if (open) menuClosedForNavigation.current = false;
    setMenu(open);
  };
  const closeNavigation = useCallback(() => {
    if (!menuOpen.current) return;
    menuClosedForNavigation.current = true;
    menuOpen.current = false;
    setMenu(false);
  }, []);
  const profileLocation = useRef({ path, search });
  useEffect(() => {
    if (
      profileLocation.current.path !== path ||
      profileLocation.current.search !== search
    ) {
      profileClosedForNavigation.current = true;
      setProfileOpen(false);
    }
    profileLocation.current = { path, search };
  }, [path, search]);
  const mainRef = usePortalViewportNavigation({
    location: `${profileRoute ? "/learn" : path}${search ? `?${search}` : ""}`,
    scope: `portal:${account?.id}:${subject?.linkId ?? "family"}:${portalGrantFingerprint(subjects)}`,
    onNavigate: closeNavigation,
  });
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) closeNavigation();
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, [closeNavigation]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationScope = usePortalFormScope();
  const notifications = useQuery({
    queryKey: [
      "portal-account",
      account?.id,
      "notifications-badge",
      portalGrantFingerprint(subjects),
    ],
    queryFn: ({ signal }) => portalResourcesApi.notifications(signal),
    enabled: Boolean(account),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const personalSubjects = subjects.filter((item) => item.kind === "self");
  const representatives = subjects.filter(
    (item) => item.kind === "representative",
  );
  const parent =
    subject?.kind === "representative" ||
    (!subject && subjects.some((item) => item.kind === "representative"));
  const visible = studentNav
    .filter(
      (item) =>
        !(
          parent &&
          ["/learn/courses", "/learn/assignments"].includes(item.route)
        ),
    )
    .filter(
      (item) =>
        (parent && item.route === "/learn") ||
        (!item.permission && !item.permissions) ||
        Boolean(
          item.permission &&
            (subject
              ? subject.permissions.includes(item.permission)
              : subjects.some((link) =>
                  link.permissions.includes(item.permission!),
                )),
        ) ||
        Boolean(
          item.permissions?.some((permission) =>
            subject
              ? subject.permissions.includes(permission)
              : subjects.some((link) => link.permissions.includes(permission)),
          ),
        ),
    );
  const contextLabel = (
    <>
      {subject && (
        <Avatar aria-hidden="true" className="h-8 w-8">
          <AvatarFallback className="text-sm">
            {subject.studentName
              .trim()
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => Array.from(part)[0] ?? "")
              .join("")
              .toUpperCase()}
          </AvatarFallback>
        </Avatar>
      )}
      <span className="min-w-0 truncate">
        {subject?.studentName ?? t("portalFamily")}
      </span>
    </>
  );
  const logout = useMutation({
    mutationFn: portalIdentityApi.logout,
    onSuccess: () => {
      void client.cancelQueries({
        predicate: (query) => query.queryKey[0] !== portalSessionKey[0],
      });
      client.removeQueries({
        predicate: (query) => query.queryKey[0] !== portalSessionKey[0],
      });
      client.setQueryData(portalSessionKey, {
        account: null,
        subjects: [],
        csrfToken: "",
      });
      void client.invalidateQueries({ queryKey: portalSessionKey });
      allowNavigation(() => navigate("/login"));
    },
  });
  const go = (route: string) =>
    guarded(() => {
      if (route === path) changeMenu(false);
      navigate(route);
    });
  const openProfile = (opener: HTMLElement) => {
    profileClosedForNavigation.current = false;
    profileOpener.current = menuOpen.current ? profileButton.current : opener;
    changeMenu(false);
    setProfileOpen(true);
  };
  const closeProfile = () =>
    profileScope.guarded(() => {
      setProfileOpen(false);
      if (profileRoute)
        allowNavigation(() =>
          navigate(`/learn${search ? `?${search}` : ""}`, { replace: true }),
        );
    });
  function navigation(items: NavItem[]) {
    return items.map((item) => {
      const active =
        (item.route === "/learn/profile"
          ? profileVisible
          : path === item.route) ||
        (item.route !== "/learn" && path.startsWith(`${item.route}/`));
      return (
        <button
          key={item.route}
          type="button"
          className={cn(
            "sidebar-nav-item w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            active && "active",
          )}
          aria-current={
            active && item.route !== "/learn/profile" ? "page" : undefined
          }
          aria-haspopup={item.route === "/learn/profile" ? "dialog" : undefined}
          aria-expanded={
            item.route === "/learn/profile" ? profileVisible : undefined
          }
          onClick={(event) =>
            item.route === "/learn/profile"
              ? openProfile(event.currentTarget)
              : go(item.route)
          }
        >
          {active && (
            <span
              className="absolute inset-0 -z-10 rounded-lg bg-gradient-to-r from-primary-50 to-primary-100"
              aria-hidden="true"
            >
              <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary-600 shadow-[0_0_10px_0_var(--primary-glow)]" />
            </span>
          )}
          <item.icon className="sidebar-nav-item__icon" aria-hidden="true" />
          <span className="min-w-0 truncate">
            {t(
              item.route === "/learn" && parent
                ? "portalFamilyOverview"
                : item.route === "/learn/progress" && parent
                  ? "portalResults"
                  : item.key,
            )}
          </span>
          {active && (
            <span
              className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary-600"
              aria-hidden="true"
            />
          )}
        </button>
      );
    });
  }
  return (
    <div className="portal-ui portal-shell flex h-dvh overflow-hidden text-sm text-foreground">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border/70 bg-card/95 backdrop-blur-sm lg:flex print:hidden">
        <div className="flex shrink-0 items-center border-b border-border/70 px-3 py-4">
          <Logo size="sm" className="shrink-0" />
          <div className="ml-2 flex min-w-0 flex-col gap-0.5">
            <span className="whitespace-nowrap text-base font-semibold leading-tight tracking-tight">
              {t("platformName")}
            </span>
            <span className="text-[11px] leading-tight text-muted-foreground">
              {t("portalTitle")}
            </span>
          </div>
        </div>
        <nav
          aria-label={t("portalTitle")}
          className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-3 py-4"
        >
          {navigation(visible)}
        </nav>
        <div className="shrink-0 border-t border-border/70 p-3">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-muted-foreground"
            disabled={logout.isPending}
            onClick={() => guarded(() => logout.mutate())}
          >
            <LogOut className="h-5 w-5" aria-hidden="true" />
            {t("portalSignOut")}
          </Button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <main
          ref={mainRef}
          tabIndex={-1}
          className="portal-shell-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-clip overscroll-y-contain outline-none [scrollbar-gutter:stable]"
          data-app-scroll="document"
        >
          <header className="sticky top-0 z-30 shrink-0 border-b border-border/70 bg-background/85 px-3 py-2.5 backdrop-blur-xl sm:px-4 sm:py-3 lg:px-6 print:hidden">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2 sm:gap-x-3 lg:flex-nowrap">
              <Button
                variant="ghost"
                size="icon"
                className="-ml-2 rounded-lg text-muted-foreground lg:hidden"
                aria-label={t("openNavigation")}
                onClick={() => changeMenu(true)}
              >
                <Menu className="h-5 w-5" />
              </Button>
              <div className="order-2 flex w-full min-w-0 items-center gap-2 lg:order-none lg:w-auto lg:flex-1">
                {subjects.length > 1 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className="h-auto min-w-0 max-w-full justify-start gap-2 px-2 py-1.5"
                      >
                        {contextLabel}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      className="portal-ui max-h-[60dvh] overflow-auto"
                    >
                      {personalSubjects.length > 0 && (
                        <>
                          <DropdownMenuLabel>
                            {t("portalMyLearning")}
                          </DropdownMenuLabel>
                          {personalSubjects.map((item) => (
                            <DropdownMenuItem
                              key={item.linkId}
                              onSelect={() => selectSubject(item.linkId)}
                            >
                              {item.studentName}
                            </DropdownMenuItem>
                          ))}
                        </>
                      )}
                      {personalSubjects.length > 0 &&
                        representatives.length > 0 && <DropdownMenuSeparator />}
                      {representatives.length > 0 && (
                        <>
                          <DropdownMenuLabel>
                            {t("portalChildren")}
                          </DropdownMenuLabel>
                          {representatives.length > 1 && (
                            <DropdownMenuItem
                              onSelect={() => selectSubject(null)}
                            >
                              {t("portalFamilyOverview")}
                            </DropdownMenuItem>
                          )}
                          {representatives.map((item) => (
                            <DropdownMenuItem
                              key={item.linkId}
                              onSelect={() => selectSubject(item.linkId)}
                            >
                              {item.studentName}
                            </DropdownMenuItem>
                          ))}
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <div className="flex min-h-10 min-w-0 items-center gap-2">
                    {contextLabel}
                  </div>
                )}
              </div>
              <div className="portal-header-actions ml-auto flex shrink-0 items-center gap-1.5">
                <LanguageSwitcher className="rounded-full" />
                <ThemeToggle />
                <Button
                  size="icon"
                  variant="ghost"
                  className="relative rounded-full"
                  aria-label={t("portalNotifications")}
                  onClick={() => setNotificationsOpen(true)}
                >
                  <Bell className="h-5 w-5" />
                  <UnreadCountBadge
                    count={notifications.data?.unreadCount ?? 0}
                    className="pointer-events-none absolute -right-1.5 -top-2"
                    label={t("portalUnreadCount").replace(
                      "{count}",
                      String(notifications.data?.unreadCount ?? 0),
                    )}
                  />
                </Button>
                <Button
                  ref={profileButton}
                  size="icon"
                  variant="ghost"
                  className="rounded-full"
                  aria-label={t("portalProfile")}
                  aria-haspopup="dialog"
                  aria-expanded={profileVisible}
                  onClick={(event) => openProfile(event.currentTarget)}
                >
                  <User className="h-5 w-5" />
                </Button>
              </div>
            </div>
          </header>
          <ModulePage className="space-y-6 print:p-0">
            {logout.error && (
              <p role="alert" className="text-destructive">
                {errorMessage(logout.error)}
              </p>
            )}
            {children}
          </ModulePage>
        </main>
      </div>
      <Sheet open={menu} onOpenChange={changeMenu}>
        <SheetContent
          side="left"
          className="portal-ui flex w-72 flex-col gap-0 bg-card p-0 sm:w-72 sm:max-w-72"
          onCloseAutoFocus={(event) => {
            if (profileVisible) {
              event.preventDefault();
              return;
            }
            if (!menuClosedForNavigation.current) return;
            event.preventDefault();
            menuClosedForNavigation.current = false;
            mainRef.current?.focus({ preventScroll: true });
          }}
        >
          <SheetHeader className="shrink-0 border-b border-border/70 px-3 py-4 pr-12">
            <SheetTitle className="flex items-center gap-2 text-left text-base">
              <Logo size="sm" className="shrink-0" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-base font-semibold leading-tight tracking-tight">
                  {t("platformName")}
                </span>
                <span className="text-[11px] font-normal leading-tight text-muted-foreground">
                  {t("portalTitle")}
                </span>
              </span>
            </SheetTitle>
          </SheetHeader>
          <nav
            aria-label={t("portalTitle")}
            className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-3 py-4"
          >
            {navigation(visible)}
          </nav>
          <div className="shrink-0 space-y-3 border-t border-border/70 p-3">
            <p className="truncate px-3 text-sm font-medium">
              {account?.fullName}
            </p>
            <Button
              variant="ghost"
              className="min-h-11 w-full justify-start gap-3 text-muted-foreground"
              disabled={logout.isPending}
              onClick={() => guarded(() => logout.mutate())}
            >
              <LogOut className="h-5 w-5" aria-hidden="true" />
              {t("portalSignOut")}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      <Sheet
        open={notificationsOpen}
        onOpenChange={(open) => {
          if (open) setNotificationsOpen(true);
          else notificationScope.guarded(() => setNotificationsOpen(false));
        }}
      >
        <SheetContent
          side="right"
          className="portal-ui flex w-full max-w-none flex-col overflow-y-auto sm:max-w-xl"
        >
          <SheetHeader>
            <SheetTitle>{t("portalNotifications")}</SheetTitle>
          </SheetHeader>
          {notificationsOpen && (
            <PortalFormScope id={notificationScope.id}>
              <div className="space-y-4">
                <PortalNotifications
                  embedded
                  onNavigate={() => setNotificationsOpen(false)}
                />
              </div>
            </PortalFormScope>
          )}
        </SheetContent>
      </Sheet>
      <Dialog
        open={profileVisible}
        onOpenChange={(open) => {
          if (!open) closeProfile();
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className="flex max-h-[calc(100dvh-2rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (profileClosedForNavigation.current) {
              mainRef.current?.focus({ preventScroll: true });
              return;
            }
            const opener = profileOpener.current;
            if (opener?.isConnected && !opener.closest('[data-state="closed"]'))
              opener.focus({ preventScroll: true });
            else if (profileButton.current)
              profileButton.current.focus({ preventScroll: true });
            else mainRef.current?.focus({ preventScroll: true });
          }}
        >
          <DialogHeader className="shrink-0 border-b border-border/70 px-6 py-4 text-left">
            <DialogTitle>{t("portalProfile")}</DialogTitle>
          </DialogHeader>
          {profileVisible && (
            <PortalFormScope id={profileScope.id}>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 py-4">
                <PortalProfile
                  key={account?.id}
                  embedded
                  onClose={closeProfile}
                />
              </div>
            </PortalFormScope>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
