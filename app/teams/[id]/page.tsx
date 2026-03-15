import Link from "next/link";
import AnalyticsMethodology from "@/app/components/AnalyticsMethodology";
import TeamAnalytics from "@/app/components/TeamAnalytics";
import { apiGet } from "@/lib/api";
import { normalizeDivision, withQuery, withStatsFilters } from "@/lib/divisions";
import {
  calcGameScore,
  calcEfgPercent,
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
  fg_pct: number;
  tpm: number;
  tpa: number;
  tp_pct: number;
  ftm: number;
  fta: number;
  ft_pct: number;
};

type RecentGame = {
  game_id: number;
  game_key: string;
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

type SeasonOptions = {
  years: string[];
  season_terms: string[];
  year_terms: { year: string; season_terms: string[] }[];
};

function perGame(total: number, gamesPlayed: number) {
  return formatFixed(total / (gamesPlayed || 1));
}

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ division?: string; year?: string; season_term?: string }>;
}) {
  const { id } = await params;
  const { division, year = "", season_term: seasonTerm = "" } = await searchParams;
  const teamId = Number(id);
  const divisionId = normalizeDivision(division);

  if (!Number.isFinite(teamId)) {
    return (
      <main className="min-h-screen p-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="mb-4 text-2xl font-bold">Invalid team id</h1>
          <Link
            href={withStatsFilters("/teams", { division: divisionId, year, seasonTerm })}
            className="text-zinc-300 hover:text-white"
          >
            {"<- Back to Teams"}
          </Link>
        </div>
      </main>
    );
  }

  const [summary, seasonOptions] = await Promise.all([
    apiGet<TeamSummary>(
      withQuery(`/teams/${teamId}/summary`, {
        division: divisionId || undefined,
        year: year || undefined,
        season_term: seasonTerm || undefined,
      }),
    ),
    apiGet<SeasonOptions>(withQuery("/season-options", { division: divisionId || undefined })),
  ]);
  const seasonTermsForYear =
    seasonOptions.year_terms.find((option) => option.year === year)?.season_terms ??
    seasonOptions.season_terms;
  const tsPct = calcTsPercent(summary.pts, summary.fga, summary.fta);
  const efgPct = calcEfgPercent(summary.fgm, summary.tpm, summary.fga);
  const astTo = calcRatio(summary.ast, summary.tov);
  const threePAR = calcRate(summary.tpa, summary.fga);
  const ftRate = calcRate(summary.fta, summary.fga);
  const turnoverRate = calcTurnoverRateProxy(summary.tov, summary.fga, summary.fta);
  const pointsPerShot = calcPointsPerShotAttempt(summary.pts, summary.fga, summary.fta);
  const twoPointPct = calcTwoPointPercent(summary.fgm, summary.tpm, summary.fga, summary.tpa);
  const twoPointAttemptRate = calcTwoPointAttemptRate(summary.fga, summary.tpa);
  const shotDiet = calcShotDiet(summary.fgm, summary.tpm, summary.ftm);
  const teamGameScore =
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

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">{summary.team_name}</h1>
            <p className="mt-1 text-sm text-zinc-400">
              {summary.division_label ? `${summary.division_label} | ` : ""}
              {summary.wins}-{summary.losses} record | {summary.games_played} games | Win%
              {" "}
              {formatPercent(summary.win_pct ?? summary.wins / (summary.games_played || 1))}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <form className="flex flex-wrap items-center gap-2" action={`/teams/${teamId}`} method="get">
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
                  href={withStatsFilters(`/teams/${teamId}`, { division: divisionId })}
                  className="text-sm text-zinc-400 hover:text-white"
                >
                  Clear
                </Link>
              ) : null}
            </form>
            <Link
              href={withStatsFilters(`/teams/compare?a=${summary.team_id}`, {
                division: divisionId,
                year,
                seasonTerm,
              })}
              className="rounded-xl border border-zinc-700 bg-zinc-950/60 px-4 py-2 text-sm text-white transition hover:border-zinc-500 hover:bg-zinc-900"
            >
              Compare Team
            </Link>
            <Link
              href={withStatsFilters("/teams", { division: divisionId, year, seasonTerm })}
              className="text-zinc-400 hover:text-white"
            >
              {"<- Back to Teams"}
            </Link>
          </div>
        </div>

        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <div className="rounded-[24px] border border-sky-400/20 bg-slate-950/65 p-4 shadow-[0_18px_45px_rgba(8,15,29,0.35)] backdrop-blur">
            <div className="text-xs uppercase tracking-wide text-zinc-500">PPG</div>
            <div className="mt-2 text-2xl font-semibold">{perGame(summary.pts, summary.games_played)}</div>
          </div>
          <div className="rounded-[24px] border border-teal-400/20 bg-slate-950/65 p-4 shadow-[0_18px_45px_rgba(8,15,29,0.35)] backdrop-blur">
            <div className="text-xs uppercase tracking-wide text-zinc-500">RPG</div>
            <div className="mt-2 text-2xl font-semibold">{perGame(summary.reb, summary.games_played)}</div>
          </div>
          <div className="rounded-[24px] border border-blue-400/20 bg-slate-950/65 p-4 shadow-[0_18px_45px_rgba(8,15,29,0.35)] backdrop-blur">
            <div className="text-xs uppercase tracking-wide text-zinc-500">APG</div>
            <div className="mt-2 text-2xl font-semibold">{perGame(summary.ast, summary.games_played)}</div>
          </div>
          <div className="rounded-[24px] border border-cyan-400/20 bg-slate-950/65 p-4 shadow-[0_18px_45px_rgba(8,15,29,0.35)] backdrop-blur">
            <div className="text-xs uppercase tracking-wide text-zinc-500">TS%</div>
            <div className="mt-2 text-2xl font-semibold">{formatFixed(tsPct)}%</div>
          </div>
          <div className="rounded-[24px] border border-sky-400/20 bg-slate-950/65 p-4 shadow-[0_18px_45px_rgba(8,15,29,0.35)] backdrop-blur">
            <div className="text-xs uppercase tracking-wide text-zinc-500">eFG%</div>
            <div className="mt-2 text-2xl font-semibold">{formatFixed(efgPct)}%</div>
          </div>
          <div className="rounded-[24px] border border-teal-400/20 bg-slate-950/65 p-4 shadow-[0_18px_45px_rgba(8,15,29,0.35)] backdrop-blur">
            <div className="text-xs uppercase tracking-wide text-zinc-500">AST/TO</div>
            <div className="mt-2 text-2xl font-semibold">{formatFixed(astTo)}</div>
          </div>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-[24px] border border-cyan-400/20 bg-slate-950/65 p-4 shadow-[0_18px_45px_rgba(8,15,29,0.35)] backdrop-blur">
            <div className="text-xs uppercase tracking-wide text-zinc-500">3PA Rate</div>
            <div className="mt-2 text-xl font-semibold">{formatFixed(threePAR)}%</div>
            <div className="mt-1 text-xs text-zinc-500">3PA / FGA</div>
          </div>
          <div className="rounded-[24px] border border-blue-400/20 bg-slate-950/65 p-4 shadow-[0_18px_45px_rgba(8,15,29,0.35)] backdrop-blur">
            <div className="text-xs uppercase tracking-wide text-zinc-500">FT Rate</div>
            <div className="mt-2 text-xl font-semibold">{formatFixed(ftRate)}%</div>
            <div className="mt-1 text-xs text-zinc-500">FTA / FGA</div>
          </div>
          <div className="rounded-[24px] border border-violet-400/20 bg-slate-950/65 p-4 shadow-[0_18px_45px_rgba(8,15,29,0.35)] backdrop-blur">
            <div className="text-xs uppercase tracking-wide text-zinc-500">TOV Rate</div>
            <div className="mt-2 text-xl font-semibold">{formatFixed(turnoverRate)}%</div>
            <div className="mt-1 text-xs text-zinc-500">TOV / (FGA + 0.44 x FTA + TOV)</div>
          </div>
          <div className="rounded-[24px] border border-emerald-400/20 bg-slate-950/65 p-4 shadow-[0_18px_45px_rgba(8,15,29,0.35)] backdrop-blur">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Pts / Shot Att</div>
            <div className="mt-2 text-xl font-semibold">{formatFixed(pointsPerShot)}</div>
            <div className="mt-1 text-xs text-zinc-500">PTS / (FGA + 0.44 x FTA)</div>
          </div>
          <div className="rounded-[24px] border border-cyan-400/20 bg-slate-950/65 p-4 shadow-[0_18px_45px_rgba(8,15,29,0.35)] backdrop-blur">
            <div className="text-xs uppercase tracking-wide text-zinc-500">SOS</div>
            <div className="mt-2 text-xl font-semibold">{formatFixed(summary.strength_of_schedule ?? 0)}</div>
            <div className="mt-1 text-xs text-zinc-500">Average opponent net rating</div>
          </div>
          <div className="rounded-[24px] border border-indigo-400/20 bg-slate-950/65 p-4 shadow-[0_18px_45px_rgba(8,15,29,0.35)] backdrop-blur">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Adj Net</div>
            <div className="mt-2 text-xl font-semibold">{formatFixed(summary.adjusted_net_rating ?? 0)}</div>
            <div className="mt-1 text-xs text-zinc-500">Opponent-adjusted margin</div>
          </div>
          <div className="rounded-[24px] border border-sky-400/20 bg-slate-950/65 p-4 shadow-[0_18px_45px_rgba(8,15,29,0.35)] backdrop-blur">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Opp Win%</div>
            <div className="mt-2 text-xl font-semibold">
              {formatPercent(summary.opponent_win_pct ?? 0)}
            </div>
            <div className="mt-1 text-xs text-zinc-500">Schedule quality check</div>
          </div>
        </div>

        <div className="mb-6 grid gap-4 xl:grid-cols-3">
          <div className="rounded-[24px] border border-sky-400/18 bg-slate-950/65 p-4 shadow-[0_18px_45px_rgba(8,15,29,0.35)] backdrop-blur">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Off Rating</div>
            <div className="mt-2 text-2xl font-semibold">
              {formatFixed(summary.offensive_rating ?? summary.pts / (summary.games_played || 1))}
            </div>
            <div className="mt-1 text-xs text-zinc-500">Points scored per game</div>
          </div>
          <div className="rounded-[24px] border border-cyan-400/18 bg-slate-950/65 p-4 shadow-[0_18px_45px_rgba(8,15,29,0.35)] backdrop-blur">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Def Rating</div>
            <div className="mt-2 text-2xl font-semibold">
              {formatFixed(summary.defensive_rating ?? 0)}
            </div>
            <div className="mt-1 text-xs text-zinc-500">Points allowed per game</div>
          </div>
          <div className="rounded-[24px] border border-blue-400/18 bg-slate-950/65 p-4 shadow-[0_18px_45px_rgba(8,15,29,0.35)] backdrop-blur">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Adj Off / Adj Def</div>
            <div className="mt-2 text-2xl font-semibold">
              {formatFixed(summary.adjusted_offensive_rating ?? 0)} / {formatFixed(summary.adjusted_defensive_rating ?? 0)}
            </div>
            <div className="mt-1 text-xs text-zinc-500">Normalized against opponent profile</div>
          </div>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-[24px] border border-cyan-400/18 bg-slate-950/65 p-4 shadow-[0_18px_45px_rgba(8,15,29,0.35)] backdrop-blur">
            <div className="text-xs uppercase tracking-wide text-zinc-500">2P%</div>
            <div className="mt-2 text-2xl font-semibold">{formatFixed(twoPointPct)}%</div>
            <div className="mt-1 text-xs text-zinc-500">2PM / 2PA</div>
          </div>
          <div className="rounded-[24px] border border-sky-400/18 bg-slate-950/65 p-4 shadow-[0_18px_45px_rgba(8,15,29,0.35)] backdrop-blur">
            <div className="text-xs uppercase tracking-wide text-zinc-500">2PA Rate</div>
            <div className="mt-2 text-2xl font-semibold">{formatFixed(twoPointAttemptRate)}%</div>
            <div className="mt-1 text-xs text-zinc-500">2PA / FGA</div>
          </div>
          <div className="rounded-[24px] border border-emerald-400/18 bg-slate-950/65 p-4 shadow-[0_18px_45px_rgba(8,15,29,0.35)] backdrop-blur">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Game Score / G</div>
            <div className="mt-2 text-2xl font-semibold">{formatFixed(teamGameScore)}</div>
            <div className="mt-1 text-xs text-zinc-500">Box-score composite proxy</div>
          </div>
          <div className="rounded-[24px] border border-violet-400/18 bg-slate-950/65 p-4 shadow-[0_18px_45px_rgba(8,15,29,0.35)] backdrop-blur">
            <div className="text-xs uppercase tracking-wide text-zinc-500">2PT Share</div>
            <div className="mt-2 text-2xl font-semibold">{formatFixed(shotDiet.twoPointShare)}%</div>
            <div className="mt-1 text-xs text-zinc-500">{shotDiet.twoPointPoints} points from twos</div>
          </div>
          <div className="rounded-[24px] border border-amber-400/18 bg-slate-950/65 p-4 shadow-[0_18px_45px_rgba(8,15,29,0.35)] backdrop-blur">
            <div className="text-xs uppercase tracking-wide text-zinc-500">3PT / FT Share</div>
            <div className="mt-2 text-2xl font-semibold">
              {formatFixed(shotDiet.threePointShare)}% / {formatFixed(shotDiet.freeThrowShare)}%
            </div>
            <div className="mt-1 text-xs text-zinc-500">Share of scoring by source</div>
          </div>
        </div>

        <TeamAnalytics
          teamName={summary.team_name}
          gamesPlayed={summary.games_played}
          fgm={summary.fgm}
          tpm={summary.tpm}
          ftm={summary.ftm}
          players={summary.players}
        />

        <div className="mb-6 grid gap-6 lg:grid-cols-[1.35fr_1fr]">
          <div className="overflow-x-auto rounded-[28px] border border-sky-400/15 bg-slate-950/65 shadow-[0_20px_60px_rgba(8,15,29,0.4)] backdrop-blur">
            <div className="border-b border-zinc-800 px-4 py-3">
              <h2 className="font-semibold">Roster Totals</h2>
            </div>
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-950 text-zinc-300">
                <tr>
                  <th className="p-3 text-left font-medium">Player</th>
                  <th className="p-3 text-right font-medium">GP</th>
                  <th className="p-3 text-right font-medium">PPG</th>
                  <th className="p-3 text-right font-medium">REB</th>
                  <th className="p-3 text-right font-medium">AST</th>
                  <th className="p-3 text-right font-medium">TS%</th>
                  <th className="p-3 text-right font-medium">eFG%</th>
                  <th className="p-3 text-right font-medium">AST/TO</th>
                  <th className="p-3 text-right font-medium">Score Share</th>
                  <th className="p-3 text-right font-medium">REB Share</th>
                  <th className="p-3 text-right font-medium">AST Share</th>
                  <th className="p-3 text-right font-medium">Stocks/G</th>
                  <th className="p-3 text-right font-medium">TOV Rate</th>
                  <th className="p-3 text-right font-medium">Pts/Shot</th>
                  <th className="p-3 text-right font-medium">2P%</th>
                  <th className="p-3 text-right font-medium">3PA Rate</th>
                  <th className="p-3 text-right font-medium">2PA Rate</th>
                  <th className="p-3 text-right font-medium">Game Score/G</th>
                </tr>
              </thead>
              <tbody>
                {summary.players.map((player) => {
                  const playerTs = calcTsPercent(player.pts, player.fga, player.fta);
                  const playerEfg = calcEfgPercent(player.fgm, player.tpm, player.fga);
                  const playerAstTo = calcRatio(player.ast, player.tov);
                  const playerThreePAR = calcRate(player.tpa, player.fga);
                  const playerStocks = (player.stl + player.blk) / (player.games_played || 1);
                  const playerTovRate = calcTurnoverRateProxy(player.tov, player.fga, player.fta);
                  const playerPointsPerShot = calcPointsPerShotAttempt(player.pts, player.fga, player.fta);
                  const playerTwoPct = calcTwoPointPercent(player.fgm, player.tpm, player.fga, player.tpa);
                  const playerTwoPar = calcTwoPointAttemptRate(player.fga, player.tpa);
                  const playerGameScore =
                    calcGameScore(
                      player.pts,
                      player.fgm,
                      player.fga,
                      player.ftm,
                      player.fta,
                      player.reb,
                      player.ast,
                      player.stl,
                      player.blk,
                      player.fouls,
                      player.tov,
                    ) / (player.games_played || 1);
                  const scoringShare = calcRate(player.pts, summary.pts);
                  const reboundShare = calcRate(player.reb, summary.reb);
                  const assistShare = calcRate(player.ast, summary.ast);

                  return (
                    <tr key={player.player_id} className="border-t border-zinc-800">
                      <td className="p-3 whitespace-nowrap font-medium">
                        <Link
                          className="hover:underline"
                          href={withStatsFilters(`/players/${player.player_id}`, {
                            division: divisionId,
                            year,
                            seasonTerm,
                          })}
                        >
                          {player.player_name}
                        </Link>
                      </td>
                      <td className="p-3 text-right">{player.games_played}</td>
                      <td className="p-3 text-right">{perGame(player.pts, player.games_played)}</td>
                      <td className="p-3 text-right">{player.reb}</td>
                      <td className="p-3 text-right">{player.ast}</td>
                      <td className="p-3 text-right">{formatFixed(playerTs)}</td>
                      <td className="p-3 text-right">{formatFixed(playerEfg)}</td>
                      <td className="p-3 text-right">{formatFixed(playerAstTo)}</td>
                      <td className="p-3 text-right">{formatFixed(scoringShare)}%</td>
                      <td className="p-3 text-right">{formatFixed(reboundShare)}%</td>
                      <td className="p-3 text-right">{formatFixed(assistShare)}%</td>
                      <td className="p-3 text-right">{formatFixed(playerStocks)}</td>
                      <td className="p-3 text-right">{formatFixed(playerTovRate)}%</td>
                      <td className="p-3 text-right">{formatFixed(playerPointsPerShot)}</td>
                      <td className="p-3 text-right">{formatFixed(playerTwoPct)}%</td>
                      <td className="p-3 text-right">{formatFixed(playerThreePAR)}</td>
                      <td className="p-3 text-right">{formatFixed(playerTwoPar)}%</td>
                      <td className="p-3 text-right">{formatFixed(playerGameScore)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="rounded-[28px] border border-cyan-400/15 bg-slate-950/65 shadow-[0_20px_60px_rgba(8,15,29,0.4)] backdrop-blur">
            <div className="border-b border-zinc-800 px-4 py-3">
              <h2 className="font-semibold">Recent Games</h2>
            </div>
            <div className="divide-y divide-zinc-800">
              {summary.recent_games.length === 0 ? (
                <div className="p-4 text-sm text-zinc-400">No recent games available.</div>
              ) : (
                summary.recent_games.map((game) => (
                  <div key={game.game_id} className="flex items-center justify-between gap-4 p-4 text-sm">
                    <div>
                      <div className="font-medium">
                        {game.result} vs {game.opponent_team_name}
                      </div>
                      <div className="text-zinc-400">{game.game_date || "Unknown date"}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">
                        {game.team_pts}-{game.opponent_pts}
                      </div>
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
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="mb-6">
          <AnalyticsMethodology includeTeamMetrics />
        </div>
      </div>
    </main>
  );
}
