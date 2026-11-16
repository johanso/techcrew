"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const REFRESH_MS = 5_000;

/**
 * While a SwitchAgent scan is pending, re-renders the page every few seconds (only while the tab is visible), so
 * the new score shows up as soon as the background job saves it. Open dialogs keep their local state.
 */
export function TrustScanWatcher({ pending }: { pending: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [pending, router]);
  return null;
}
