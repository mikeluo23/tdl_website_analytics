from __future__ import annotations

import argparse
import csv
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

import refresh_divisions as live

ROOT_DIR = Path(__file__).resolve().parent
DEFAULT_CONFIG_PATH = ROOT_DIR / "division_specs.yaml"
PLAYER_SOURCE_HEADERS = ["division_id", "division_label", "player_url", "player_slug"]
GAME_SOURCE_HEADERS = [
    "game_url",
    "game_slug",
    "source_division_id",
    "source_division_label",
    "discovered_from_player_url",
]
HISTORICAL_GAME_HEADERS = [
    "game_url",
    "game_id",
    "title",
    "game_date",
    "season_code",
    "season_year",
    "season_term",
    "league",
    "venue",
    "source_division_id",
    "source_division_label",
    "division_id",
    "division_label",
]
HISTORICAL_PLAYER_HEADERS = [
    "division_id",
    "division_label",
    "source_division_id",
    "source_division_label",
    "season_code",
    "season_year",
    "season_term",
    "player_name",
    "pts",
    "reb",
    "ast",
    "stl",
    "blk",
    "fgm",
    "fga",
    "fg%",
    "3pm",
    "3pa",
    "3p%",
    "ftm",
    "fta",
    "ft%",
    "tov",
    "pf",
    "game_id",
    "game_url",
    "table_index",
    "team_name",
]
HISTORICAL_TEAM_TOTAL_HEADERS = [
    "division_id",
    "division_label",
    "source_division_id",
    "source_division_label",
    "season_code",
    "season_year",
    "season_term",
    "game_id",
    "game_url",
    "table_index",
    "team_name",
    "team_lineage_id",
    "team_season_id",
    "pts",
    "reb",
    "ast",
    "stl",
    "blk",
    "fgm",
    "fga",
    "fg%",
    "3pm",
    "3pa",
    "3p%",
    "ftm",
    "fta",
    "ft%",
    "tov",
    "pf",
]
TEAM_LINEAGE_HEADERS = [
    "team_lineage_id",
    "division_id",
    "division_label",
    "normalized_team_name",
    "representative_team_name",
    "season_count",
]


@dataclass
class HistoricalEvent:
    game_url: str
    game_id: str
    title: str
    game_date: str
    season_code: str
    season_year: str
    season_term: str
    league: str
    venue: str
    source_division_id: str
    source_division_label: str
    division_id: str
    division_label: str
    player_rows: list[dict[str, object]]
    team_totals: list[dict[str, object]]


def csv_path(name: str) -> Path:
    return ROOT_DIR / name


def normalize_team_key(value: str) -> str:
    text = live.clean_team_name(value).lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def normalize_descriptor(value: str) -> str:
    text = live.normalize_space(value).lower()
    if not text:
        return ""

    replacements = {
        "first": "1st",
        "second": "2nd",
        "third": "3rd",
        "premier": "1st",
        "mondays": "monday",
        "tuesdays": "tuesday",
        "wednesdays": "wednesday",
        "thursdays": "thursday",
        "sundays": "sunday",
    }
    for source, target in replacements.items():
        text = re.sub(rf"\b{re.escape(source)}\b", target, text)

    text = re.sub(r"\bdivision\s+[ab]\b", "division", text)
    text = re.sub(r"\b([123])(?!st|nd|rd)\b", lambda match: {"1": "1st", "2": "2nd", "3": "3rd"}[match.group(1)], text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def extract_division_signature(value: str) -> tuple[str, str]:
    normalized = normalize_descriptor(value)
    if not normalized:
        return "", ""

    if "1st" in normalized and "premier" not in live.normalize_space(value).lower():
        tier = "1st"
    elif "1st" in normalized or "premier" in live.normalize_space(value).lower():
        tier = "1st"
    elif "2nd" in normalized:
        tier = "2nd"
    elif "3rd" in normalized:
        tier = "3rd"
    else:
        tier = ""

    day_match = re.search(r"\b(monday|tuesday|wednesday|thursday|sunday)\b", normalized)
    day = day_match.group(1) if day_match else ""
    return tier, day


def season_parts(value: str) -> tuple[str, str, str]:
    text = live.normalize_space(value)
    if not text:
        return "", "", ""

    compact = text.replace(" ", "")
    match = re.fullmatch(r"(\d{4})([A-Za-z]+)", compact)
    if match:
        return text, match.group(1), match.group(2).upper()

    year_match = re.search(r"(20\d{2})", text)
    year = year_match.group(1) if year_match else ""
    term = text.replace(year, "").strip(" -/").upper() if year else text.upper()
    return text, year, term


def absolute_url(url: str, base: str = "https://tdlbasketball.com/") -> str:
    return urljoin(base, url.strip())


def slug_from_url(url: str) -> str:
    return urlparse(url).path.rstrip("/").split("/")[-1]


def read_existing_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, headers: list[str], rows: Iterable[dict[str, object]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        for row in rows:
            writer.writerow({header: row.get(header, "") for header in headers})


def discover_player_urls(session, division: live.DivisionSpec) -> list[str]:
    if not division.leaders_url:
        return []

    response = session.get(division.leaders_url, timeout=live.REQUEST_TIMEOUT)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "lxml")
    urls: set[str] = set()

    for link in soup.select("a[href]"):
        href = link.get("href", "")
        if "/player/" not in href:
            continue
        urls.add(absolute_url(href))

    return sorted(urls)


def discover_event_urls_from_player(session, player_url: str) -> set[str]:
    response = session.get(player_url, timeout=live.REQUEST_TIMEOUT)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "lxml")
    urls: set[str] = set()

    for link in soup.select("a[href]"):
        href = link.get("href", "")
        if "/event/" not in href:
            continue
        urls.add(absolute_url(href))

    return urls


def division_candidates(division: live.DivisionSpec) -> set[str]:
    candidates = {
        normalize_descriptor(division.label),
        normalize_descriptor(division.short_label),
    }
    for url in [division.calendar_url, division.standings_url, division.leaders_url]:
        slug = slug_from_url(url)
        if slug:
            candidates.add(normalize_descriptor(slug.replace("-", " ")))
    return {candidate for candidate in candidates if candidate}


def infer_division(
    league_text: str,
    source_division: live.DivisionSpec,
    all_divisions: list[live.DivisionSpec],
) -> live.DivisionSpec:
    normalized_league = normalize_descriptor(league_text)
    if not normalized_league:
        return source_division

    league_tier, league_day = extract_division_signature(league_text)
    if league_tier:
        exact_matches = [
            division
            for division in all_divisions
            if extract_division_signature(division.label)[0] == league_tier
            and (
                not league_day
                or extract_division_signature(division.label)[1] == league_day
                or extract_division_signature(division.short_label)[1] == league_day
            )
        ]
        if len(exact_matches) == 1:
            return exact_matches[0]

    for division in all_divisions:
        if any(candidate and candidate in normalized_league for candidate in division_candidates(division)):
            return division

    return source_division


def repair_historical_divisions(config_path: Path) -> None:
    divisions = live.load_division_specs(config_path, None)
    if not divisions:
        raise SystemExit("No active divisions available for historical repair.")

    historical_games_path = csv_path("historical_games.csv")
    historical_player_stats_path = csv_path("historical_player_game_stats.csv")
    historical_team_totals_path = csv_path("historical_team_game_totals.csv")
    team_lineages_path = csv_path("historical_team_lineages.csv")

    game_rows = read_existing_rows(historical_games_path)
    player_rows = read_existing_rows(historical_player_stats_path)
    team_rows = read_existing_rows(historical_team_totals_path)

    if not game_rows:
        raise SystemExit("No historical_games.csv rows found to repair.")

    repaired_games: list[dict[str, str]] = []
    game_divisions: dict[str, tuple[str, str]] = {}

    for row in game_rows:
        source_division_id = row.get("source_division_id", "")
        source_division = next((division for division in divisions if division.id == source_division_id), divisions[0])
        parsed_division = infer_division(row.get("league", ""), source_division, divisions)
        repaired_row = {
            **row,
            "division_id": parsed_division.id,
            "division_label": parsed_division.short_label,
        }
        repaired_games.append(repaired_row)
        if row.get("game_url"):
            game_divisions[row["game_url"]] = (parsed_division.id, parsed_division.short_label)
        if row.get("game_id"):
            game_divisions[row["game_id"]] = (parsed_division.id, parsed_division.short_label)

    repaired_players: list[dict[str, str]] = []
    for row in player_rows:
        division = game_divisions.get(row.get("game_url", "")) or game_divisions.get(row.get("game_id", ""))
        if division:
            repaired_players.append(
                {
                    **row,
                    "division_id": division[0],
                    "division_label": division[1],
                }
            )
        else:
            repaired_players.append(row)

    repaired_teams: list[dict[str, str]] = []
    for row in team_rows:
        division = game_divisions.get(row.get("game_url", "")) or game_divisions.get(row.get("game_id", ""))
        if division:
            normalized_team_name = normalize_team_key(str(row.get("team_name", "")))
            repaired_teams.append(
                {
                    **row,
                    "division_id": division[0],
                    "division_label": division[1],
                    "team_lineage_id": f"{division[0]}:{normalized_team_name}",
                    "team_season_id": f"{division[0]}:{normalized_team_name}:{row.get('season_code') or 'unknown'}",
                }
            )
        else:
            repaired_teams.append(row)

    repaired_lineages = build_team_lineage_rows(
        [row for row in repaired_teams if row.get("team_lineage_id")]
    )

    write_csv(historical_games_path, HISTORICAL_GAME_HEADERS, repaired_games)
    write_csv(historical_player_stats_path, HISTORICAL_PLAYER_HEADERS, repaired_players)
    write_csv(historical_team_totals_path, HISTORICAL_TEAM_TOTAL_HEADERS, repaired_teams)
    write_csv(team_lineages_path, TEAM_LINEAGE_HEADERS, repaired_lineages)

    print(f"Repaired division assignments for {len(repaired_games)} historical games.")


def build_team_lineage_rows(team_totals: list[dict[str, str]]) -> list[dict[str, object]]:
    grouped: dict[str, dict[str, object]] = {}

    for row in team_totals:
        lineage_id = str(row["team_lineage_id"])
        bucket = grouped.setdefault(
            lineage_id,
            {
                "team_lineage_id": lineage_id,
                "division_id": row["division_id"],
                "division_label": row["division_label"],
                "normalized_team_name": lineage_id.split(":", 1)[1] if ":" in lineage_id else lineage_id,
                "representative_team_name": row["team_name"],
                "seasons": set(),
            },
        )
        bucket["seasons"].add(row["season_code"])

    rows: list[dict[str, object]] = []
    for bucket in grouped.values():
        rows.append(
            {
                "team_lineage_id": bucket["team_lineage_id"],
                "division_id": bucket["division_id"],
                "division_label": bucket["division_label"],
                "normalized_team_name": bucket["normalized_team_name"],
                "representative_team_name": bucket["representative_team_name"],
                "season_count": len(bucket["seasons"]),
            }
        )

    rows.sort(key=lambda row: (str(row["division_label"]), str(row["representative_team_name"])))
    return rows


def parse_historical_event(
    session,
    event_url: str,
    source_division: live.DivisionSpec,
    all_divisions: list[live.DivisionSpec],
) -> HistoricalEvent | None:
    response = session.get(event_url, timeout=live.REQUEST_TIMEOUT)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "lxml")

    try:
        details = live.parse_details_table(soup)
    except RuntimeError:
        return None

    parsed_division = infer_division(details.get("League", ""), source_division, all_divisions)

    try:
        player_rows, team_totals = live.parse_performance_tables(
            soup,
            parsed_division,
            live.game_key_from_url(event_url),
            event_url,
        )
    except RuntimeError:
        return None

    if not player_rows or len(team_totals) != 2:
        return None

    season_code, season_year, season_term = season_parts(details.get("Season", ""))
    game_id = live.game_key_from_url(event_url)

    enriched_player_rows: list[dict[str, object]] = []
    for row in player_rows:
        enriched_player_rows.append(
            {
                **row,
                "division_id": parsed_division.id,
                "division_label": parsed_division.short_label,
                "source_division_id": source_division.id,
                "source_division_label": source_division.short_label,
                "season_code": season_code,
                "season_year": season_year,
                "season_term": season_term,
                "game_id": game_id,
            }
        )

    enriched_team_totals: list[dict[str, object]] = []
    for row in team_totals:
        normalized_team_name = normalize_team_key(str(row["team_name"]))
        enriched_team_totals.append(
            {
                **row,
                "division_id": parsed_division.id,
                "division_label": parsed_division.short_label,
                "source_division_id": source_division.id,
                "source_division_label": source_division.short_label,
                "season_code": season_code,
                "season_year": season_year,
                "season_term": season_term,
                "game_id": game_id,
                "team_lineage_id": f"{parsed_division.id}:{normalized_team_name}",
                "team_season_id": f"{parsed_division.id}:{normalized_team_name}:{season_code or 'unknown'}",
            }
        )

    return HistoricalEvent(
        game_url=event_url,
        game_id=game_id,
        title=live.normalize_space(details.get("Event", "")) or live.normalize_space(details.get("Title", "")),
        game_date=live.normalize_space(details.get("Date", "")),
        season_code=season_code,
        season_year=season_year,
        season_term=season_term,
        league=live.normalize_space(details.get("League", "")),
        venue=live.normalize_space(details.get("Venue", "")),
        source_division_id=source_division.id,
        source_division_label=source_division.short_label,
        division_id=parsed_division.id,
        division_label=parsed_division.short_label,
        player_rows=enriched_player_rows,
        team_totals=enriched_team_totals,
    )


def load_seen_values(path: Path, key: str) -> set[str]:
    return {row.get(key, "") for row in read_existing_rows(path) if row.get(key)}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Backfill historical TDL events by discovering player pages and deduping event pages."
    )
    parser.add_argument("--config", default=str(DEFAULT_CONFIG_PATH), help="Path to the YAML config.")
    parser.add_argument(
        "--division",
        action="append",
        dest="division_ids",
        help="Division id to backfill. Can be passed multiple times. Defaults to all active divisions.",
    )
    parser.add_argument(
        "--max-new-events",
        type=int,
        default=0,
        help="Optional cap on newly parsed events for local testing. 0 means no cap.",
    )
    parser.add_argument(
        "--validate-config",
        action="store_true",
        help="Print the active historical discovery URLs without scraping.",
    )
    parser.add_argument(
        "--repair-divisions",
        action="store_true",
        help="Repair historical division assignments from stored league metadata without re-scraping.",
    )
    args = parser.parse_args()

    requested_ids = set(args.division_ids or [])
    divisions = live.load_division_specs(Path(args.config), requested_ids or None)
    if not divisions:
        raise SystemExit("No active divisions matched the current config/filters.")

    if args.validate_config:
        for division in divisions:
            print(f"{division.id}: leaders={division.leaders_url or '(missing)'}")
        return

    if args.repair_divisions:
        repair_historical_divisions(Path(args.config))
        return

    missing_leader_pages = [division.id for division in divisions if not division.leaders_url]
    if missing_leader_pages:
        raise SystemExit(
            "Historical backfill requires `leaders_url` for each requested division. Missing: "
            + ", ".join(missing_leader_pages)
        )

    player_sources_path = csv_path("historical_player_sources.csv")
    game_sources_path = csv_path("historical_game_sources.csv")
    historical_games_path = csv_path("historical_games.csv")
    historical_player_stats_path = csv_path("historical_player_game_stats.csv")
    historical_team_totals_path = csv_path("historical_team_game_totals.csv")
    team_lineages_path = csv_path("historical_team_lineages.csv")

    existing_player_sources = read_existing_rows(player_sources_path)
    existing_game_sources = read_existing_rows(game_sources_path)
    existing_games = read_existing_rows(historical_games_path)
    existing_player_rows = read_existing_rows(historical_player_stats_path)
    existing_team_totals = read_existing_rows(historical_team_totals_path)

    seen_player_urls = load_seen_values(player_sources_path, "player_url")
    seen_game_urls = load_seen_values(game_sources_path, "game_url") | load_seen_values(
        historical_games_path, "game_url"
    )

    session = live.make_session()
    new_player_sources: list[dict[str, object]] = []
    new_game_sources: list[dict[str, object]] = []
    new_events: list[HistoricalEvent] = []

    for division in divisions:
        player_urls = discover_player_urls(session, division)
        for player_url in player_urls:
            if player_url in seen_player_urls:
                continue

            seen_player_urls.add(player_url)
            new_player_sources.append(
                {
                    "division_id": division.id,
                    "division_label": division.short_label,
                    "player_url": player_url,
                    "player_slug": slug_from_url(player_url),
                }
            )

            event_urls = discover_event_urls_from_player(session, player_url)
            for event_url in sorted(event_urls):
                if event_url in seen_game_urls:
                    continue

                seen_game_urls.add(event_url)
                new_game_sources.append(
                    {
                        "game_url": event_url,
                        "game_slug": slug_from_url(event_url),
                        "source_division_id": division.id,
                        "source_division_label": division.short_label,
                        "discovered_from_player_url": player_url,
                    }
                )

                event = parse_historical_event(session, event_url, division, divisions)
                if event is None:
                    continue

                new_events.append(event)
                if args.max_new_events and len(new_events) >= args.max_new_events:
                    break

            if args.max_new_events and len(new_events) >= args.max_new_events:
                break

        if args.max_new_events and len(new_events) >= args.max_new_events:
            break

    combined_game_rows = existing_games + [
        {
            "game_url": event.game_url,
            "game_id": event.game_id,
            "title": event.title,
            "game_date": event.game_date,
            "season_code": event.season_code,
            "season_year": event.season_year,
            "season_term": event.season_term,
            "league": event.league,
            "venue": event.venue,
            "source_division_id": event.source_division_id,
            "source_division_label": event.source_division_label,
            "division_id": event.division_id,
            "division_label": event.division_label,
        }
        for event in new_events
    ]
    combined_player_rows = existing_player_rows + [row for event in new_events for row in event.player_rows]
    combined_team_totals = existing_team_totals + [row for event in new_events for row in event.team_totals]
    combined_player_sources = existing_player_sources + new_player_sources
    combined_game_sources = existing_game_sources + new_game_sources
    combined_team_lineages = build_team_lineage_rows(
        [row for row in combined_team_totals if row.get("team_lineage_id")]
    )

    write_csv(player_sources_path, PLAYER_SOURCE_HEADERS, combined_player_sources)
    write_csv(game_sources_path, GAME_SOURCE_HEADERS, combined_game_sources)
    write_csv(historical_games_path, HISTORICAL_GAME_HEADERS, combined_game_rows)
    write_csv(historical_player_stats_path, HISTORICAL_PLAYER_HEADERS, combined_player_rows)
    write_csv(historical_team_totals_path, HISTORICAL_TEAM_TOTAL_HEADERS, combined_team_totals)
    write_csv(team_lineages_path, TEAM_LINEAGE_HEADERS, combined_team_lineages)

    print(
        f"Historical backfill discovered {len(new_player_sources)} new players, "
        f"{len(new_game_sources)} new event links, and parsed {len(new_events)} new events."
    )


if __name__ == "__main__":
    main()
