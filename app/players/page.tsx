import { apiGet } from "@/lib/api";
import Link from "next/link";
import { normalizeDivision, withQuery, withStatsFilters } from "@/lib/divisions";

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

type PlayerPageResponse = {
  items: Player[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
};

const PAGE_SIZE = 50;

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    division?: string;
    year?: string;
    season_term?: string;
    page?: string;
  }>;
}) {
  const { q, division, year = "", season_term: seasonTerm = "", page: pageParam = "1" } =
    await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const divisionId = normalizeDivision(division);

  const [playersPage, seasonOptions] = await Promise.all([
    apiGet<PlayerPageResponse>(
      withQuery("/players-page", {
        q: q?.trim() || undefined,
        division: divisionId || undefined,
        year: year || undefined,
        season_term: seasonTerm || undefined,
        page: String(page),
        limit: String(PAGE_SIZE),
      }),
    ),
    apiGet<SeasonOptions>(withQuery("/season-options", { division: divisionId || undefined })),
  ]);
  const seasonTermsForYear =
    seasonOptions.year_terms.find((option) => option.year === year)?.season_terms ??
    seasonOptions.season_terms;
  const startRow = playersPage.total === 0 ? 0 : (playersPage.page - 1) * playersPage.page_size + 1;
  const endRow = Math.min(playersPage.page * playersPage.page_size, playersPage.total);

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Players</h1>
            <p className="text-zinc-400 text-sm mt-1">
              {playersPage.total} player{playersPage.total === 1 ? "" : "s"}
              {q?.trim() ? ` matching "${q}"` : ""}
              {playersPage.total ? ` | showing ${startRow}-${endRow}` : ""}
            </p>
          </div>

          <form className="flex flex-wrap items-center gap-2" action="/players" method="get">
            {divisionId ? <input type="hidden" name="division" value={divisionId} /> : null}
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search..."
              className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-white placeholder:text-zinc-500"
            />
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
            {q?.trim() || year || seasonTerm ? (
              <Link
                href={withStatsFilters("/players", { division: divisionId })}
                className="text-zinc-300 hover:text-white text-sm"
              >
                Clear
              </Link>
            ) : null}
          </form>
        </div>

        <div className="bg-zinc-900/70 rounded-2xl border border-zinc-800 overflow-hidden">
          <ul className="divide-y divide-zinc-800">
            {playersPage.items.map((p) => (
              <li key={p.player_id} className="p-4 hover:bg-zinc-800/60 transition">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Link
                    href={withStatsFilters(`/players/${String(p.player_id)}`, {
                      division: divisionId,
                      year,
                      seasonTerm,
                    })}
                    className="hover:underline"
                  >
                    {p.player_name}
                  </Link>
                  {!divisionId && p.division_labels?.length ? (
                    <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-zinc-400">
                      {p.division_labels.map((label) => (
                        <span
                          key={`${p.player_id}-${label}`}
                          className="rounded-full border border-zinc-700 bg-zinc-950/60 px-2 py-1"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {playersPage.total_pages > 1 ? (
          <div className="mt-4 flex items-center justify-between gap-3 text-sm text-zinc-400">
            <div>
              Page {playersPage.page} of {playersPage.total_pages}
            </div>
            <div className="flex items-center gap-3">
              {playersPage.page > 1 ? (
                <Link
                  href={withQuery("/players", {
                    q: q?.trim() || undefined,
                    division: divisionId || undefined,
                    year: year || undefined,
                    season_term: seasonTerm || undefined,
                    page: String(playersPage.page - 1),
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
              {playersPage.page < playersPage.total_pages ? (
                <Link
                  href={withQuery("/players", {
                    q: q?.trim() || undefined,
                    division: divisionId || undefined,
                    year: year || undefined,
                    season_term: seasonTerm || undefined,
                    page: String(playersPage.page + 1),
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

        {playersPage.total === 0 ? (
          <div className="text-zinc-400 mt-4">
            No players found.
          </div>
        ) : null}
      </div>
    </main>
  );
}
