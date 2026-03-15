from __future__ import annotations

import argparse
import csv
import os
import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable
from urllib.parse import urlparse

import pymysql
import requests
import yaml
from bs4 import BeautifulSoup
from dotenv import load_dotenv

USER_AGENT = "Mozilla/5.0 (compatible; d3-stats-refresh/2.0; +https://tdlbasketball.com/)"
REQUEST_TIMEOUT = 30
ROOT_DIR = Path(__file__).resolve().parent
DEFAULT_CONFIG_PATH = ROOT_DIR / "division_specs.yaml"

PLAYER_HEADERS = [
    "division_id",
    "division_label",
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

TEAM_TOTAL_HEADERS = [
    "division_id",
    "division_label",
    "game_id",
    "game_url",
    "table_index",
    "team_name",
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

GAME_HEADERS = [
    "division_id",
    "division_label",
    "game_url",
    "game_id",
    "title",
    "game_date",
    "season",
    "venue",
    "league",
]
GAME_URL_HEADERS = ["game_url"]


@dataclass
class DivisionSpec:
    id: str
    label: str
    short_label: str
    calendar_url: str
    standings_url: str
    leaders_url: str
    active: bool
    team_aliases: dict[str, str]


@dataclass
class EventStub:
    url: str
    title: str
    season: str
    schedule_date: str
    time_or_results: str
    venue: str


@dataclass
class ScrapedEvent:
    division_id: str
    division_label: str
    game_key: str
    game_url: str
    title: str
    game_date: datetime.date
    league: str
    season: str
    venue: str
    teams: list[str]
    player_rows: list[dict[str, object]]
    team_totals: list[dict[str, object]]


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\xa0", " ")).strip()


def clean_team_name(value: str) -> str:
    cleaned = normalize_space(value)
    return re.sub(r"\s*\([^)]*\)\s*$", "", cleaned).strip()


def coerce_int(value: str) -> int:
    text = normalize_space(value)
    if text in {"", "-", "â€”"}:
        return 0
    return int(float(text))


def coerce_pct(value: str) -> float:
    text = normalize_space(value)
    if text in {"", "-", "â€”"}:
        return 0.0
    return float(text)


def game_key_from_url(url: str) -> str:
    slug = urlparse(url).path.rstrip("/").split("/")[-1]
    return slug


def coerce_int(value: str) -> int:
    text = normalize_space(value)
    if text in {"", "-"}:
        return 0
    sanitized = re.sub(r"[^0-9.\-]+", "", text)
    if sanitized in {"", "-", ".", "-."}:
        return 0
    return int(float(sanitized))


def coerce_pct(value: str) -> float:
    text = normalize_space(value)
    if text in {"", "-"}:
        return 0.0
    sanitized = re.sub(r"[^0-9.\-]+", "", text)
    if sanitized in {"", "-", ".", "-."}:
        return 0.0
    return float(sanitized)


def csv_path(name: str) -> Path:
    return ROOT_DIR / name


def make_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    return session


def load_division_specs(config_path: Path, requested_ids: set[str] | None = None) -> list[DivisionSpec]:
    with config_path.open("r", encoding="utf-8") as handle:
        raw = yaml.safe_load(handle) or {}

    divisions = raw.get("divisions") or []
    specs: list[DivisionSpec] = []
    seen_ids: set[str] = set()
    for division in divisions:
        division_id = normalize_space(str(division.get("id", "")))
        if not division_id:
            continue
        if requested_ids and division_id not in requested_ids:
            continue
        if not division.get("active", False):
            continue
        if division_id in seen_ids:
            raise ValueError(f"Duplicate active division id in config: {division_id}")
        seen_ids.add(division_id)

        team_aliases: dict[str, str] = {}
        for team in division.get("teams") or []:
            canonical_name = clean_team_name(str(team.get("canonical_name", "")))
            if not canonical_name:
                continue
            team_aliases[canonical_name.lower()] = canonical_name
            for alias in team.get("aliases") or []:
                alias_name = clean_team_name(str(alias))
                if alias_name:
                    team_aliases[alias_name.lower()] = canonical_name

        specs.append(
            DivisionSpec(
                id=division_id,
                label=normalize_space(str(division.get("label", division_id))),
                short_label=normalize_space(str(division.get("short_label", division_id))),
                calendar_url=normalize_space(str(division.get("calendar_url", ""))),
                standings_url=normalize_space(str(division.get("standings_url", ""))),
                leaders_url=normalize_space(str(division.get("leaders_url", ""))),
                active=True,
                team_aliases=team_aliases,
            )
        )

    return specs


def canonicalize_team_name(value: str, division: DivisionSpec) -> str:
    cleaned = clean_team_name(value)
    return division.team_aliases.get(cleaned.lower(), cleaned)


def parse_calendar(session: requests.Session, calendar_url: str) -> list[EventStub]:
    response = session.get(calendar_url, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "lxml")
    table = soup.select_one("table.sp-event-list")
    if table is None:
        raise RuntimeError("Could not find the event list table on the calendar page.")

    events: list[EventStub] = []
    seen: set[str] = set()

    for row in table.select("tbody tr"):
        cells = row.find_all("td")
        if len(cells) < 5:
            continue

        link = cells[1].find("a", href=True)
        if link is None:
            continue

        url = link["href"].strip()
        if url in seen:
            continue
        seen.add(url)

        events.append(
            EventStub(
                url=url,
                title=normalize_space(link.get_text(" ", strip=True)),
                time_or_results=normalize_space(cells[2].get_text(" ", strip=True)),
                season=normalize_space(cells[3].get_text(" ", strip=True)),
                venue=normalize_space(cells[4].get_text(" ", strip=True)),
                schedule_date=normalize_space(cells[0].get_text(" ", strip=True)),
            )
        )

    return events


def parse_details_table(soup: BeautifulSoup) -> dict[str, str]:
    table = soup.select_one("table.sp-event-details")
    if table is None:
        raise RuntimeError("Missing event details table.")

    headers = [normalize_space(th.get_text(" ", strip=True)) for th in table.select("thead th")]
    values = [normalize_space(td.get_text(" ", strip=True)) for td in table.select("tbody td")]
    if len(headers) != len(values):
        raise RuntimeError("Unexpected event details table shape.")

    return dict(zip(headers, values))


def parse_results_teams(soup: BeautifulSoup, division: DivisionSpec) -> list[str]:
    table = soup.select_one("table.sp-event-results")
    if table is None:
        raise RuntimeError("Missing event results table.")

    teams: list[str] = []
    for row in table.select("tbody tr"):
        cells = row.find_all("td")
        if not cells:
            continue
        teams.append(canonicalize_team_name(cells[0].get_text(" ", strip=True), division))

    if len(teams) != 2:
        raise RuntimeError(f"Expected 2 teams in results table, found {len(teams)}.")

    return teams


def parse_performance_tables(
    soup: BeautifulSoup,
    division: DivisionSpec,
    game_key: str,
    game_url: str,
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    player_rows: list[dict[str, object]] = []
    team_totals: list[dict[str, object]] = []

    tables = soup.select("table.sp-event-performance")
    if len(tables) < 2:
        return player_rows, team_totals

    for table_index, table in enumerate(tables, start=1):
        wrapper = table.find_parent("div", class_="sp-template-event-performance")
        if wrapper is None:
            raise RuntimeError("Could not locate the performance table wrapper.")

        caption = wrapper.select_one(".sp-table-caption")
        if caption is None:
            raise RuntimeError("Missing team caption for performance table.")

        team_name = canonicalize_team_name(caption.get_text(" ", strip=True), division)
        if team_name.lower() == "video":
            continue

        rows_for_team: list[dict[str, object]] = []
        for row in table.select("tbody tr"):
            cells = row.find_all("td")
            if len(cells) < 17:
                continue

            values = [normalize_space(cell.get_text(" ", strip=True)) for cell in cells[:17]]
            player_name = normalize_space(values[0])
            if not player_name:
                continue

            stat_row = {
                "division_id": division.id,
                "division_label": division.short_label,
                "player_name": player_name,
                "pts": coerce_int(values[1]),
                "reb": coerce_int(values[2]),
                "ast": coerce_int(values[3]),
                "stl": coerce_int(values[4]),
                "blk": coerce_int(values[5]),
                "fgm": coerce_int(values[6]),
                "fga": coerce_int(values[7]),
                "fg%": coerce_pct(values[8]),
                "3pm": coerce_int(values[9]),
                "3pa": coerce_int(values[10]),
                "3p%": coerce_pct(values[11]),
                "ftm": coerce_int(values[12]),
                "fta": coerce_int(values[13]),
                "ft%": coerce_pct(values[14]),
                "tov": coerce_int(values[15]),
                "pf": coerce_int(values[16]),
                "game_id": game_key,
                "game_url": game_url,
                "table_index": table_index,
                "team_name": team_name,
            }
            rows_for_team.append(stat_row)

        if not rows_for_team:
            continue

        player_rows.extend(rows_for_team)
        total_fga = sum(int(row["fga"]) for row in rows_for_team)
        total_tpa = sum(int(row["3pa"]) for row in rows_for_team)
        total_fta = sum(int(row["fta"]) for row in rows_for_team)
        total_fgm = sum(int(row["fgm"]) for row in rows_for_team)
        total_tpm = sum(int(row["3pm"]) for row in rows_for_team)
        total_ftm = sum(int(row["ftm"]) for row in rows_for_team)

        team_totals.append(
            {
                "division_id": division.id,
                "division_label": division.short_label,
                "game_id": game_key,
                "game_url": game_url,
                "table_index": table_index,
                "team_name": team_name,
                "pts": sum(int(row["pts"]) for row in rows_for_team),
                "reb": sum(int(row["reb"]) for row in rows_for_team),
                "ast": sum(int(row["ast"]) for row in rows_for_team),
                "stl": sum(int(row["stl"]) for row in rows_for_team),
                "blk": sum(int(row["blk"]) for row in rows_for_team),
                "fgm": total_fgm,
                "fga": total_fga,
                "fg%": round(total_fgm / total_fga, 3) if total_fga else 0.0,
                "3pm": total_tpm,
                "3pa": total_tpa,
                "3p%": round(total_tpm / total_tpa, 3) if total_tpa else 0.0,
                "ftm": total_ftm,
                "fta": total_fta,
                "ft%": round(total_ftm / total_fta, 3) if total_fta else 0.0,
                "tov": sum(int(row["tov"]) for row in rows_for_team),
                "pf": sum(int(row["pf"]) for row in rows_for_team),
            }
        )

    return player_rows, team_totals


def parse_event(session: requests.Session, stub: EventStub, division: DivisionSpec) -> ScrapedEvent | None:
    response = session.get(stub.url, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "lxml")
    try:
        details = parse_details_table(soup)
        teams = parse_results_teams(soup, division)
    except RuntimeError:
        return None

    league = details.get("League", "")

    game_date = datetime.strptime(details["Date"], "%B %d, %Y").date()
    source_game_key = game_key_from_url(stub.url)
    game_key = f"{division.id}:{source_game_key}"
    player_rows, team_totals = parse_performance_tables(soup, division, game_key, stub.url)

    if not player_rows or len(team_totals) != 2:
        return None

    return ScrapedEvent(
        division_id=division.id,
        division_label=division.short_label,
        game_key=game_key,
        game_url=stub.url,
        title=stub.title,
        game_date=game_date,
        league=league,
        season=details.get("Season", stub.season),
        venue=stub.venue,
        teams=teams,
        player_rows=player_rows,
        team_totals=team_totals,
    )


def write_csv(path: Path, headers: list[str], rows: Iterable[dict[str, object]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        for row in rows:
            writer.writerow({header: row.get(header, "") for header in headers})


def load_db_env() -> None:
    load_dotenv(ROOT_DIR / ".env")


def get_conn() -> pymysql.Connection:
    return pymysql.connect(
        host=os.getenv("DB_HOST"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        database=os.getenv("DB_NAME"),
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
    )


def assert_required_tables(cur: pymysql.cursors.Cursor) -> None:
    required_tables = {
        "teams",
        "players",
        "d3_games",
        "player_game_stats",
        "player_game_stats_raw",
        "d3_game_stats_raw",
        "team_game_totals",
        "d3_team_game_totals",
    }
    cur.execute("SHOW TABLES")
    present_tables = {next(iter(row.values())) for row in cur.fetchall()}
    missing_tables = sorted(required_tables - present_tables)
    if missing_tables:
        raise RuntimeError(
            "The current DB user cannot create tables and these required tables are missing: "
            + ", ".join(missing_tables)
        )


def truncate_tables(cur: pymysql.cursors.Cursor) -> None:
    for table in [
        "player_game_stats",
        "d3_team_game_totals",
        "team_game_totals",
        "d3_game_stats_raw",
        "player_game_stats_raw",
        "d3_games",
        "players",
        "teams",
    ]:
        cur.execute(f"DELETE FROM {table}")


def insert_lookup_rows(
    cur: pymysql.cursors.Cursor, table: str, column: str, values: Iterable[str]
) -> dict[str, int]:
    unique_values = sorted({value for value in values if value})
    if unique_values:
        cur.executemany(
            f"INSERT INTO {table} ({column}) VALUES (%s)",
            [(value,) for value in unique_values],
        )
    cur.execute(f"SELECT {column}, {table[:-1]}_id AS id FROM {table}")
    return {row[column]: row["id"] for row in cur.fetchall()}


def refresh_database(events: list[ScrapedEvent]) -> None:
    divisions = {event.division_id for event in events}
    if divisions != {"d3_mondays"}:
        raise RuntimeError(
            "Database refresh still targets the legacy single-division schema. "
            "Use --skip-db for multi-division refreshes."
        )

    load_db_env()
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            assert_required_tables(cur)
            truncate_tables(cur)

            team_names = [team for event in events for team in event.teams]
            player_names = [str(row["player_name"]) for event in events for row in event.player_rows]

            team_ids = insert_lookup_rows(cur, "teams", "team_name", team_names)
            player_ids = insert_lookup_rows(cur, "players", "player_name", player_names)

            game_ids = {event.game_key: index for index, event in enumerate(events, start=1)}
            cur.executemany(
                """
                INSERT INTO d3_games (id, game_key, game_url, game_date, team1_id, team2_id)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                [
                    (
                        game_ids[event.game_key],
                        event.game_key,
                        event.game_url,
                        event.game_date,
                        team_ids[event.teams[0]],
                        team_ids[event.teams[1]],
                    )
                    for event in events
                ],
            )

            raw_rows: list[tuple[object, ...]] = []
            raw_rows_d3: list[tuple[object, ...]] = []
            totals_rows: list[tuple[object, ...]] = []
            totals_rows_d3: list[tuple[object, ...]] = []
            normalized_rows: list[tuple[object, ...]] = []

            raw_id = 1
            for event in events:
                opponents_by_index = {
                    1: event.team_totals[1]["team_name"],
                    2: event.team_totals[0]["team_name"],
                }

                for row in event.player_rows:
                    db_row = (
                        raw_id,
                        row["player_name"],
                        row["pts"],
                        row["reb"],
                        row["ast"],
                        row["stl"],
                        row["blk"],
                        row["fgm"],
                        row["fga"],
                        row["fg%"],
                        row["3pm"],
                        row["3pa"],
                        row["3p%"],
                        row["ftm"],
                        row["fta"],
                        row["ft%"],
                        row["tov"],
                        row["pf"],
                        row["game_id"],
                        row["game_url"],
                        row["table_index"],
                        row["team_name"],
                        opponents_by_index[int(row["table_index"])],
                    )
                    raw_rows.append(db_row)
                    raw_rows_d3.append(db_row)
                    raw_id += 1

                    normalized_rows.append(
                        (
                            game_ids[event.game_key],
                            player_ids[str(row["player_name"])],
                            team_ids[str(row["team_name"])],
                            row["pts"],
                            row["reb"],
                            row["ast"],
                            row["blk"],
                            row["stl"],
                            row["tov"],
                            row["pf"],
                            row["fgm"],
                            row["fga"],
                            row["fg%"],
                            row["3pm"],
                            row["3pa"],
                            row["3p%"],
                            row["ftm"],
                            row["fta"],
                            row["ft%"],
                        )
                    )

                for total in event.team_totals:
                    total_row = (
                        total["game_id"],
                        total["game_url"],
                        total["table_index"],
                        total["team_name"],
                        total["pts"],
                        total["reb"],
                        total["ast"],
                        total["stl"],
                        total["blk"],
                        total["fgm"],
                        total["fga"],
                        total["fg%"],
                        total["3pm"],
                        total["3pa"],
                        total["3p%"],
                        total["ftm"],
                        total["fta"],
                        total["ft%"],
                        total["tov"],
                        total["pf"],
                    )
                    totals_rows.append(total_row)
                    totals_rows_d3.append(
                        total_row
                        + (
                            game_ids[event.game_key],
                            team_ids[str(total["team_name"])],
                        )
                    )

            cur.executemany(
                """
                INSERT INTO player_game_stats_raw (
                  id, player_name, pts, reb, ast, stl, blk, fgm, fga, fg_pct, tpm, tpa, tp_pct,
                  ftm, fta, ft_pct, tov, pf, game_id, game_url, table_index, team_name, opponent_name
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                raw_rows,
            )
            cur.executemany(
                """
                INSERT INTO d3_game_stats_raw (
                  id, player_name, pts, reb, ast, stl, blk, fgm, fga, fg_pct, tpm, tpa, tp_pct,
                  ftm, fta, ft_pct, tov, pf, game_id, game_url, table_index, team_name, opponent_name
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                raw_rows_d3,
            )
            cur.executemany(
                """
                INSERT INTO team_game_totals (
                  game_id, game_url, table_index, team_name, pts, reb, ast, stl, blk, fgm, fga, `fg%`,
                  `3pm`, `3pa`, `3p%`, ftm, fta, `ft%`, tov, pf
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                totals_rows,
            )
            cur.executemany(
                """
                INSERT INTO d3_team_game_totals (
                  game_id, game_url, table_index, team_name, pts, reb, ast, stl, blk, fgm, fga, `fg%`,
                  `3pm`, `3pa`, `3p%`, ftm, fta, `ft%`, tov, pf, game_id_int, team_id
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                totals_rows_d3,
            )
            cur.executemany(
                """
                INSERT INTO player_game_stats (
                  game_id, player_id, team_id, pts, reb, ast, blk, stl, tov, fouls,
                  fgm, fga, fg_pct, tpm, tpa, tp_pct, ftm, fta, ft_pct
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                normalized_rows,
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def write_snapshot_files(events: list[ScrapedEvent]) -> None:
    game_rows = [
        {
            "division_id": event.division_id,
            "division_label": event.division_label,
            "game_url": event.game_url,
            "game_id": event.game_key,
            "title": event.title,
            "game_date": event.game_date.isoformat(),
            "season": event.season,
            "venue": event.venue,
            "league": event.league,
        }
        for event in events
    ]
    game_url_rows = [{"game_url": event.game_url} for event in events]
    player_rows = [row for event in events for row in event.player_rows]
    team_total_rows = [row for event in events for row in event.team_totals]

    write_csv(csv_path("games.csv"), GAME_HEADERS, game_rows)
    write_csv(csv_path("game_urls.csv"), GAME_URL_HEADERS, game_url_rows)
    write_csv(csv_path("player_game_stats.csv"), PLAYER_HEADERS, player_rows)
    write_csv(csv_path("team_game_totals.csv"), TEAM_TOTAL_HEADERS, team_total_rows)


def scrape_division(session: requests.Session, division: DivisionSpec) -> list[ScrapedEvent]:
    stubs = parse_calendar(session, division.calendar_url)
    events: list[ScrapedEvent] = []
    for stub in stubs:
        event = parse_event(session, stub, division)
        if event is not None:
            events.append(event)

    events.sort(key=lambda event: (event.game_date, event.game_key))
    return events


def format_summary(events: list[ScrapedEvent]) -> str:
    counter = Counter(event.division_label for event in events)
    parts = [f"{label}: {counter[label]} games" for label in sorted(counter)]
    return ", ".join(parts)


def main(default_division_ids: list[str] | None = None, description: str | None = None) -> None:
    parser = argparse.ArgumentParser(
        description=description or "Refresh active divisions from division_specs.yaml."
    )
    parser.add_argument(
        "--config",
        default=str(DEFAULT_CONFIG_PATH),
        help="Path to the YAML division config.",
    )
    parser.add_argument(
        "--division",
        action="append",
        dest="division_ids",
        help="Division id to refresh. Can be passed multiple times. Defaults to all active divisions.",
    )
    parser.add_argument(
        "--skip-db",
        action="store_true",
        help="Scrape and rewrite CSV snapshots only.",
    )
    parser.add_argument(
        "--validate-config",
        action="store_true",
        help="Validate the YAML config and print the active divisions without scraping.",
    )
    args = parser.parse_args()

    requested_ids = set(args.division_ids or default_division_ids or [])
    specs = load_division_specs(Path(args.config), requested_ids or None)
    if not specs:
        raise SystemExit("No active divisions matched the current config/filters.")

    if args.validate_config:
        for spec in specs:
            print(f"{spec.id}: {spec.label} -> {spec.calendar_url}")
        return

    session = make_session()
    events: list[ScrapedEvent] = []
    for spec in specs:
        events.extend(scrape_division(session, spec))

    events.sort(key=lambda event: (event.game_date, event.division_id, event.game_key))
    if not events:
        raise SystemExit("No completed events were scraped from the active divisions.")

    write_snapshot_files(events)
    if not args.skip_db:
        refresh_database(events)

    latest_date = max(event.game_date for event in events)
    print(
        f"Refreshed {len(events)} completed games across {len(specs)} divisions, "
        f"{sum(len(event.player_rows) for event in events)} player rows, latest date {latest_date}. "
        f"{format_summary(events)}."
    )


if __name__ == "__main__":
    main()
