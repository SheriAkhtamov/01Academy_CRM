import {
  Home,
  BookOpen,
  CheckSquare,
  CalendarDays,
  TrendingUp,
  FolderHeart,
  Wallet,
  MessageCircle,
  Bell,
  User,
} from "lucide-react";
import type {
  PortalPermission,
  PortalSubjectDto,
} from "@shared/contracts/portal-identity";
import type { PortalNotificationDto } from "@shared/contracts/portal-resources";
import {
  learningModuleForSubject,
  learningModuleFromPath,
  learningSectionPath,
  toLearningModuleHref,
  learningSubjectHref,
  isLegacyLearningPath,
  type LearningModule,
} from "@shared/platform-routes";
import type { TranslationKey } from "@/lib/i18n";

export type NavItem = {
  route: string;
  key: TranslationKey;
  icon: typeof Home;
  permission?: PortalPermission;
  permissions?: PortalPermission[];
  modules?: readonly LearningModule[];
};
export const studentNav: NavItem[] = [
  {
    route: "/learn",
    key: "portalToday",
    icon: Home,
  },
  {
    route: "/learn/courses",
    key: "portalCourses",
    icon: BookOpen,
    permission: "learning.read",
    modules: ["student"],
  },
  {
    route: "/learn/assignments",
    key: "portalAssignments",
    icon: CheckSquare,
    permission: "learning.read",
    modules: ["student"],
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

const quizzesSection: NavItem = {
  route: "/learn/quizzes",
  key: "portalTests",
  icon: CheckSquare,
  permissions: ["learning.read", "feedback.read"],
};

export function portalSectionForPath(href: string): NavItem | null {
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  const pathname = href.split(/[?#]/, 1)[0];
  if (!learningModuleFromPath(pathname) && !isLegacyLearningPath(pathname))
    return null;
  const sectionPath = learningSectionPath(pathname);
  return (
    [...studentNav, quizzesSection].find(
      (item) =>
        sectionPath === item.route ||
        (item.route !== "/learn" && sectionPath.startsWith(`${item.route}/`)),
    ) ?? null
  );
}

/** Standalone sections share the same role and permission policy as navigation. */
export function canAccessPortalSection(
  href: string,
  module: LearningModule,
  subjects: readonly PortalSubjectDto[],
): boolean {
  const section = portalSectionForPath(href);
  if (!section || (section.modules && !section.modules.includes(module)))
    return false;
  const explicitModule = learningModuleFromPath(href);
  if (explicitModule && explicitModule !== module) return false;
  let eligible = subjects.filter(
    (subject) => (subject.kind === "self") === (module === "student"),
  );
  const address = href.split("#", 1)[0];
  const queryAt = address.indexOf("?");
  const params = new URLSearchParams(queryAt < 0 ? "" : address.slice(queryAt + 1));
  const requested = params.get("linkId");
  if (requested !== null) {
    if (!/^[1-9]\d*$/.test(requested)) return false;
    eligible = eligible.filter((subject) => subject.linkId === Number(requested));
    if (!eligible.length) return false;
  }
  if (["/learn/profile", "/learn/notifications"].includes(section.route)) return true;
  return eligible.some(
    (subject) =>
      (!section.permission && !section.permissions) ||
      Boolean(section.permission && subject.permissions.includes(section.permission)) ||
      Boolean(section.permissions?.some((permission) => subject.permissions.includes(permission))),
  );
}

/** Old notices retain their concrete child, with parent study links opening results. */
export function resolvePortalHref(
  href: string,
  allSubjects: readonly PortalSubjectDto[],
  currentModule: LearningModule,
): string | null {
  const section = portalSectionForPath(href);
  if (!section) return null;
  const address = href.split("#", 1)[0];
  const queryAt = address.indexOf("?");
  const params = new URLSearchParams(queryAt < 0 ? "" : address.slice(queryAt + 1));
  const requested = params.get("linkId");
  if (requested !== null && !/^[1-9]\d*$/.test(requested)) return null;
  const target = requested === null
    ? null
    : allSubjects.find((subject) => subject.linkId === Number(requested));
  if (requested !== null && !target) return null;
  const explicitModule = learningModuleFromPath(href);
  const module = explicitModule ?? (target ? learningModuleForSubject(target) : currentModule);
  if (target && learningModuleForSubject(target) !== module) return null;
  const subjects = target ? [target] : allSubjects;
  const canonical = toLearningModuleHref(href, module);
  if (canAccessPortalSection(canonical, module, subjects)) return canonical;
  if (
    module === "parent" &&
    target &&
    ["/learn/courses", "/learn/assignments"].includes(section.route)
  ) {
    const results = learningSubjectHref("/learn/progress", target);
    if (canAccessPortalSection(results, module, subjects)) return results;
  }
  return null;
}

/** The trusted notice target wins over a stale query, while its explicit role stays intact. */
export function resolvePortalNotificationHref(
  item: Pick<PortalNotificationDto, "href" | "linkId">,
  allSubjects: readonly PortalSubjectDto[],
  currentModule: LearningModule,
): string | null {
  if (!item.href) return null;
  if (item.linkId === null)
    return resolvePortalHref(item.href, allSubjects, currentModule);
  if (!allSubjects.some((subject) => subject.linkId === item.linkId)) return null;
  const hashAt = item.href.indexOf("#");
  const address = hashAt < 0 ? item.href : item.href.slice(0, hashAt);
  const fragment = hashAt < 0 ? "" : item.href.slice(hashAt);
  const queryAt = address.indexOf("?");
  const pathname = queryAt < 0 ? address : address.slice(0, queryAt);
  const params = new URLSearchParams(queryAt < 0 ? "" : address.slice(queryAt + 1));
  params.set("linkId", String(item.linkId));
  return resolvePortalHref(`${pathname}?${params}${fragment}`, allSubjects, currentModule);
}
