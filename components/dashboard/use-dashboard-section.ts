"use client";

import { usePathname } from "next/navigation";

import { DASHBOARD_NAV, SETTINGS_SECTION } from "@/components/dashboard/nav";

/** The section the current URL is in ("" segment = Overview). */
export function useDashboardSection() {
  // /dashboard/<id>/<segment>/…
  const segment = usePathname().split("/")[3] ?? "";
  return [...DASHBOARD_NAV, SETTINGS_SECTION].find((section) => section.segment === segment) ?? DASHBOARD_NAV[0]!;
}
