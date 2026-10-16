import { Home, BookOpen, CheckSquare, CalendarDays, TrendingUp, FolderHeart, Wallet, MessageCircle, Bell, User } from "lucide-react";
import type { PortalPermission } from "@shared/contracts/portal-identity";
import type { TranslationKey } from "@/lib/i18n";

export type NavItem = {
  route: string;
  key: TranslationKey;
  icon: typeof Home;
  permission?: PortalPermission;
  permissions?: PortalPermission[];
};
export const studentNav: NavItem[] = [
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
