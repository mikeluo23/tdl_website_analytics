import TeamStandingsTable from "@/app/components/TeamStandingsTable";
import { apiGet } from "@/lib/api";
import Link from "next/link";
import { normalizeDivision, withQuery, withStatsFilters } from "@/lib/divisions";

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

type SeasonOptions = {
  years: string[];
  season_terms: string[];
  year_terms: { year: string; season_terms: string[] }[];
};

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ division?: string; year?: string; season_term?: string }>;
}) {
  const { division, year = "", season_term: seasonTerm = "" } = await searchParams;
  const divisionId = normalizeDivision(division);
  const [teams, seasonOptions] = await Promise.all([
    apiGet<Team[]>(
      withQuery("/teams", {
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

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Teams</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Team records and advanced stats across the selected time window.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <form className="flex flex-wrap items-center gap-2" action="/teams" method="get">
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
                  href={withStatsFilters("/teams", { division: divisionId })}
                  className="text-sm text-zinc-400 hover:text-white"
                >
                  Clear
                </Link>
              ) : null}
            </form>
            <Link
              href={withStatsFilters("/teams/compare", {
                division: divisionId,
                year,
                seasonTerm,
              })}
              className="rounded-xl border border-zinc-700 bg-zinc-950/60 px-4 py-2 text-sm text-white transition hover:border-zinc-500 hover:bg-zinc-900"
            >
              Compare Teams
            </Link>
          </div>
        </div>

        <TeamStandingsTable
          teams={teams}
          division={divisionId}
          year={year}
          seasonTerm={seasonTerm}
        />
      </div>
    </main>
  );
}
