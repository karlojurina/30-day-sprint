"use client";

import { useSyncExternalStore } from "react";

/**
 * SSR-safe media query hook. Returns false on the server (the
 * getServerSnapshot branch) and the real match on the client. Built
 * on useSyncExternalStore so we don't trip React's "setState during
 * effect" lint and so server / client snapshots stay coherent.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === "undefined") return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", notify);
      return () => mql.removeEventListener("change", notify);
    },
    () => {
      if (typeof window === "undefined") return false;
      return window.matchMedia(query).matches;
    },
    () => false,
  );
}

export const PHONE_QUERY = "(max-width: 768px)";

export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY);
}
