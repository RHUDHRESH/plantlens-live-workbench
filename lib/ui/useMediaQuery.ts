"use client";

import { useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query. Returns `false` during server rendering and before
 * hydration so the markup is stable; the value updates after mount.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined") return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => (typeof window === "undefined" ? false : window.matchMedia(query).matches),
    () => false,
  );
}

/** Wall-clock ticker: re-renders every `intervalMs` while mounted. */
export function useWallClock(intervalMs = 1000): number {
  return useSyncExternalStore(
    (onChange) => {
      const id = setInterval(onChange, intervalMs);
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    () => 0,
  );
}
