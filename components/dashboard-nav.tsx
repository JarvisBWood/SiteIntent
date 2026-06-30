import type { LucideIcon } from "lucide-react";
import { BarChart3, LayoutDashboard, MessageSquareQuote, ShieldCheck } from "lucide-react";

export type DashboardNavItem = {
  title: string;
  href: string;
  description: string;
  icon: LucideIcon;
};

export type DashboardNavGroup = {
  label: string;
  items: DashboardNavItem[];
};

export const DASHBOARD_NAV_GROUPS: DashboardNavGroup[] = [
  {
    label: "Workspace",
    items: [
      {
        title: "Dashboard",
        href: "/dashboard",
        description: "Your website's AI Search Score and score breakdown.",
        icon: LayoutDashboard
      },
      {
        title: "Competitors",
        href: "/competitors",
        description: "Top 5 competitor results and comparison context.",
        icon: BarChart3
      },
      {
        title: "Actions",
        href: "/recommendations",
        description: "Concrete changes, removals, and additions.",
        icon: MessageSquareQuote
      }
    ]
  },
  {
    label: "System",
    items: [
      {
        title: "Settings",
        href: "/settings",
        description: "Workspace defaults and model providers.",
        icon: ShieldCheck
      }
    ]
  }
];

export function isDashboardEntryActive(pathname: string, item: DashboardNavItem) {
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function getDashboardActiveTitle(pathname: string) {
  for (const group of DASHBOARD_NAV_GROUPS) {
    for (const item of group.items) {
      if (isDashboardEntryActive(pathname, item)) {
        return item.title;
      }
    }
  }

  return "Dashboard";
}
