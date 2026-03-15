import Link from "next/link";
import { apiGet } from "@/lib/api";
import { normalizeDivision, withStatsFilters } from "@/lib/divisions";

type GameRow = {
  game_id: number;
  game_key: string;
  division_id?: string;
  division_label?: string;
  game_url: string;
  game_date: string;
  team1_name: string;
  team1_pts?: number;
  team2_name: string;
  team2_pts?: number;
  season?: string;
  venue?: string;
  league?: string;
};

type BoxRow = {
  team_name: string;
  player_name: string;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  fouls: number;
  fgm: number;
  fga: number;
  fg_pct: number;
  tpm: number;
  tpa: number;
  tp_pct: number;
  ftm: number;
  fta: number;
  ft_pct: number;
};

function pct(value: number) {
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function sum(rows: BoxRow[], key: keyof BoxRow) {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

function buildTeamTotals(rows: BoxRow[]) {
  const fgm = sum(rows, "fgm");
  const fga = sum(rows, "fga");
  const tpm = sum(rows, "tpm");
  const tpa = sum(rows, "tpa");
  const ftm = sum(rows, "ftm");
  const fta = sum(rows, "fta");

  return {
    pts: sum(rows, "pts"),
    reb: sum(rows, "reb"),
    ast: sum(rows, "ast"),
    stl: sum(rows, "stl"),
    blk: sum(rows, "blk"),
    tov: sum(rows, "tov"),
    fouls: sum(rows, "fouls"),
    fgm,
    fga,
    fg_pct: fga ? fgm / fga : 0,
    tpm,
    tpa,
    tp_pct: tpa ? tpm / tpa : 0,
    ftm,
    fta,
    ft_pct: fta ? ftm / fta : 0,
  };
}

function TeamTable({ teamName, rows }: { teamName: string; rows: BoxRow[] }) {
  const totals = buildTeamTotals(rows);

  return (
    <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900">
      <div className="border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">{teamName}</h2>
          <div className="text-sm text-zinc-400">
            {totals.pts} PTS | {totals.reb} REB | {totals.ast} AST
          </div>
        </div>
      </div>
      <table className="min-w-full text-sm">
        <thead className="bg-zinc-950 text-zinc-300">
          <tr>
            <th className="p-3 text-left font-medium">Player</th>
            <th className="p-3 text-right font-medium">PTS</th>
            <th className="p-3 text-right font-medium">REB</th>
            <th className="p-3 text-right font-medium">AST</th>
            <th className="p-3 text-right font-medium">STL</th>
            <th className="p-3 text-right font-medium">BLK</th>
            <th className="p-3 text-right font-medium">TOV</th>
            <th className="p-3 text-right font-medium">PF</th>
            <th className="p-3 text-right font-medium">FG</th>
            <th className="p-3 text-right font-medium">FG%</th>
            <th className="p-3 text-right font-medium">3PT</th>
            <th className="p-3 text-right font-medium">3P%</th>
            <th className="p-3 text-right font-medium">FT</th>
            <th className="p-3 text-right font-medium">FT%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${teamName}-${row.player_name}`} className="border-t border-zinc-800">
              <td className="p-3 whitespace-nowrap font-medium">{row.player_name}</td>
              <td className="p-3 text-right">{row.pts}</td>
              <td className="p-3 text-right">{row.reb}</td>
              <td className="p-3 text-right">{row.ast}</td>
              <td className="p-3 text-right">{row.stl}</td>
              <td className="p-3 text-right">{row.blk}</td>
              <td className="p-3 text-right">{row.tov}</td>
              <td className="p-3 text-right">{row.fouls}</td>
              <td className="p-3 text-right">{row.fgm}-{row.fga}</td>
              <td className="p-3 text-right">{pct(row.fg_pct)}</td>
              <td className="p-3 text-right">{row.tpm}-{row.tpa}</td>
              <td className="p-3 text-right">{pct(row.tp_pct)}</td>
              <td className="p-3 text-right">{row.ftm}-{row.fta}</td>
              <td className="p-3 text-right">{pct(row.ft_pct)}</td>
            </tr>
          ))}
          <tr className="border-t border-zinc-700 bg-zinc-950/60 font-medium text-zinc-200">
            <td className="p-3">Team Totals</td>
            <td className="p-3 text-right">{totals.pts}</td>
            <td className="p-3 text-right">{totals.reb}</td>
            <td className="p-3 text-right">{totals.ast}</td>
            <td className="p-3 text-right">{totals.stl}</td>
            <td className="p-3 text-right">{totals.blk}</td>
            <td className="p-3 text-right">{totals.tov}</td>
            <td className="p-3 text-right">{totals.fouls}</td>
            <td className="p-3 text-right">{totals.fgm}-{totals.fga}</td>
            <td className="p-3 text-right">{pct(totals.fg_pct)}</td>
            <td className="p-3 text-right">{totals.tpm}-{totals.tpa}</td>
            <td className="p-3 text-right">{pct(totals.tp_pct)}</td>
            <td className="p-3 text-right">{totals.ftm}-{totals.fta}</td>
            <td className="p-3 text-right">{pct(totals.ft_pct)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default async function GameBoxscorePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ division?: string; year?: string; season_term?: string }>;
}) {
  const { id } = await params;
  const { division, year = "", season_term: seasonTerm = "" } = await searchParams;
  const gameId = Number(id);
  const divisionId = normalizeDivision(division);

  if (!Number.isFinite(gameId)) {
    return (
      <main className="min-h-screen p-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="mb-4 text-2xl font-bold">Invalid game id</h1>
          <p className="mb-6 text-zinc-400">
            Got: <code className="text-red-300">{id}</code>
          </p>
          <Link
            href={withStatsFilters("/games", { division: divisionId, year, seasonTerm })}
            className="text-zinc-300 hover:text-white"
          >
            {"<- Back to Games"}
          </Link>
        </div>
      </main>
    );
  }

  const [rows, game] = await Promise.all([
    apiGet<BoxRow[]>(`/games/${gameId}/boxscore`),
    apiGet<GameRow>(`/games/${gameId}`),
  ]);
  const grouped = rows.reduce<Record<string, BoxRow[]>>((acc, row) => {
    if (!acc[row.team_name]) acc[row.team_name] = [];
    acc[row.team_name].push(row);
    return acc;
  }, {});
  const orderedTeamNames = game
    ? [game.team1_name, game.team2_name].filter(Boolean)
    : Object.keys(grouped);

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">
              {game ? `${game.team1_name} vs ${game.team2_name}` : `Game #${gameId}`}
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              {game?.game_date || "Unknown date"}
              {game?.division_label ? ` | ${game.division_label}` : ""}
              {game?.league ? ` | ${game.league}` : ""}
              {game?.venue ? ` | ${game.venue}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {game?.game_url ? (
              <a
                className="text-sm text-zinc-400 hover:text-white"
                href={game.game_url}
                target="_blank"
                rel="noreferrer"
              >
                Source
              </a>
            ) : null}
            <Link
              href={withStatsFilters("/games", { division: divisionId, year, seasonTerm })}
              className="text-zinc-400 hover:text-white"
            >
              {"<- Back to Games"}
            </Link>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="text-zinc-400">No box score rows returned.</div>
        ) : (
          <>
            {game ? (
              <div className="mb-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
                  <div className="text-sm uppercase tracking-wide text-zinc-500">Final</div>
                  <div className="mt-3 flex items-center justify-between gap-4 text-lg">
                    <span className="font-medium">{game.team1_name}</span>
                    <span className="font-mono text-2xl">{game.team1_pts ?? "-"}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-4 text-lg">
                    <span className="font-medium">{game.team2_name}</span>
                    <span className="font-mono text-2xl">{game.team2_pts ?? "-"}</span>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="grid gap-6">
              {orderedTeamNames.map((teamName) =>
                grouped[teamName] ? (
                  <TeamTable key={teamName} teamName={teamName} rows={grouped[teamName]} />
                ) : null,
              )}
              {Object.entries(grouped)
                .filter(([teamName]) => !orderedTeamNames.includes(teamName))
                .map(([teamName, teamRows]) => (
                  <TeamTable key={teamName} teamName={teamName} rows={teamRows} />
                ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
