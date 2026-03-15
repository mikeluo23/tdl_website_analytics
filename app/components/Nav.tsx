"use client";

import { startTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DivisionOption,
  normalizeDivision,
  withDivision,
  withQuery,
} from "@/lib/divisions";

const navLinkBase =
  "rounded-lg border border-transparent px-3 py-2 text-sm transition";
const navLinkInactive =
  "text-slate-300 hover:border-slate-600 hover:bg-slate-800/70 hover:text-white";
const navLinkActive =
  "border-slate-600 bg-slate-800 text-white shadow-[0_0_12px_rgba(56,189,248,0.28)]";

export default function Nav({ divisions }: { divisions: DivisionOption[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const division = normalizeDivision(searchParams.get("division"));

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  };

  const navHref = (href: string) => withDivision(href, division);

  const handleDivisionChange = (nextDivision: string) => {
    const nextHref = withQuery(pathname, {
      ...Object.fromEntries(searchParams.entries()),
      division: normalizeDivision(nextDivision) || undefined,
    });
    router.push(nextHref);
  };

  return (
    <div
      data-sticky-nav
      className="sticky top-0 z-50 border-b border-slate-700 bg-slate-900/80 backdrop-blur"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-3 sm:px-8">
        <Link prefetch href={navHref("/")} className="mr-2 font-semibold tracking-tight text-white">
          TDL Advanced Stats
        </Link>

        <Link
          prefetch
          href={navHref("/players")}
          className={`${navLinkBase} ${isActive("/players") ? navLinkActive : navLinkInactive}`}
        >
          Players
        </Link>

        <Link
          prefetch
          href={navHref("/leaderboard")}
          className={`${navLinkBase} ${isActive("/leaderboard") ? navLinkActive : navLinkInactive}`}
        >
          Leaderboard
        </Link>

        <Link
          prefetch
          href={navHref("/games")}
          className={`${navLinkBase} ${isActive("/games") ? navLinkActive : navLinkInactive}`}
        >
          Games
        </Link>

        <Link
          prefetch
          href={navHref("/teams")}
          className={`${navLinkBase} ${isActive("/teams") ? navLinkActive : navLinkInactive}`}
        >
          Teams
        </Link>

        <div className="flex-1" />

        {divisions.length > 0 ? (
          <select
            className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-zinc-600"
            value={division}
            onChange={(event) => handleDivisionChange(event.target.value)}
          >
            <option value="">All divisions</option>
            {divisions.map((option) => (
              <option key={option.division_id} value={option.division_id}>
                {option.division_label}
              </option>
            ))}
          </select>
        ) : null}

        <div className="hidden items-center gap-2 sm:flex">
          <input
            className="w-64 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-600"
            placeholder="Search players..."
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const q = (e.currentTarget.value || "").trim();
                const url = withQuery("/players", {
                  q: q || undefined,
                  division: division || undefined,
                });
                startTransition(() => {
                  router.push(url);
                });
              }
            }}
          />
        </div>
      </div>

      <div className="h-px bg-gradient-to-r from-transparent via-zinc-700/60 to-transparent" />
    </div>
  );
}
