import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GraduationCap, Users } from "lucide-react";
import type { PortalSessionDto } from "@shared/contracts/portal-identity";
import {
  learningModuleBase,
  learningModuleForSubject,
  toLearningModuleHref,
  type LearningModule,
} from "@shared/platform-routes";
import { PlatformLayout } from "@/components/ux/PlatformLayout";
import { PlatformHeader } from "@/components/ux/PlatformHeader";
import { PlatformSidebar, type PlatformSidebarItem } from "@/components/ux/PlatformSidebar";
import { ModuleIdentityView } from "@/components/ux/ModuleIdentityView";
import { ModulePage } from "@/components/ux/ModulePage";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTranslation } from "@/hooks/useTranslation";
import { allowNavigation } from "@/lib/navigationGuard";
import { getActivePlatformRealm, setActivePlatformRealm } from "@/lib/platformSession";
import { cn } from "@/lib/utils";
import { usePortalLocation } from "./navigation";
import { canAccessPortalSection, studentNav, type NavItem } from "./module-navigation";
import { usePortalViewportNavigation } from "./usePortalViewportNavigation";
import { portalIdentityApi } from "./api";
import {
  usePortal,
  portalSessionKey,
  portalGrantFingerprint,
  PortalFormScope,
  usePortalFormScope,
} from "./context";
import { PortalDialogContent as DialogContent, usePortalError } from "./ui";
import { PortalProfile } from "../portal-identity/PortalProfile";
import { PortalAccountMenu } from "./PortalAccountMenu";
import { PortalContextControl } from "./PortalContextControl";
import { PortalNotificationCenter } from "./PortalNotificationCenter";
import { PortalCommandPalette } from "./PortalCommandPalette";
import { PortalMessagesSheet } from "./PortalMessagesSheet";
import { usePortalFormMounted } from "./usePortalFormMounted";

export function usesOperationalPortalLayout(path: string): boolean {
  return [
    "/learn/assignments", "/learn/schedule", "/learn/attendance",
    "/learn/payments", "/learn/makeup", "/learn/help", "/learn/notifications",
  ].some((section) => path === section || path.startsWith(`${section}/`));
}

export function PortalShell({ children }: { children: ReactNode }) {
  const mounted = usePortalFormMounted();
  const { t } = useTranslation();
  const [path, navigate] = usePortalLocation();
  const [actualPath] = useLocation();
  const search = useSearch();
  const { subject, subjects, allSubjects, learningModule, guarded, account } = usePortal();
  const activeModule = learningModule ?? learningModuleForSubject(subject);
  const availableModules = (["student", "parent"] as const).filter((module) =>
    allSubjects.some((item) => (item.kind === "self") === (module === "student")),
  );
  const [collapsedModules, setCollapsedModules] = useState<Record<string, boolean>>({});
  const [commandOpen, setCommandOpen] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRoute = path === "/learn/profile";
  const accountRoute = profileRoute || path === "/learn/notifications";
  const backgroundPath = accountRoute ? "/learn" : path;
  const profileVisible = profileRoute || profileOpen;
  const profileScope = usePortalFormScope();
  const profileOpener = useRef<HTMLElement | null>(null);
  const profileButton = useRef<HTMLButtonElement | null>(null);
  const profileClosedForNavigation = useRef(false);
  const profileLocation = useRef({ path: actualPath, search });
  const navigationKey = `${actualPath}${search ? `?${search}` : ""}`;
  useEffect(() => {
    if (profileLocation.current.path !== actualPath || profileLocation.current.search !== search) {
      profileClosedForNavigation.current = true;
      setProfileOpen(false);
    }
    profileLocation.current = { path: actualPath, search };
  }, [actualPath, search]);
  useEffect(() => {
    setCommandOpen(false);
  }, [actualPath, search, account?.id]);
  useEffect(() => { setMessagesOpen(false); }, [actualPath, account?.id]);
  // The shared layout owns the drawer; this hook retains per-subject page scroll.
  const onViewportNavigate = useCallback(() => {}, []);
  const mainRef = usePortalViewportNavigation({
    location: `${accountRoute ? (learningModule ? learningModuleBase(learningModule) : "/learn") : actualPath}${search ? `?${search}` : ""}`,
    scope: `portal:${account?.id}:${subject?.linkId ?? "family"}:${portalGrantFingerprint(subjects)}:${learningModule ?? "legacy"}`,
    onNavigate: onViewportNavigate,
  });
  const client = useQueryClient();
  const errorMessage = usePortalError();
  const logout = useMutation({
    mutationFn: portalIdentityApi.logout,
    onMutate: () => account?.id,
    onSuccess: (_data, _variables, originAccount) => {
      const realm = getActivePlatformRealm();
      if (!mounted.current || (realm !== null && realm !== "portal")) return;
      if (client.getQueryData<PortalSessionDto>(portalSessionKey)?.account?.id !== originAccount) return;
      void client.cancelQueries({ predicate: (query) => query.queryKey[0] !== portalSessionKey[0] });
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== portalSessionKey[0] });
      client.setQueryData(portalSessionKey, { account: null, subjects: [], csrfToken: "" });
      void client.invalidateQueries({ queryKey: portalSessionKey });
      setActivePlatformRealm("signed-out");
      allowNavigation(() => navigate("/login"));
    },
  });
  const moduleLabel = (module: LearningModule) => t(module === "student" ? "studentModule" : "parentModule");
  const openProfile = (opener: HTMLElement) => {
    profileClosedForNavigation.current = false;
    profileOpener.current = opener;
    setProfileOpen(true);
  };
  const closeProfile = () => profileScope.guarded(() => {
    setProfileOpen(false);
    if (profileRoute)
      allowNavigation(() => navigate(`/learn${search ? `?${search}` : ""}`, { replace: true }));
  });
  const visibleFor = (module: LearningModule) => {
    const links = module === activeModule && subject
      ? [subject]
      : allSubjects.filter((item) => (item.kind === "self") === (module === "student"));
    return studentNav.filter((item) =>
      !["/learn/profile", "/learn/notifications"].includes(item.route) &&
      canAccessPortalSection(item.route, module, links),
    );
  };
  const navigationItem = (
    item: NavItem,
    module: LearningModule,
    sidebar: { onClose: () => void; isOpen: boolean },
  ): PlatformSidebarItem => ({
    id: `${module}:${item.route}`,
    label: t(item.route === "/learn" && module === "parent" ? "portalFamilyOverview"
      : item.route === "/learn/progress" && module === "parent" ? "portalResults" : item.key),
    href: toLearningModuleHref(item.route, module),
    icon: item.icon,
    active: module === activeModule && (backgroundPath === item.route
      || (item.route !== "/learn" && backgroundPath.startsWith(`${item.route}/`))),
    onSelect: (event) => {
      event.preventDefault();
      guarded(() => {
        sidebar.onClose();
        navigate(module === activeModule ? item.route : toLearningModuleHref(item.route, module));
      });
    },
  });
  return (
    <PlatformLayout
      className="portal-ui portal-shell text-foreground"
      mainRef={mainRef}
      mainClassName="portal-shell-scroll"
      navigationKey={navigationKey}
      renderSidebar={(sidebar) => (
        <PlatformSidebar
          {...sidebar}
          navigationKey={navigationKey}
          navLabel={t("platformName")}
          sections={availableModules.map((module) => ({
            id: module,
            label: moduleLabel(module),
            items: visibleFor(module).map((item) => navigationItem(item, module, sidebar)),
          }))}
          collapsedSections={collapsedModules}
          onSectionToggle={(id) => setCollapsedModules((previous) => ({ ...previous, [id]: !previous[id] }))}
        />
      )}
      renderHeader={({ onMenuToggle, menuButtonRef }) => (
        <PlatformHeader
          onMenuToggle={onMenuToggle}
          menuButtonRef={menuButtonRef}
          identity={<ModuleIdentityView title={moduleLabel(activeModule)} icon={activeModule === "parent" ? Users : GraduationCap} />}
          onSearch={() => setCommandOpen(true)}
          onMessages={() => setMessagesOpen(true)}
          unreadMessageCount={0}
          notifications={<PortalNotificationCenter navigationKey={navigationKey} />}
          accountMenu={<PortalAccountMenu triggerRef={profileButton} onProfile={openProfile}
            loggingOut={logout.isPending} onLogout={() => guarded(() => logout.mutate())} />}
        />
      )}
      overlays={(
        <>
          <PortalCommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
          <PortalMessagesSheet open={messagesOpen} onOpenChange={setMessagesOpen} />
          <Dialog open={profileVisible} onOpenChange={(open) => { if (!open) closeProfile(); }}>
            <DialogContent
              aria-describedby={undefined}
              className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (profileClosedForNavigation.current) {
                  mainRef.current?.focus({ preventScroll: true });
                  return;
                }
                const opener = profileOpener.current;
                if (opener?.isConnected && !opener.closest('[role="dialog"][data-state="closed"]'))
                  opener.focus({ preventScroll: true });
                else if (profileButton.current) profileButton.current.focus({ preventScroll: true });
                else mainRef.current?.focus({ preventScroll: true });
              }}
            >
              <DialogHeader className="shrink-0 border-b border-border/70 px-6 py-4 text-left">
                <DialogTitle>{t("portalProfile")}</DialogTitle>
              </DialogHeader>
              {profileVisible && (
                <PortalFormScope id={profileScope.id}>
                  <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 py-4">
                    <PortalProfile key={account?.id} embedded onClose={closeProfile} />
                  </div>
                </PortalFormScope>
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
    >
      <ModulePage className={cn("space-y-6 print:p-0", usesOperationalPortalLayout(backgroundPath)
        && "space-y-4 sm:p-5 lg:p-6 [&_[data-page-header]]:mb-4")}>
        {logout.error && <p role="alert" className="text-destructive">{errorMessage(logout.error)}</p>}
        <PortalContextControl />
        {children}
      </ModulePage>
    </PlatformLayout>
  );
}
