export type DivisionOption = {
  division_id: string;
  division_label: string;
  games?: number;
  teams?: number;
  players?: number;
};

export function normalizeDivision(value?: string | null) {
  return value?.trim() ?? "";
}

export function withQuery(
  path: string,
  params: Record<string, string | number | null | undefined>,
) {
  const [pathname, queryString = ""] = path.split("?");
  const searchParams = new URLSearchParams(queryString);

  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") {
      searchParams.delete(key);
      continue;
    }
    searchParams.set(key, String(value));
  }

  const nextQuery = searchParams.toString();
  return nextQuery ? `${pathname}?${nextQuery}` : pathname;
}

export function withDivision(path: string, division?: string | null) {
  return withQuery(path, { division: normalizeDivision(division) || undefined });
}

export function withStatsFilters(
  path: string,
  filters: {
    division?: string | null;
    year?: string | null;
    seasonTerm?: string | null;
  },
) {
  return withQuery(path, {
    division: normalizeDivision(filters.division) || undefined,
    year: filters.year?.trim() || undefined,
    season_term: filters.seasonTerm?.trim() || undefined,
  });
}
