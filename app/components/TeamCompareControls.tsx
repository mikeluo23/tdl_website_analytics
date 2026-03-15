"use client";

import { useRouter } from "next/navigation";
import { withQuery } from "@/lib/divisions";

type TeamOption = {
  team_id: number;
  team_name: string;
  division_label?: string;
};

type TeamCompareControlsProps = {
  teams: TeamOption[];
  division?: string;
  year?: string;
  seasonTerm?: string;
  teamAId: number;
  teamBId: number;
};

export default function TeamCompareControls({
  teams,
  division,
  year,
  seasonTerm,
  teamAId,
  teamBId,
}: TeamCompareControlsProps) {
  const router = useRouter();

  const goToComparison = (nextA: number, nextB: number) => {
    router.push(
      withQuery("/teams/compare", {
        a: nextA,
        b: nextB,
        division: division || undefined,
        year: year || undefined,
        season_term: seasonTerm || undefined,
      }),
    );
  };

  return (
    <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
      <select
        className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-white"
        value={teamAId}
        onChange={(event) => goToComparison(Number(event.target.value), teamBId)}
      >
        {teams.map((team) => (
          <option key={`a-${team.team_id}`} value={team.team_id}>
            {team.team_name}
            {team.division_label ? ` | ${team.division_label}` : ""}
          </option>
        ))}
      </select>

      <select
        className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-white"
        value={teamBId}
        onChange={(event) => goToComparison(teamAId, Number(event.target.value))}
      >
        {teams.map((team) => (
          <option key={`b-${team.team_id}`} value={team.team_id}>
            {team.team_name}
            {team.division_label ? ` | ${team.division_label}` : ""}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="rounded-xl border border-zinc-700 bg-zinc-950/60 px-4 py-2 text-sm text-white transition hover:border-zinc-500 hover:bg-zinc-900"
        onClick={() => goToComparison(teamBId, teamAId)}
      >
        Swap
      </button>
    </div>
  );
}
