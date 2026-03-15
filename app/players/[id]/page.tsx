import Link from "next/link";
import { apiGet } from "@/lib/api";
import AnalyticsMethodology from "@/app/components/AnalyticsMethodology";
import { normalizeDivision, withQuery, withStatsFilters } from "@/lib/divisions";
import {
  calcGameScore,
  calcMedian,
  calcEfgPercent,
  calcPointsPerShotAttempt,
  calcRatio,
  calcRate,
  calcShotDiet,
  calcStdDev,
  calcTsPercent,
  calcTurnoverRateProxy,
  calcTwoPointAttemptRate,
  calcTwoPointPercent,
  formatFixed,
  formatPercent,
} from "@/lib/stats";

type Player = {
  player_id: number;
  player_name: string;
  division_count?: number;
  division_labels?: string[];
};

type SeasonOptions = {
  years: string[];
  season_terms: string[];
  year_terms: { year: string; season_terms: string[] }[];
};

type PlayerGame = {
  game_id: number;
  game_key: string;
  division_id?: string;
  division_label?: string;
  game_url: string;
  game_date: string;
  team_name: string;
  opponent_team_name?: string;
  team_pts?: number;
  opponent_pts?: number;
  result?: "W" | "L" | "T";
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

function perGame(total: number, gamesPlayed: number) {
  return formatFixed(total / (gamesPlayed || 1));
}

function buildSplitSummary(games: (PlayerGame & { ts: number; gameScore: number })[]) {
  const totals = games.reduce(
    (acc, game) => {
      acc.pts += game.pts;
      acc.fgm += game.fgm;
      acc.fga += game.fga;
      acc.fta += game.fta;
      acc.gameScore += game.gameScore;
      return acc;
    },
    { pts: 0, fgm: 0, fga: 0, fta: 0, gameScore: 0 },
  );

  return {
    gp: games.length,
    ppg: games.length ? totals.pts / games.length : 0,
    ts: calcTsPercent(totals.pts, totals.fga, totals.fta),
    gameScore: games.length ? totals.gameScore / games.length : 0,
  };
}

export default async function PlayerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ division?: string; year?: string; season_term?: string }>;
}) {
  const { id } = await params;
  const { division, year = "", season_term: seasonTerm = "" } = await searchParams;
  const playerId = Number(id);
  const divisionId = normalizeDivision(division);

  if (!Number.isFinite(playerId)) {
    return (
      <main className="min-h-screen bg-black p-8 text-white">
        <div className="mx-auto max-w-4xl">
          <h1 className="mb-4 text-2xl font-bold">Invalid player id</h1>
          <p className="mb-6 text-zinc-400">
            Got: <code className="text-red-300">{id}</code>
          </p>
          <Link
            href={withStatsFilters("/players", { division: divisionId, year, seasonTerm })}
            className="text-zinc-300 hover:text-white"
          >
            {"<- Back to Players"}
          </Link>
        </div>
      </main>
    );
  }

  const [games, player, seasonOptions] = await Promise.all([
    apiGet<PlayerGame[]>(
      withQuery(`/players/${playerId}/games`, {
        division: divisionId || undefined,
        year: year || undefined,
        season_term: seasonTerm || undefined,
        limit: 500,
      }),
    ),
    apiGet<Player>(`/players/${playerId}`),
    apiGet<SeasonOptions>(withQuery("/season-options", { division: divisionId || undefined })),
  ]);

  const playerName = player.player_name ?? `Player #${playerId}`;
  const showDivisionColumn =
    !divisionId && new Set(games.map((game) => game.division_label).filter(Boolean)).size > 1;
  const seasonTermsForYear =
    seasonOptions.year_terms.find((option) => option.year === year)?.season_terms ??
    seasonOptions.season_terms;

  const totals = games.reduce(
    (acc, game) => {
      acc.pts += game.pts;
      acc.reb += game.reb;
      acc.ast += game.ast;
      acc.stl += game.stl;
      acc.blk += game.blk;
      acc.tov += game.tov;
      acc.fouls += game.fouls;
      acc.fgm += game.fgm;
      acc.fga += game.fga;
      acc.tpm += game.tpm;
      acc.tpa += game.tpa;
      acc.ftm += game.ftm;
      acc.fta += game.fta;
      return acc;
    },
    {
      pts: 0,
      reb: 0,
      ast: 0,
      stl: 0,
      blk: 0,
      tov: 0,
      fouls: 0,
      fgm: 0,
      fga: 0,
      tpm: 0,
      tpa: 0,
      ftm: 0,
      fta: 0,
    },
  );

  const gamesPlayed = games.length;
  const shotDiet = calcShotDiet(totals.fgm, totals.tpm, totals.ftm);
  const tsPct = calcTsPercent(totals.pts, totals.fga, totals.fta);
  const efgPct = calcEfgPercent(totals.fgm, totals.tpm, totals.fga);
  const astTo = calcRatio(totals.ast, totals.tov);
  const threePAR = calcRate(totals.tpa, totals.fga);
  const ftRate = calcRate(totals.fta, totals.fga);
  const stocksPerGame = (totals.stl + totals.blk) / (gamesPlayed || 1);
  const turnoverRate = calcTurnoverRateProxy(totals.tov, totals.fga, totals.fta);
  const pointsPerShot = calcPointsPerShotAttempt(totals.pts, totals.fga, totals.fta);
  const twoPointPct = calcTwoPointPercent(totals.fgm, totals.tpm, totals.fga, totals.tpa);
  const twoPointAttemptRate = calcTwoPointAttemptRate(totals.fga, totals.tpa);
  const averageGameScore =
    games.reduce(
      (sum, game) =>
        sum +
        calcGameScore(
          game.pts,
          game.fgm,
          game.fga,
          game.ftm,
          game.fta,
          game.reb,
          game.ast,
          game.stl,
          game.blk,
          game.fouls,
          game.tov,
        ),
      0,
    ) / (gamesPlayed || 1);
  const gameMetrics = games.map((game) => ({
    ...game,
    ts: calcTsPercent(game.pts, game.fga, game.fta),
    gameScore: calcGameScore(
      game.pts,
      game.fgm,
      game.fga,
      game.ftm,
      game.fta,
      game.reb,
      game.ast,
      game.stl,
      game.blk,
      game.fouls,
      game.tov,
    ),
  }));
  const pointsStdDev = calcStdDev(games.map((game) => game.pts));
  const tsStdDev = calcStdDev(gameMetrics.map((game) => game.ts));
  const pointsMedian = calcMedian(games.map((game) => game.pts));
  const winSplit = buildSplitSummary(gameMetrics.filter((game) => game.result === "W"));
  const lossSplit = buildSplitSummary(gameMetrics.filter((game) => game.result === "L"));

  return (
    <main className="min-h-screen bg-black p-8 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">{playerName}</h1>
            <p className="mt-1 text-sm text-zinc-400">
              {gamesPlayed} games logged
              {!divisionId && player?.division_labels?.length
                ? ` | ${player.division_labels.join(", ")}`
                : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <form className="flex flex-wrap items-center gap-2" action={`/players/${playerId}`} method="get">
              {divisionId ? <input type="hidden" name="division" value={divisionId} /> : null}
              <select
                name="year"
                defaultValue={year}
                className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-white"
              >
                <option value="">All Years</option>
                {seasonOptions.years.map((optionYear) => (
                  <option key={optionYear} value={optionYear}>
                    Year: {optionYear}
                  </option>
                ))}
              </select>
              <select
                name="season_term"
                defaultValue={seasonTerm}
                className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-white"
              >
                <option value="">All Seasons</option>
                {seasonTermsForYear.map((term) => (
                  <option key={term} value={term}>
                    Season: {term}
                  </option>
                ))}
              </select>
              <button className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-zinc-200">
                Apply
              </button>
              {year || seasonTerm ? (
                <Link
                  href={withStatsFilters(`/players/${playerId}`, { division: divisionId })}
                  className="text-sm text-zinc-400 hover:text-white"
                >
                  Clear
                </Link>
              ) : null}
            </form>
            <Link
              href={withStatsFilters("/players", { division: divisionId, year, seasonTerm })}
              className="text-zinc-400 hover:text-white"
            >
              {"<- Back to Players"}
            </Link>
          </div>
        </div>

        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">PPG</div>
            <div className="mt-2 text-2xl font-semibold">{perGame(totals.pts, gamesPlayed)}</div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">RPG</div>
            <div className="mt-2 text-2xl font-semibold">{perGame(totals.reb, gamesPlayed)}</div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">APG</div>
            <div className="mt-2 text-2xl font-semibold">{perGame(totals.ast, gamesPlayed)}</div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">TS%</div>
            <div className="mt-2 text-2xl font-semibold">{formatFixed(tsPct)}%</div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">eFG%</div>
            <div className="mt-2 text-2xl font-semibold">{formatFixed(efgPct)}%</div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">AST/TO</div>
            <div className="mt-2 text-2xl font-semibold">{formatFixed(astTo)}</div>
          </div>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">3PA Rate</div>
            <div className="mt-2 text-xl font-semibold">{formatFixed(threePAR)}%</div>
            <div className="mt-1 text-xs text-zinc-500">3PA / FGA</div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">FT Rate</div>
            <div className="mt-2 text-xl font-semibold">{formatFixed(ftRate)}%</div>
            <div className="mt-1 text-xs text-zinc-500">FTA / FGA</div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Stocks / Game</div>
            <div className="mt-2 text-xl font-semibold">{formatFixed(stocksPerGame)}</div>
            <div className="mt-1 text-xs text-zinc-500">Steals + blocks</div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">TOV Rate</div>
            <div className="mt-2 text-xl font-semibold">{formatFixed(turnoverRate)}%</div>
            <div className="mt-1 text-xs text-zinc-500">TOV / (FGA + 0.44 x FTA + TOV)</div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Pts / Shot Att</div>
            <div className="mt-2 text-xl font-semibold">{formatFixed(pointsPerShot)}</div>
            <div className="mt-1 text-xs text-zinc-500">PTS / (FGA + 0.44 x FTA)</div>
          </div>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">2P%</div>
            <div className="mt-2 text-xl font-semibold">{formatFixed(twoPointPct)}%</div>
            <div className="mt-1 text-xs text-zinc-500">2PM / 2PA</div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">2PA Rate</div>
            <div className="mt-2 text-xl font-semibold">{formatFixed(twoPointAttemptRate)}%</div>
            <div className="mt-1 text-xs text-zinc-500">2PA / FGA</div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Game Score / G</div>
            <div className="mt-2 text-xl font-semibold">{formatFixed(averageGameScore)}</div>
            <div className="mt-1 text-xs text-zinc-500">Box-score composite proxy</div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Points Median</div>
            <div className="mt-2 text-xl font-semibold">{formatFixed(pointsMedian)}</div>
            <div className="mt-1 text-xs text-zinc-500">Median points by game</div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Consistency</div>
            <div className="mt-2 text-xl font-semibold">{formatFixed(pointsStdDev)} PTS</div>
            <div className="mt-1 text-xs text-zinc-500">TS% std dev {formatFixed(tsStdDev)}</div>
          </div>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">2PT Share</div>
            <div className="mt-2 text-xl font-semibold">{formatFixed(shotDiet.twoPointShare)}%</div>
            <div className="mt-1 text-xs text-zinc-500">{shotDiet.twoPointPoints} points from twos</div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">3PT Share</div>
            <div className="mt-2 text-xl font-semibold">{formatFixed(shotDiet.threePointShare)}%</div>
            <div className="mt-1 text-xs text-zinc-500">{shotDiet.threePointPoints} points from threes</div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">FT Share</div>
            <div className="mt-2 text-xl font-semibold">{formatFixed(shotDiet.freeThrowShare)}%</div>
            <div className="mt-1 text-xs text-zinc-500">{shotDiet.freeThrowPoints} points from free throws</div>
          </div>
        </div>

        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-emerald-400/20 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Win Split</div>
            <div className="mt-2 text-2xl font-semibold">{winSplit.gp} games</div>
            <div className="mt-2 text-sm text-zinc-300">
              {formatFixed(winSplit.ppg)} PPG | {formatFixed(winSplit.ts)} TS% | {formatFixed(winSplit.gameScore)} Game Score
            </div>
          </div>
          <div className="rounded-xl border border-rose-400/20 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Loss Split</div>
            <div className="mt-2 text-2xl font-semibold">{lossSplit.gp} games</div>
            <div className="mt-2 text-sm text-zinc-300">
              {formatFixed(lossSplit.ppg)} PPG | {formatFixed(lossSplit.ts)} TS% | {formatFixed(lossSplit.gameScore)} Game Score
            </div>
          </div>
        </div>

        {games.length === 0 ? (
          <div className="text-zinc-400">No games found for this player.</div>
        ) : (
          <div className="space-y-6">
            <AnalyticsMethodology />
            <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900">
              <table className="min-w-full text-sm">
                <thead className="bg-zinc-950 text-zinc-300">
                  <tr>
                    {showDivisionColumn ? (
                      <th className="p-3 text-left font-medium">Division</th>
                    ) : null}
                    <th className="p-3 text-left font-medium">Result</th>
                    <th className="p-3 text-left font-medium">Date</th>
                    <th className="p-3 text-left font-medium">Matchup</th>
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
                    <th className="p-3 text-right font-medium">TS%</th>
                    <th className="p-3 text-right font-medium">Game Score</th>
                    <th className="p-3 text-left font-medium">Game</th>
                  </tr>
                </thead>
                <tbody>
                  {gameMetrics.map((game) => {
                    return (
                      <tr key={`${game.game_id}-${game.game_key}`} className="border-t border-zinc-800">
                        {showDivisionColumn ? (
                          <td className="p-3 whitespace-nowrap">{game.division_label || "-"}</td>
                        ) : null}
                        <td className="p-3 whitespace-nowrap">{game.result || "-"}</td>
                        <td className="p-3 whitespace-nowrap">{game.game_date || "-"}</td>
                        <td className="p-3 whitespace-nowrap">
                          {game.team_name}
                          {game.opponent_team_name ? ` vs ${game.opponent_team_name}` : ""}
                          {typeof game.team_pts === "number" && typeof game.opponent_pts === "number"
                            ? ` (${game.team_pts}-${game.opponent_pts})`
                            : ""}
                        </td>
                        <td className="p-3 text-right">{game.pts}</td>
                        <td className="p-3 text-right">{game.reb}</td>
                        <td className="p-3 text-right">{game.ast}</td>
                        <td className="p-3 text-right">{game.stl}</td>
                        <td className="p-3 text-right">{game.blk}</td>
                        <td className="p-3 text-right">{game.tov}</td>
                        <td className="p-3 text-right">{game.fouls}</td>
                        <td className="p-3 text-right">
                          {game.fgm}-{game.fga}
                        </td>
                        <td className="p-3 text-right">{formatPercent(game.fg_pct)}</td>
                        <td className="p-3 text-right">
                          {game.tpm}-{game.tpa}
                        </td>
                        <td className="p-3 text-right">{formatPercent(game.tp_pct)}</td>
                        <td className="p-3 text-right">
                          {game.ftm}-{game.fta}
                        </td>
                        <td className="p-3 text-right">{formatPercent(game.ft_pct)}</td>
                        <td className="p-3 text-right">{formatFixed(game.ts)}%</td>
                        <td className="p-3 text-right">{formatFixed(game.gameScore)}</td>
                        <td className="p-3 whitespace-nowrap">
                          <Link
                            className="text-blue-400 hover:underline"
                            href={withStatsFilters(`/games/${game.game_id}`, {
                              division: divisionId,
                              year,
                              seasonTerm,
                            })}
                          >
                            Box Score
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
