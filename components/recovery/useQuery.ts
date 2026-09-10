import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/** Read query params and patch them in place without adding history entries. */
export function useQuery() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const get = useCallback((key: string) => params.get(key), [params]);
  const patch = useCallback(
    (changes: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(changes)) {
        if (v === null || v === undefined || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  return { get, patch };
}
