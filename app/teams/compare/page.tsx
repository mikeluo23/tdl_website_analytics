import Link from "next/link";
import TeamCompareControls from "@/app/components/TeamCompareControls";
import { apiGet } from "@/lib/api";
import { normalizeDivision, withQuery, withStatsFilters } from "@/lib/divisions";
import {
  calcEfgPercent,
  calcGameScore,
  calcPointsPerShotAttempt,
  calcRatio,
  calcRate,
  calcShotDiet,
  calcTsPercent,
  calcTurnoverRateProxy,
  calcTwoPointAttemptRate,
  calcTwoPointPercent,
  formatFixed,
  formatPercent,
} from "@/lib/stats";

type TeamOption = {
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

type TeamPlayer = {
  player_id: number;
  player_name: string;
  games_played: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  fouls: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
};

type RecentGame = {
  game_id: number;
  game_date: string;
  opponent_team_name: string;
  team_pts: number;
  opponent_pts: number;
  result: "W" | "L" | "T";
};

type TeamSummary = {
  team_id: number;
  division_id?: string;
  division_label?: string;
  team_name: string;
  games_played: number;
  wins: number;
  losses: number;
  win_pct?: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  fouls?: number;
  fgm: number;
  fga: number;
  fg_pct: number;
  tpm: number;
  tpa: number;
  tp_pct: number;
  ftm: number;
  fta: number;
  ft_pct: number;
  offensive_rating?: number;
  defensive_rating?: number;
  net_rating?: number;
  strength_of_schedule?: number;
  opponent_win_pct?: number;
  adjusted_offensive_rating?: number;
  adjusted_defensive_rating?: number;
  adjusted_net_rating?: number;
  players: TeamPlayer[];
  recent_games: RecentGame[];
};

function buildDerivedMetrics(summary: TeamSummary) {
  const ts = calcTsPercent(summary.pts, summary.fga, summary.fta);
  const efg = calcEfgPercent(summary.fgm, summary.tpm, summary.fga);
  const astTo = calcRatio(summary.ast, summary.tov);
  const threepar = calcRate(summary.tpa, summary.fga);
  const ftr = calcRate(summary.fta, summary.fga);
  const tovRate = calcTurnoverRateProxy(summary.tov, summary.fga, summary.fta);
  const ppsa = calcPointsPerShotAttempt(summary.pts, summary.fga, summary.fta);
  const twoPct = calcTwoPointPercent(summary.fgm, summary.tpm, summary.fga, summary.tpa);
  const twoPar = calcTwoPointAttemptRate(summary.fga, summary.tpa);
  const shotDiet = calcShotDiet(summary.fgm, summary.tpm, summary.ftm);
  const gameScore =
    calcGameScore(
      summary.pts,
      summary.fgm,
      summary.fga,
      summary.ftm,
      summary.fta,
      summary.reb,
      summary.ast,
      summary.stl,
      summary.blk,
      summary.fouls ?? 0,
      summary.tov,
    ) / (summary.games_played || 1);

  return {
    ts,
    efg,
    astTo,
    threepar,
    ftr,
    tovRate,
    ppsa,
    twoPct,
    twoPar,
    gameScore,
    shotDiet,
  };
}

function ComparisonRow({
  label,
  a,
  b,
  suffix = "",
}: {
  label: string;
  a: number;
  b: number;
  suffix?: string;
}) {
  const diff = a - b;

  return (
    <tr className="border-t border-zinc-800">
      <td className="p-3 font-medium text-zinc-200">{label}</td>
      <td className="p-3 text-right text-white">
        {formatFixed(a)}
        {suffix}
      </td>
      <td
        className={`p-3 text-right font-medium ${
          diff > 0 ? "text-emerald-300" : diff < 0 ? "text-rose-300" : "text-zinc-300"
        }`}
      >
        {diff >= 0 ? "+" : ""}
        {formatFixed(diff)}
        {suffix}
      </td>
      <td className="p-3 text-right text-white">
        {formatFixed(b)}
        {suffix}
      </td>
    </tr>
  );
}

function TeamPanel({
  summary,
}: {
  summary: TeamSummary;
}) {
  const metrics = buildDerivedMetrics(summary);
  const topScorer = [...summary.players].sort((a, b) => b.pts - a.pts)[0];

  return (
    <div className="rounded-[28px] border border-sky-400/15 bg-slate-950/65 p-5 shadow-[0_20px_60px_rgba(8,15,29,0.4)] backdrop-blur">
      <div className="mb-4">
        <h2 className="text-2xl font-semibold text-white">{summary.team_name}</h2>
        <p className="mt-1 text-sm text-zinc-400">
          {summary.division_label ? `${summary.division_label} | ` : ""}
          {summary.wins}-{summary.losses} | Win% {formatPercent(summary.win_pct ?? 0)}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">PPG</div>
          <div className="mt-2 text-2xl font-semibold text-white">
            {formatFixed(summary.pts / (summary.games_played || 1))}
          </div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">TS% / eFG%</div>
          <div className="mt-2 text-2xl font-semibold text-white">
            {formatFixed(metrics.ts)} / {formatFixed(metrics.efg)}
          </div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Adj Net</div>
          <div className="mt-2 text-2xl font-semibold text-white">
            {formatFixed(summary.adjusted_net_rating ?? 0)}
          </div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Top Scorer</div>
          <div className="mt-2 text-lg font-semibold text-white">
            {topScorer?.player_name ?? "-"}
          </div>
          <div className="mt-1 text-xs text-zinc-400">
            {topScorer
              ? `${formatFixed(topScorer.pts / (topScorer.games_played || 1))} PPG`
              : ""}
          </div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Shot Diet</div>
          <div className="mt-2 text-sm text-zinc-300">
            2PT {formatFixed(metrics.shotDiet.twoPointShare)}% | 3PT{" "}
            {formatFixed(metrics.shotDiet.threePointShare)}% | FT{" "}
            {formatFixed(metrics.shotDiet.freeThrowShare)}%
          </div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Recent Form</div>
          <div className="mt-2 text-sm text-zinc-300">
            {summary.recent_games
              .slice(0, 5)
              .map((game) => game.result)
              .join(" ")}
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function TeamComparePage({
  searchParams,
}: {
  searchParams: Promise<{ division?: string; year?: string; season_term?: string; a?: string; b?: string }>;
}) {
  const { division, year = "", season_term: seasonTerm = "", a, b } = await searchParams;
  const divisionId = normalizeDivision(division);
  const teams = await apiGet<TeamOption[]>(
    withQuery("/teams", {
      division: divisionId || undefined,
      year: year || undefined,
      season_term: seasonTerm || undefined,
    }),
  );

  if (teams.length === 0) {
    return (
      <main className="min-h-screen p-8">
        <div className="mx-auto max-w-6xl text-zinc-400">No teams found for this selection.</div>
      </main>
    );
  }

  const teamAId = Number(a) || teams[0]?.team_id;
  const fallbackB = teams.find((team) => team.team_id !== teamAId)?.team_id ?? teamAId;
  const teamBId = Number(b) || fallbackB;

  const [teamA, teamB] = await Promise.all([
    apiGet<TeamSummary>(
      withQuery(`/teams/${teamAId}/summary`, {
        division: divisionId || undefined,
        year: year || undefined,
        season_term: seasonTerm || undefined,
      }),
    ),
    apiGet<TeamSummary>(
      withQuery(`/teams/${teamBId}/summary`, {
        division: divisionId || undefined,
        year: year || undefined,
        season_term: seasonTerm || undefined,
      }),
    ),
  ]);

  const aMetrics = buildDerivedMetrics(teamA);
  const bMetrics = buildDerivedMetrics(teamB);

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Team Comparison</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Side-by-side advanced comparison for two teams.
            </p>
          </div>
          <Link
            href={withStatsFilters("/teams", { division: divisionId, year, seasonTerm })}
            className="text-zinc-400 hover:text-white"
          >
            {"<- Back to Teams"}
          </Link>
        </div>

        <div className="mb-6 rounded-[28px] border border-sky-400/15 bg-slate-950/65 p-5 shadow-[0_20px_60px_rgba(8,15,29,0.4)] backdrop-blur">
          <TeamCompareControls
            teams={teams}
            division={divisionId}
            year={year}
            seasonTerm={seasonTerm}
            teamAId={teamA.team_id}
            teamBId={teamB.team_id}
          />
        </div>

        <div className="mb-6 grid gap-6 xl:grid-cols-2">
          <TeamPanel summary={teamA} />
          <TeamPanel summary={teamB} />
        </div>

        <div className="overflow-x-auto rounded-[28px] border border-sky-400/15 bg-slate-950/65 shadow-[0_20px_60px_rgba(8,15,29,0.4)] backdrop-blur">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-950 text-zinc-300">
              <tr>
                <th className="p-3 text-left font-medium">Metric</th>
                <th className="p-3 text-right font-medium">{teamA.team_name}</th>
                <th className="p-3 text-right font-medium">Delta</th>
                <th className="p-3 text-right font-medium">{teamB.team_name}</th>
              </tr>
            </thead>
            <tbody>
              <ComparisonRow
                label="PPG"
                a={teamA.pts / (teamA.games_played || 1)}
                b={teamB.pts / (teamB.games_played || 1)}
              />
              <ComparisonRow label="TS%" a={aMetrics.ts} b={bMetrics.ts} suffix="%" />
              <ComparisonRow label="eFG%" a={aMetrics.efg} b={bMetrics.efg} suffix="%" />
              <ComparisonRow label="AST/TO" a={aMetrics.astTo} b={bMetrics.astTo} />
              <ComparisonRow label="3PA Rate" a={aMetrics.threepar} b={bMetrics.threepar} suffix="%" />
              <ComparisonRow label="FT Rate" a={aMetrics.ftr} b={bMetrics.ftr} suffix="%" />
              <ComparisonRow label="TOV Rate" a={aMetrics.tovRate} b={bMetrics.tovRate} suffix="%" />
              <ComparisonRow label="Pts / Shot Att" a={aMetrics.ppsa} b={bMetrics.ppsa} />
              <ComparisonRow label="2P%" a={aMetrics.twoPct} b={bMetrics.twoPct} suffix="%" />
              <ComparisonRow label="2PA Rate" a={aMetrics.twoPar} b={bMetrics.twoPar} suffix="%" />
              <ComparisonRow label="Off Rating" a={teamA.offensive_rating ?? 0} b={teamB.offensive_rating ?? 0} />
              <ComparisonRow label="Def Rating" a={teamA.defensive_rating ?? 0} b={teamB.defensive_rating ?? 0} />
              <ComparisonRow label="Adj Net" a={teamA.adjusted_net_rating ?? 0} b={teamB.adjusted_net_rating ?? 0} />
              <ComparisonRow label="SOS" a={teamA.strength_of_schedule ?? 0} b={teamB.strength_of_schedule ?? 0} />
              <ComparisonRow label="Opp Win%" a={teamA.opponent_win_pct ?? 0} b={teamB.opponent_win_pct ?? 0} suffix="%" />
              <ComparisonRow label="Game Score / G" a={aMetrics.gameScore} b={bMetrics.gameScore} />
              <ComparisonRow
                label="2PT Share"
                a={aMetrics.shotDiet.twoPointShare}
                b={bMetrics.shotDiet.twoPointShare}
                suffix="%"
              />
              <ComparisonRow
                label="3PT Share"
                a={aMetrics.shotDiet.threePointShare}
                b={bMetrics.shotDiet.threePointShare}
                suffix="%"
              />
              <ComparisonRow
                label="FT Share"
                a={aMetrics.shotDiet.freeThrowShare}
                b={bMetrics.shotDiet.freeThrowShare}
                suffix="%"
              />
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
