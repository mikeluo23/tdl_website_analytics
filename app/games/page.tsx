import Link from "next/link";
import { apiGet } from "@/lib/api";
import { normalizeDivision, withQuery, withStatsFilters } from "@/lib/divisions";

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

type SeasonOptions = {
  years: string[];
  season_terms: string[];
  year_terms: { year: string; season_terms: string[] }[];
};

type GamePageResponse = {
  items: GameRow[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
};

const PAGE_SIZE = 40;

function hasScore(game: GameRow) {
  return typeof game.team1_pts === "number" && typeof game.team2_pts === "number";
}

export default async function GamesPage({
  searchParams,
}: {
  searchParams: Promise<{
    division?: string;
    year?: string;
    season_term?: string;
    sort_by?: string;
    page?: string;
  }>;
}) {
  const {
    division,
    year = "",
    season_term: seasonTerm = "",
    sort_by: sortBy = "date_desc",
    page: pageParam = "1",
  } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const divisionId = normalizeDivision(division);
  const [gamesPage, seasonOptions] = await Promise.all([
    apiGet<GamePageResponse>(
      withQuery("/games-page", {
        division: divisionId || undefined,
        year: year || undefined,
        season_term: seasonTerm || undefined,
        sort_by: sortBy,
        page: String(page),
        limit: String(PAGE_SIZE),
      }),
    ),
    apiGet<SeasonOptions>(withQuery("/season-options", { division: divisionId || undefined })),
  ]);
  const seasonTermsForYear =
    seasonOptions.year_terms.find((option) => option.year === year)?.season_terms ??
    seasonOptions.season_terms;
  const startRow = gamesPage.total === 0 ? 0 : (gamesPage.page - 1) * gamesPage.page_size + 1;
  const endRow = Math.min(gamesPage.page * gamesPage.page_size, gamesPage.total);

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Games</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Recent matchups with box scores and final results.
              {gamesPage.total ? ` | showing ${startRow}-${endRow} of ${gamesPage.total}` : ""}
            </p>
          </div>
          <form className="flex flex-wrap items-center gap-2" action="/games" method="get">
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
            <select
              name="sort_by"
              defaultValue={sortBy}
              className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-white"
            >
              <option value="date_desc">Sort: Newest Date</option>
              <option value="date_asc">Sort: Oldest Date</option>
              <option value="season_desc">Sort: Newest Season</option>
              <option value="season_asc">Sort: Oldest Season</option>
              <option value="division_asc">Sort: Division A-Z</option>
              <option value="division_desc">Sort: Division Z-A</option>
            </select>
            <button className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-zinc-200">
              Apply
            </button>
            {year || seasonTerm || sortBy !== "date_desc" ? (
              <Link
                href={withStatsFilters("/games", { division: divisionId })}
                className="text-sm text-zinc-400 hover:text-white"
              >
                Clear
              </Link>
            ) : null}
          </form>
        </div>

        {gamesPage.total === 0 ? (
          <div className="text-zinc-400">No games found.</div>
        ) : (
          <div className="grid gap-4">
            {gamesPage.items.map((game) => {
              const scored = hasScore(game);
              const winner =
                scored && game.team1_pts !== game.team2_pts
                  ? game.team1_pts! > game.team2_pts!
                    ? "team1"
                    : "team2"
                  : null;

              return (
                <div
                  key={game.game_id}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-zinc-500">
                        <span>{game.game_date || "Unknown date"}</span>
                        {game.division_label ? <span>{game.division_label}</span> : null}
                        {game.league ? <span>{game.league}</span> : null}
                        {game.venue ? <span>{game.venue}</span> : null}
                      </div>

                      <div className="grid gap-2">
                        <div className="flex items-center gap-3">
                          <span
                            className={`min-w-0 text-lg ${winner === "team1" ? "font-semibold text-white" : "text-zinc-200"}`}
                          >
                            {game.team1_name}
                          </span>
                          {scored ? (
                            <span className="text-lg font-mono text-zinc-300">{game.team1_pts}</span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-3">
                          <span
                            className={`min-w-0 text-lg ${winner === "team2" ? "font-semibold text-white" : "text-zinc-200"}`}
                          >
                            {game.team2_name}
                          </span>
                          {scored ? (
                            <span className="text-lg font-mono text-zinc-300">{game.team2_pts}</span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      {game.game_url ? (
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
                        className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-zinc-200"
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
                </div>
              );
            })}
          </div>
        )}

        {gamesPage.total_pages > 1 ? (
          <div className="mt-4 flex items-center justify-between gap-3 text-sm text-zinc-400">
            <div>
              Page {gamesPage.page} of {gamesPage.total_pages}
            </div>
            <div className="flex items-center gap-3">
              {gamesPage.page > 1 ? (
                <Link
                  href={withQuery("/games", {
                    division: divisionId || undefined,
                    year: year || undefined,
                    season_term: seasonTerm || undefined,
                    sort_by: sortBy,
                    page: String(gamesPage.page - 1),
                  })}
                  className="rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-white transition hover:border-zinc-500 hover:bg-zinc-900"
                >
                  Previous
                </Link>
              ) : (
                <span className="rounded-lg border border-zinc-800 px-3 py-2 text-zinc-600">
                  Previous
                </span>
              )}
              {gamesPage.page < gamesPage.total_pages ? (
                <Link
                  href={withQuery("/games", {
                    division: divisionId || undefined,
                    year: year || undefined,
                    season_term: seasonTerm || undefined,
                    sort_by: sortBy,
                    page: String(gamesPage.page + 1),
                  })}
                  className="rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-white transition hover:border-zinc-500 hover:bg-zinc-900"
                >
                  Next
                </Link>
              ) : (
                <span className="rounded-lg border border-zinc-800 px-3 py-2 text-zinc-600">
                  Next
                </span>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
