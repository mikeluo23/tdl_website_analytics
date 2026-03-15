"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatFixed, formatPercent } from "@/lib/stats";
import { withStatsFilters } from "@/lib/divisions";

type Team = {
  team_id: number;
  team_name: string;
  division_label?: string;
  wins?: number;
  losses?: number;
  win_pct?: number;
  strength_of_schedule?: number;
  offensive_rating?: number;
  defensive_rating?: number;
  adjusted_net_rating?: number;
};

type SortKey =
  | "division_label"
  | "team_name"
  | "wins"
  | "losses"
  | "win_pct"
  | "strength_of_schedule"
  | "offensive_rating"
  | "defensive_rating"
  | "adjusted_net_rating";

function num(value: number | string | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function TeamStandingsTable({
  teams,
  division,
  year,
  seasonTerm,
}: {
  teams: Team[];
  division?: string;
  year?: string;
  seasonTerm?: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("wins");
  const [sortDirection, setSortDirection] = useState<"desc" | "asc">("desc");

  const sortedTeams = useMemo(() => {
    return [...teams].sort((a, b) => {
      if (sortKey === "team_name" || sortKey === "division_label") {
        const aValue = String(a[sortKey] ?? "");
        const bValue = String(b[sortKey] ?? "");
        return sortDirection === "desc"
          ? bValue.localeCompare(aValue)
          : aValue.localeCompare(bValue);
      }

      return sortDirection === "desc"
        ? num(b[sortKey]) - num(a[sortKey])
        : num(a[sortKey]) - num(b[sortKey]);
    });
  }, [sortDirection, sortKey, teams]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-400">
          Standings plus opponent-adjusted context across the available schedule.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-white"
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value as SortKey)}
          >
            <option value="wins">Sort: Wins</option>
            <option value="losses">Sort: Losses</option>
            <option value="win_pct">Sort: Win%</option>
            <option value="strength_of_schedule">Sort: SOS</option>
            <option value="offensive_rating">Sort: Off Rating</option>
            <option value="defensive_rating">Sort: Def Rating</option>
            <option value="adjusted_net_rating">Sort: Adj Net</option>
            <option value="team_name">Sort: Team Name</option>
            <option value="division_label">Sort: Division</option>
          </select>

          <div className="flex overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/40">
            <button
              className={`px-3 py-2 text-sm ${
                sortDirection === "desc"
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-300 hover:text-white"
              }`}
              onClick={() => setSortDirection("desc")}
            >
              Desc
            </button>
            <button
              className={`px-3 py-2 text-sm ${
                sortDirection === "asc"
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-300 hover:text-white"
              }`}
              onClick={() => setSortDirection("asc")}
            >
              Asc
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[28px] border border-sky-400/15 bg-slate-950/65 shadow-[0_20px_60px_rgba(8,15,29,0.4)] backdrop-blur">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-950 text-zinc-300">
            <tr>
              <th className="p-3 text-left font-medium">Team</th>
              <th className="p-3 text-left font-medium">Division</th>
              <th className="p-3 text-right font-medium">Record</th>
              <th className="p-3 text-right font-medium">Win%</th>
              <th className="p-3 text-right font-medium">SOS</th>
              <th className="p-3 text-right font-medium">Off</th>
              <th className="p-3 text-right font-medium">Def</th>
              <th className="p-3 text-right font-medium">Adj Net</th>
            </tr>
          </thead>
          <tbody>
            {sortedTeams.map((team) => (
              <tr
                key={team.team_id}
                className="border-t border-zinc-800 transition hover:bg-zinc-800/40"
              >
                <td className="p-3 font-medium">
                  <Link
                    href={withStatsFilters(`/teams/${team.team_id}`, {
                      division,
                      year,
                      seasonTerm,
                    })}
                    className="hover:underline"
                  >
                    {team.team_name}
                  </Link>
                </td>
                <td className="p-3 text-slate-300">{team.division_label ?? "-"}</td>
                <td className="p-3 text-right">
                  {team.wins ?? 0}-{team.losses ?? 0}
                </td>
                <td className="p-3 text-right">{formatPercent(team.win_pct ?? 0)}</td>
                <td className="p-3 text-right">{formatFixed(team.strength_of_schedule ?? 0)}</td>
                <td className="p-3 text-right">{formatFixed(team.offensive_rating ?? 0)}</td>
                <td className="p-3 text-right">{formatFixed(team.defensive_rating ?? 0)}</td>
                <td className="p-3 text-right">{formatFixed(team.adjusted_net_rating ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
