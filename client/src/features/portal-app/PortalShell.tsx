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
  Bell,
  User,
  Menu,
  LogOut,
  GraduationCap,
  Users,
  ChevronDown,
} from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import {
  learningModuleBase,
  learningModuleForSubject,
  toLearningModuleHref,
  type LearningModule,
} from "@shared/platform-routes";
import { AppShellFrame } from "@/components/ux/AppShellFrame";
import { AppSidebarFrame } from "@/components/ux/AppSidebarFrame";
import { setActivePlatformRealm } from "@/lib/platformSession";
import { usePortalLocation } from "./navigation";
import { studentNav, type NavItem } from "./module-navigation";
import { usePortalViewportNavigation } from "./usePortalViewportNavigation";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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

export function PortalShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [path, navigate] = usePortalLocation();
  const [actualPath] = useLocation();
  const search = useSearch();
  const {
    subject,
    subjects,
    allSubjects,
    learningModule,
    selectSubject,
    guarded,
    account,
  } = usePortal();
  const activeModule = learningModule ?? learningModuleForSubject(subject);
  const availableModules = (["student", "parent"] as const).filter((module) =>
    allSubjects.some((item) => (item.kind === "self") === (module === "student")),
  );
  const [collapsedModules, setCollapsedModules] = useState<
    Partial<Record<LearningModule, boolean>>
  >({});
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
  const profileLocation = useRef({ path: actualPath, search });
  useEffect(() => {
    if (
      profileLocation.current.path !== actualPath ||
      profileLocation.current.search !== search
    ) {
      profileClosedForNavigation.current = true;
      setProfileOpen(false);
    }
    profileLocation.current = { path: actualPath, search };
  }, [actualPath, search]);
  const mainRef = usePortalViewportNavigation({
    location: `${profileRoute ? (learningModule ? learningModuleBase(learningModule) : "/learn") : actualPath}${search ? `?${search}` : ""}`,
    scope: `portal:${account?.id}:${subject?.linkId ?? "family"}:${portalGrantFingerprint(subjects)}:${learningModule ?? "legacy"}`,
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
      portalGrantFingerprint(allSubjects),
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
  const visibleFor = (module: LearningModule) => {
    const links = module === activeModule && subject
      ? [subject]
      : allSubjects.filter((item) => (item.kind === "self") === (module === "student"));
    return studentNav.filter((item) => {
      if (
        module === "parent" &&
        ["/learn/courses", "/learn/assignments"].includes(item.route)
      ) return false;
      if (["/learn/profile", "/learn/notifications"].includes(item.route))
        return false;
      if (module === "parent" && item.route === "/learn") return true;
      if (!item.permission && !item.permissions) return true;
      return links.some((link) =>
        Boolean(item.permission && link.permissions.includes(item.permission)) ||
        item.permissions?.some((permission) => link.permissions.includes(permission)),
      );
    });
  };
  const accountNavigation = studentNav.filter((item) =>
    ["/learn/profile", "/learn/notifications"].includes(item.route),
  );
  const moduleLabel = (module: LearningModule) =>
    t(module === "student" ? "studentModule" : "parentModule");
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
      setActivePlatformRealm("signed-out");
      allowNavigation(() => navigate("/login"));
    },
  });
  const go = (route: string, module: LearningModule = activeModule) =>
    guarded(() => {
      if (route === path && module === activeModule) changeMenu(false);
      navigate(
        module === activeModule ? route : toLearningModuleHref(route, module),
      );
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
  function navigation(items: NavItem[], module: LearningModule = activeModule) {
    return items.map((item) => {
      const active = module === activeModule && (
        (item.route === "/learn/profile"
          ? profileVisible
          : path === item.route) ||
        (item.route !== "/learn" && path.startsWith(`${item.route}/`)));
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
              : go(item.route, module)
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
              item.route === "/learn" && module === "parent"
                ? "portalFamilyOverview"
                : item.route === "/learn/progress" && module === "parent"
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
  function sidebarNavigation() {
    return (
      <nav
        aria-label={t("platformName")}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-4"
      >
        {availableModules.map((module) => (
          <section key={module} className="mb-2" data-platform-module={module}>
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 transition-colors hover:text-slate-500"
              aria-expanded={!collapsedModules[module]}
              onClick={() =>
                setCollapsedModules((previous) => ({
                  ...previous,
                  [module]: !previous[module],
                }))
              }
            >
              <span>{moduleLabel(module)}</span>
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", collapsedModules[module] && "-rotate-90")}
                aria-hidden="true"
              />
            </button>
            {!collapsedModules[module] && (
              <div className="space-y-0.5">
                {navigation(visibleFor(module), module)}
              </div>
            )}
          </section>
        ))}
        <div className="mt-3 space-y-0.5 border-t border-border/70 pt-3">
          {navigation(accountNavigation)}
        </div>
      </nav>
    );
  }
  function sidebarFooter() {
    return (
      <>
        <div className="shrink-0 border-t border-border/70 px-4 py-2">
          <LanguageSwitcher />
        </div>
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
      </>
    );
  }
  return (
    <AppShellFrame
      className="portal-ui portal-shell text-sm text-foreground"
      mainRef={mainRef}
      mainClassName="portal-shell-scroll"
      navigation={(
        <AppSidebarFrame as="aside" className="hidden shrink-0 lg:flex print:hidden" footer={sidebarFooter()}>
          {sidebarNavigation()}
        </AppSidebarFrame>
      )}
      header={(
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
            <div className="order-2 flex w-full min-w-0 items-center gap-3 lg:order-none lg:w-auto lg:flex-1">
              <div className="hidden size-10 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary shadow-sm sm:flex" aria-hidden="true">
                {activeModule === "parent" ? <Users className="size-5" /> : <GraduationCap className="size-5" />}
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t("currentModule")}</p>
                <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">{moduleLabel(activeModule)}</h1>
              </div>
              <div className="ml-auto flex min-w-0 items-center gap-2">
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
            </div>
            <div className="portal-header-actions ml-auto flex shrink-0 items-center gap-1.5">
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
      )}
      overlays={(
        <>
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
              <SheetHeader className="sr-only"><SheetTitle>{t("platformName")}</SheetTitle></SheetHeader>
              <AppSidebarFrame className="w-full border-r-0 lg:w-full" footer={sidebarFooter()}>
                {sidebarNavigation()}
              </AppSidebarFrame>
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
        </>
      )}
    >
      <ModulePage className="space-y-6 print:p-0">
        {logout.error && (
          <p role="alert" className="text-destructive">
            {errorMessage(logout.error)}
          </p>
        )}
        {children}
      </ModulePage>
    </AppShellFrame>
  );
}
