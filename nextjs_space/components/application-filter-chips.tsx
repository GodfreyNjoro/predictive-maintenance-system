"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppWindow, Filter, Loader2 } from "lucide-react";
import type { OsType } from "@/app/(authenticated)/applications/types";
import { osBadgeColor, osLabel } from "@/app/(authenticated)/applications/types";

interface ChipApp {
  id: string;
  name: string;
  osType: OsType;
}

interface Props {
  /** Storage key for the current page so each page can persist its own selection. */
  storageKey?: string;
  /** Optional callback fired whenever the selection changes (string id or null). */
  onChange?: (applicationId: string | null) => void;
  /** Optional className for the wrapper. */
  className?: string;
}

/**
 * Cross-application filter chips. Reads/writes the `?applicationId=` query param
 * and notifies the parent so it can refetch scoped data.
 *
 * Renders an "All apps" chip plus one chip per Application. Chip color matches
 * the OS badge palette so it's visually consistent with /applications.
 */
export default function ApplicationFilterChips({ storageKey, onChange, className }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [apps, setApps] = useState<ChipApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedId = searchParams?.get("applicationId") ?? null;

  // Hydrate from URL → storage on mount; if URL has none, fall back to last-used.
  useEffect(() => {
    if (typeof window === "undefined" || !storageKey) return;
    const fromUrl = searchParams?.get("applicationId");
    if (fromUrl) {
      window.localStorage.setItem(storageKey, fromUrl);
      return;
    }
    const fromStorage = window.localStorage.getItem(storageKey);
    if (fromStorage) {
      // Push it into the URL so the page picks it up via searchParams + onChange.
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("applicationId", fromStorage);
      router.replace(`${pathname}?${params.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Notify parent whenever selectedId changes.
  useEffect(() => {
    onChange?.(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Fetch applications once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/applications");
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const list: ChipApp[] = (data?.applications ?? []).map((a: any) => ({
          id: a.id,
          name: a.name,
          osType: a.osType,
        }));
        setApps(list);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load applications");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setSelection = (appId: string | null) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (appId) {
      params.set("applicationId", appId);
      if (storageKey && typeof window !== "undefined") {
        window.localStorage.setItem(storageKey, appId);
      }
    } else {
      params.delete("applicationId");
      if (storageKey && typeof window !== "undefined") {
        window.localStorage.removeItem(storageKey);
      }
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  if (loading) {
    return (
      <div className={`flex items-center gap-2 text-sm text-slate-500 ${className ?? ""}`}>
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading applications…
      </div>
    );
  }

  if (error) {
    return (
      <div className={`text-sm text-red-600 ${className ?? ""}`}>
        Failed to load applications: {error}
      </div>
    );
  }

  if (apps.length === 0) {
    return (
      <div className={`text-sm text-slate-500 flex items-center gap-2 ${className ?? ""}`}>
        <AppWindow className="w-4 h-4" />
        No applications yet —{" "}
        <a href="/applications/new" className="text-blue-600 hover:underline">
          create one
        </a>{" "}
        to scope this view.
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
        <Filter className="w-3.5 h-3.5" />
        Filter by app
      </span>
      <button
        type="button"
        onClick={() => setSelection(null)}
        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
          selectedId === null
            ? "bg-slate-900 text-white border-slate-900"
            : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
        }`}
      >
        All apps
      </button>
      {apps.map((app) => {
        const isActive = selectedId === app.id;
        const dotColor = osBadgeColor(app.osType);
        return (
          <button
            key={app.id}
            type="button"
            onClick={() => setSelection(app.id)}
            title={`${app.name} • ${osLabel(app.osType)}`}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              isActive
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${dotColor}`} aria-hidden />
            {app.name}
          </button>
        );
      })}
    </div>
  );
}
