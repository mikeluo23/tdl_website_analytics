import csv
import os
from collections import defaultdict
from datetime import datetime
from functools import lru_cache
from pathlib import Path

import pymysql
import psycopg
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from psycopg.rows import dict_row

ROOT_DIR = Path(__file__).resolve().parent
load_dotenv(ROOT_DIR / ".env")

DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
]

DATA_SOURCE = os.getenv("DATA_SOURCE", "csv").strip().lower()
ENABLE_HISTORICAL_DATA = os.getenv("ENABLE_HISTORICAL_DATA", "0").strip().lower() not in {
    "",
    "0",
    "false",
    "no",
}
POSTGRES_ANALYTICS = os.getenv("POSTGRES_ANALYTICS", "0").strip().lower() not in {
    "",
    "0",
    "false",
    "no",
}
CSV_FILES = [
    ROOT_DIR / "games.csv",
    ROOT_DIR / "player_game_stats.csv",
    ROOT_DIR / "team_game_totals.csv",
]
HISTORICAL_CSV_FILES = [
    ROOT_DIR / "historical_games.csv",
    ROOT_DIR / "historical_player_game_stats.csv",
    ROOT_DIR / "historical_team_game_totals.csv",
]

app = FastAPI(title="TDL Advanced Stats API")


def parse_allowed_origins():
    raw_value = os.getenv("CORS_ORIGINS", "")
    parsed = [origin.strip() for origin in raw_value.split(",") if origin.strip()]
    return parsed or DEFAULT_ALLOWED_ORIGINS


app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_conn():
    return pymysql.connect(
        host=os.getenv("DB_HOST"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        database=os.getenv("DB_NAME"),
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
    )


def get_postgres_conn():
    return psycopg.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "5432")),
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        row_factory=dict_row,
    )


def normalize_space(value):
    return " ".join(str(value or "").replace("\xa0", " ").split())


def clean_team_name(value):
    text = normalize_space(value)
    if text.endswith(")") and "(" in text:
        text = text[: text.rfind("(")].strip()
    return text


def to_int(value):
    text = normalize_space(value)
    if text in {"", "-", "—"}:
        return 0
    return int(float(text))


def to_float(value):
    text = normalize_space(value)
    if text in {"", "-", "—"}:
        return 0.0
    return float(text)


def csv_snapshot_key():
    tracked_files = list(CSV_FILES)
    if ENABLE_HISTORICAL_DATA:
        tracked_files.extend(HISTORICAL_CSV_FILES)
    return tuple(path.stat().st_mtime_ns if path.exists() else 0 for path in tracked_files)


def read_csv_rows(path: Path):
    if not path.exists():
        raise FileNotFoundError(f"Missing CSV snapshot: {path}")
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def read_optional_csv_rows(path: Path):
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def season_parts(value):
    text = normalize_space(value)
    compact = text.replace(" ", "")
    if len(compact) >= 5 and compact[:4].isdigit():
        return compact, compact[:4], compact[4:].upper()
    return text, "", ""


@lru_cache(maxsize=4)
def _load_csv_store(_snapshot_key):
    games_rows = read_csv_rows(ROOT_DIR / "games.csv")
    player_rows_raw = read_csv_rows(ROOT_DIR / "player_game_stats.csv")
    team_totals_raw = read_csv_rows(ROOT_DIR / "team_game_totals.csv")
    if ENABLE_HISTORICAL_DATA:
        historical_games_rows = read_optional_csv_rows(ROOT_DIR / "historical_games.csv")
        historical_player_rows = read_optional_csv_rows(
            ROOT_DIR / "historical_player_game_stats.csv"
        )
        historical_team_totals = read_optional_csv_rows(
            ROOT_DIR / "historical_team_game_totals.csv"
        )
    else:
        historical_games_rows = []
        historical_player_rows = []
        historical_team_totals = []

    seen_game_urls = {
        normalize_space(row.get("game_url")) for row in games_rows if normalize_space(row.get("game_url"))
    }
    historical_game_urls = set()
    allowed_historical_game_urls = set()
    normalized_historical_games = []
    for row in historical_games_rows:
        game_url = normalize_space(row.get("game_url"))
        if not game_url or game_url in seen_game_urls or game_url in historical_game_urls:
            continue
        historical_game_urls.add(game_url)
        allowed_historical_game_urls.add(game_url)
        normalized_historical_games.append(
            {
                "division_id": normalize_space(row.get("division_id")),
                "division_label": normalize_space(row.get("division_label")),
                "game_url": game_url,
                "game_id": normalize_space(row.get("game_id")),
                "title": normalize_space(row.get("title")),
                "game_date": normalize_space(row.get("game_date")),
                "season": normalize_space(row.get("season_code") or row.get("season")),
                "season_year": normalize_space(row.get("season_year")),
                "season_term": normalize_space(row.get("season_term")).upper(),
                "venue": normalize_space(row.get("venue")),
                "league": normalize_space(row.get("league")),
            }
        )
    games_rows.extend(normalized_historical_games)

    player_rows_raw.extend(
        [
            {
                "division_id": normalize_space(row.get("division_id")),
                "division_label": normalize_space(row.get("division_label")),
                "player_name": normalize_space(row.get("player_name")),
                "pts": normalize_space(row.get("pts")),
                "reb": normalize_space(row.get("reb")),
                "ast": normalize_space(row.get("ast")),
                "stl": normalize_space(row.get("stl")),
                "blk": normalize_space(row.get("blk")),
                "fgm": normalize_space(row.get("fgm")),
                "fga": normalize_space(row.get("fga")),
                "fg%": normalize_space(row.get("fg%")),
                "3pm": normalize_space(row.get("3pm")),
                "3pa": normalize_space(row.get("3pa")),
                "3p%": normalize_space(row.get("3p%")),
                "ftm": normalize_space(row.get("ftm")),
                "fta": normalize_space(row.get("fta")),
                "ft%": normalize_space(row.get("ft%")),
                "tov": normalize_space(row.get("tov")),
                "pf": normalize_space(row.get("pf")),
                "game_id": normalize_space(row.get("game_id")),
                "game_url": normalize_space(row.get("game_url")),
                "table_index": normalize_space(row.get("table_index")),
                "team_name": clean_team_name(row.get("team_name")),
            }
            for row in historical_player_rows
            if normalize_space(row.get("game_url")) in allowed_historical_game_urls
        ]
    )
    team_totals_raw.extend(
        [
            {
                "division_id": normalize_space(row.get("division_id")),
                "division_label": normalize_space(row.get("division_label")),
                "game_id": normalize_space(row.get("game_id")),
                "game_url": normalize_space(row.get("game_url")),
                "table_index": normalize_space(row.get("table_index")),
                "team_name": clean_team_name(row.get("team_name")),
                "pts": normalize_space(row.get("pts")),
                "reb": normalize_space(row.get("reb")),
                "ast": normalize_space(row.get("ast")),
                "stl": normalize_space(row.get("stl")),
                "blk": normalize_space(row.get("blk")),
                "fgm": normalize_space(row.get("fgm")),
                "fga": normalize_space(row.get("fga")),
                "fg%": normalize_space(row.get("fg%")),
                "3pm": normalize_space(row.get("3pm")),
                "3pa": normalize_space(row.get("3pa")),
                "3p%": normalize_space(row.get("3p%")),
                "ftm": normalize_space(row.get("ftm")),
                "fta": normalize_space(row.get("fta")),
                "ft%": normalize_space(row.get("ft%")),
                "tov": normalize_space(row.get("tov")),
                "pf": normalize_space(row.get("pf")),
            }
            for row in historical_team_totals
            if normalize_space(row.get("game_url")) in allowed_historical_game_urls
        ]
    )

    team_totals_by_game = defaultdict(list)
    for row in team_totals_raw:
        game_key = normalize_space(row.get("game_id"))
        total_row = {
            "division_id": normalize_space(row.get("division_id")),
            "division_label": normalize_space(row.get("division_label")),
            "game_key": game_key,
            "game_url": normalize_space(row.get("game_url")),
            "table_index": to_int(row.get("table_index")),
            "team_name": clean_team_name(row.get("team_name")),
            "pts": to_int(row.get("pts")),
            "reb": to_int(row.get("reb")),
            "ast": to_int(row.get("ast")),
            "stl": to_int(row.get("stl")),
            "blk": to_int(row.get("blk")),
            "fgm": to_int(row.get("fgm")),
            "fga": to_int(row.get("fga")),
            "fg_pct": to_float(row.get("fg%")),
            "tpm": to_int(row.get("3pm")),
            "tpa": to_int(row.get("3pa")),
            "tp_pct": to_float(row.get("3p%")),
            "ftm": to_int(row.get("ftm")),
            "fta": to_int(row.get("fta")),
            "ft_pct": to_float(row.get("ft%")),
            "tov": to_int(row.get("tov")),
            "pf": to_int(row.get("pf")),
        }
        team_totals_by_game[game_key].append(total_row)

    game_keys_in_order = []
    game_meta_by_key = {}
    for row in games_rows:
        game_key = normalize_space(row.get("game_id"))
        if not game_key:
            continue
        game_keys_in_order.append(game_key)
        game_meta_by_key[game_key] = {
            "division_id": normalize_space(row.get("division_id")),
            "division_label": normalize_space(row.get("division_label")),
            "game_key": game_key,
            "game_url": normalize_space(row.get("game_url")),
            "title": normalize_space(row.get("title")),
            "game_date": normalize_space(row.get("game_date")),
            "season": normalize_space(row.get("season")),
            "season_year": normalize_space(row.get("season_year")),
            "season_term": normalize_space(row.get("season_term")).upper(),
            "venue": normalize_space(row.get("venue")),
            "league": normalize_space(row.get("league")),
        }
        if not game_meta_by_key[game_key]["season_year"] and game_meta_by_key[game_key]["season"]:
            _, season_year, season_term = season_parts(game_meta_by_key[game_key]["season"])
            game_meta_by_key[game_key]["season_year"] = season_year
            game_meta_by_key[game_key]["season_term"] = season_term

    for row in player_rows_raw:
        game_key = normalize_space(row.get("game_id"))
        if game_key and game_key not in game_meta_by_key:
            game_keys_in_order.append(game_key)
            game_meta_by_key[game_key] = {
                "division_id": normalize_space(row.get("division_id")),
                "division_label": normalize_space(row.get("division_label")),
                "game_key": game_key,
                "game_url": normalize_space(row.get("game_url")),
                "title": game_key.replace("-", " "),
                "game_date": "",
                "season": "",
                "season_year": "",
                "season_term": "",
                "venue": "",
                "league": "",
            }

    ordered_teams = []
    for game_key in game_keys_in_order:
        totals = sorted(team_totals_by_game.get(game_key, []), key=lambda row: row["table_index"])
        for total in totals:
            team_key = (total["division_id"], total["team_name"])
            if total["team_name"] and team_key not in ordered_teams:
                ordered_teams.append(team_key)

    team_id_by_key = {name: index for index, name in enumerate(ordered_teams, start=1)}

    player_names = sorted(
        {
            normalize_space(row.get("player_name"))
            for row in player_rows_raw
            if normalize_space(row.get("player_name"))
        }
    )
    player_id_by_name = {name: index for index, name in enumerate(player_names, start=1)}

    game_id_by_key = {game_key: index for index, game_key in enumerate(game_keys_in_order, start=1)}

    games = []
    for game_key in game_keys_in_order:
        meta = game_meta_by_key[game_key]
        totals = sorted(team_totals_by_game.get(game_key, []), key=lambda row: row["table_index"])
        team1_name = totals[0]["team_name"] if len(totals) > 0 else ""
        team2_name = totals[1]["team_name"] if len(totals) > 1 else ""
        team1_pts = totals[0]["pts"] if len(totals) > 0 else 0
        team2_pts = totals[1]["pts"] if len(totals) > 1 else 0
        games.append(
            {
                "game_id": game_id_by_key[game_key],
                "game_key": game_key,
                "division_id": meta["division_id"],
                "division_label": meta["division_label"],
                "game_url": meta["game_url"],
                "game_date": meta["game_date"],
                "team1_id": team_id_by_key.get((meta["division_id"], team1_name)),
                "team1_name": team1_name,
                "team1_pts": team1_pts,
                "team2_id": team_id_by_key.get((meta["division_id"], team2_name)),
                "team2_name": team2_name,
                "team2_pts": team2_pts,
                "season": meta["season"],
                "season_year": meta["season_year"],
                "season_term": meta["season_term"],
                "venue": meta["venue"],
                "league": meta["league"],
            }
        )

    player_game_rows = []
    for row in player_rows_raw:
        game_key = normalize_space(row.get("game_id"))
        player_name = normalize_space(row.get("player_name"))
        team_name = clean_team_name(row.get("team_name"))
        player_game_rows.append(
            {
                "game_id": game_id_by_key[game_key],
                "game_key": game_key,
                "division_id": game_meta_by_key[game_key]["division_id"],
                "division_label": game_meta_by_key[game_key]["division_label"],
                "game_url": normalize_space(row.get("game_url")),
                "game_date": game_meta_by_key[game_key]["game_date"],
                "season": game_meta_by_key[game_key]["season"],
                "season_year": game_meta_by_key[game_key]["season_year"],
                "season_term": game_meta_by_key[game_key]["season_term"],
                "player_id": player_id_by_name[player_name],
                "player_name": player_name,
                "team_id": team_id_by_key[(game_meta_by_key[game_key]["division_id"], team_name)],
                "team_name": team_name,
                "pts": to_int(row.get("pts")),
                "reb": to_int(row.get("reb")),
                "ast": to_int(row.get("ast")),
                "stl": to_int(row.get("stl")),
                "blk": to_int(row.get("blk")),
                "tov": to_int(row.get("tov")),
                "fouls": to_int(row.get("pf")),
                "fgm": to_int(row.get("fgm")),
                "fga": to_int(row.get("fga")),
                "fg_pct": to_float(row.get("fg%")),
                "tpm": to_int(row.get("3pm")),
                "tpa": to_int(row.get("3pa")),
                "tp_pct": to_float(row.get("3p%")),
                "ftm": to_int(row.get("ftm")),
                "fta": to_int(row.get("fta")),
                "ft_pct": to_float(row.get("ft%")),
                "table_index": to_int(row.get("table_index")),
            }
        )

    players = [
        {"player_id": player_id_by_name[name], "player_name": name}
        for name in player_names
    ]
    teams = [
        {
            "team_id": team_id_by_key[(division_id, name)],
            "division_id": division_id,
            "division_label": next(
                (
                    row["division_label"]
                    for row in team_totals_raw
                    if normalize_space(row.get("division_id")) == division_id
                    and clean_team_name(row.get("team_name")) == name
                ),
                "",
            ),
            "team_name": name,
        }
        for division_id, name in ordered_teams
    ]

    return {
        "games": games,
        "player_game_rows": player_game_rows,
        "players": players,
        "teams": teams,
        "team_totals": [
            {
                **row,
                "game_id_int": game_id_by_key.get(row["game_key"]),
                "team_id": team_id_by_key.get((row["division_id"], row["team_name"])),
                "game_date": game_meta_by_key[row["game_key"]]["game_date"],
                "season": game_meta_by_key[row["game_key"]]["season"],
                "season_year": game_meta_by_key[row["game_key"]]["season_year"],
                "season_term": game_meta_by_key[row["game_key"]]["season_term"],
            }
            for totals in team_totals_by_game.values()
            for row in totals
        ],
    }


def get_csv_store():
    return _load_csv_store(csv_snapshot_key())


def csv_enabled():
    return DATA_SOURCE != "db"


def postgres_analytics_enabled():
    return POSTGRES_ANALYTICS


@lru_cache(maxsize=8)
def fetch_postgres_divisions():
    sql = """
    WITH game_counts AS (
      SELECT division_id, MIN(division_label) AS division_label, COUNT(*) AS games
      FROM games
      GROUP BY division_id
    ),
    team_counts AS (
      SELECT division_id, COUNT(DISTINCT team_id) AS teams
      FROM teams
      GROUP BY division_id
    ),
    player_counts AS (
      SELECT division_id, COUNT(DISTINCT player_id) AS players
      FROM player_game_stats
      GROUP BY division_id
    )
    SELECT
      gc.division_id,
      gc.division_label,
      gc.games,
      COALESCE(tc.teams, 0) AS teams,
      COALESCE(pc.players, 0) AS players
    FROM game_counts gc
    LEFT JOIN team_counts tc ON tc.division_id = gc.division_id
    LEFT JOIN player_counts pc ON pc.division_id = gc.division_id
    ORDER BY gc.division_label
    """
    with get_postgres_conn() as conn, conn.cursor() as cur:
        cur.execute(sql)
        return cur.fetchall()


@lru_cache(maxsize=32)
def fetch_postgres_season_options(division_id=""):
    sql = """
    SELECT DISTINCT season_year, season_term
    FROM games
    WHERE (%s = '' OR division_id = %s)
      AND COALESCE(season_year, '') <> ''
      AND COALESCE(season_term, '') <> ''
    """
    with get_postgres_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, (division_id, division_id))
        rows = cur.fetchall()

    years = {normalize_year(row.get("season_year")) for row in rows if row.get("season_year")}
    season_terms = {
        normalize_season_term(row.get("season_term"))
        for row in rows
        if row.get("season_term")
    }
    terms_by_year = defaultdict(set)
    for row in rows:
        year = normalize_year(row.get("season_year"))
        season_term_value = normalize_season_term(row.get("season_term"))
        if year and season_term_value:
            terms_by_year[year].add(season_term_value)

    sorted_years = sorted(years, reverse=True)
    sorted_terms = sorted(season_terms, key=season_term_sort_key)
    return {
        "years": sorted_years,
        "season_terms": sorted_terms,
        "year_terms": [
            {
                "year": year,
                "season_terms": sorted(terms_by_year.get(year, set()), key=season_term_sort_key),
            }
            for year in sorted_years
        ],
    }


@lru_cache(maxsize=256)
def fetch_postgres_player_identity(player_id: int):
    sql = """
    SELECT
      p.player_id,
      p.player_name,
      COUNT(DISTINCT pgs.division_id) AS division_count,
      ARRAY_AGG(DISTINCT pgs.division_id ORDER BY pgs.division_id) AS division_ids,
      ARRAY_AGG(DISTINCT pgs.division_label ORDER BY pgs.division_label) AS division_labels
    FROM players p
    JOIN player_game_stats pgs ON pgs.player_id = p.player_id
    WHERE p.player_id = %s
    GROUP BY p.player_id, p.player_name
    """
    with get_postgres_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, (player_id,))
        return cur.fetchone()


@lru_cache(maxsize=512)
def fetch_postgres_game_summary(game_id: int):
    sql = """
    SELECT
      g.game_id,
      g.game_key,
      g.division_id,
      g.division_label,
      g.game_url,
      COALESCE(TO_CHAR(g.game_date, 'FMMonth FMDD, YYYY'), '') AS game_date,
      g.team1_name,
      g.team1_pts,
      g.team2_name,
      g.team2_pts,
      g.season,
      g.season_year,
      g.season_term,
      g.venue,
      g.league
    FROM games g
    WHERE g.game_id = %s
    """
    with get_postgres_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, (game_id,))
        return cur.fetchone()


def normalize_division_id(value):
    return normalize_space(value)


def matches_division(row, division_id):
    if not division_id:
        return True
    return normalize_division_id(row.get("division_id")) == division_id


def normalize_year(value):
    return normalize_space(value)


def normalize_season_term(value):
    return normalize_space(value).upper()


def matches_year(row, year):
    if not year:
        return True
    return normalize_year(row.get("season_year")) == year


def matches_season_term(row, season_term):
    if not season_term:
        return True
    return normalize_season_term(row.get("season_term")) == season_term


def matches_filters(row, division_id, year, season_term):
    return (
        matches_division(row, division_id)
        and matches_year(row, year)
        and matches_season_term(row, season_term)
    )


def season_term_sort_key(term):
    order = {"W": 0, "SP": 1, "S": 1, "SU": 2, "SUMMER": 2, "F": 3}
    normalized = normalize_season_term(term)
    return (order.get(normalized, 99), normalized)


def parse_game_date(value):
    text = normalize_space(value)
    if not text:
        return None
    for fmt in ("%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def game_date_sort_value(value):
    parsed = parse_game_date(value)
    return parsed.toordinal() if parsed else -1


def season_sort_value(row):
    year = normalize_year(row.get("season_year"))
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        year_value = 0

    term_order, normalized_term = season_term_sort_key(row.get("season_term"))
    return (year_value, term_order, normalized_term)


def sort_games(rows, sort_by):
    if sort_by == "date_asc":
        return sorted(
            rows,
            key=lambda row: (
                game_date_sort_value(row.get("game_date")),
                season_sort_value(row),
                normalize_space(row.get("division_label")),
                row.get("game_id", 0),
            ),
        )
    if sort_by == "season_desc":
        return sorted(
            rows,
            key=lambda row: (
                season_sort_value(row),
                game_date_sort_value(row.get("game_date")),
                normalize_space(row.get("division_label")),
                row.get("game_id", 0),
            ),
            reverse=True,
        )
    if sort_by == "season_asc":
        return sorted(
            rows,
            key=lambda row: (
                season_sort_value(row),
                game_date_sort_value(row.get("game_date")),
                normalize_space(row.get("division_label")),
                row.get("game_id", 0),
            ),
        )
    if sort_by == "division_asc":
        return sorted(
            rows,
            key=lambda row: (
                normalize_space(row.get("division_label")),
                season_sort_value(row),
                game_date_sort_value(row.get("game_date")),
                row.get("game_id", 0),
            ),
        )
    if sort_by == "division_desc":
        return sorted(
            rows,
            key=lambda row: (
                normalize_space(row.get("division_label")),
                season_sort_value(row),
                game_date_sort_value(row.get("game_date")),
                row.get("game_id", 0),
            ),
            reverse=True,
        )
    return sorted(
        rows,
        key=lambda row: (
            game_date_sort_value(row.get("game_date")),
            season_sort_value(row),
            normalize_space(row.get("division_label")),
            row.get("game_id", 0),
        ),
        reverse=True,
    )


def postgres_filter_sql(alias):
    return f"""
        (%s = '' OR {alias}.division_id = %s)
        AND (%s = '' OR COALESCE({alias}.season_year, '') = %s)
        AND (%s = '' OR COALESCE({alias}.season_term, '') = %s)
    """


def postgres_season_order_sql(alias):
    return f"""
        COALESCE(NULLIF({alias}.season_year, ''), '0')::int,
        CASE COALESCE({alias}.season_term, '')
            WHEN 'W' THEN 0
            WHEN 'SP' THEN 1
            WHEN 'S' THEN 1
            WHEN 'SU' THEN 2
            WHEN 'SUMMER' THEN 2
            WHEN 'F' THEN 3
            ELSE 99
        END,
        COALESCE({alias}.season_term, '')
    """


def postgres_game_order_clause(sort_by, alias="g"):
    season_order = postgres_season_order_sql(alias)
    mapping = {
        "date_desc": f"{alias}.game_date DESC NULLS LAST, {season_order} DESC, {alias}.game_id DESC",
        "date_asc": f"{alias}.game_date ASC NULLS LAST, {season_order} ASC, {alias}.game_id ASC",
        "season_desc": f"{season_order} DESC, {alias}.game_date DESC NULLS LAST, {alias}.game_id DESC",
        "season_asc": f"{season_order} ASC, {alias}.game_date ASC NULLS LAST, {alias}.game_id ASC",
        "division_asc": f"{alias}.division_label ASC, {season_order} DESC, {alias}.game_date DESC NULLS LAST, {alias}.game_id DESC",
        "division_desc": f"{alias}.division_label DESC, {season_order} DESC, {alias}.game_date DESC NULLS LAST, {alias}.game_id DESC",
    }
    return mapping[sort_by]


@lru_cache(maxsize=64)
def fetch_postgres_team_analytics(division_id="", season_year="", season_term=""):
    sql = f"""
    WITH filtered_games AS (
      SELECT *
      FROM games g
      WHERE {postgres_filter_sql('g')}
        AND g.team1_id IS NOT NULL
        AND g.team2_id IS NOT NULL
    ),
    pairings AS (
      SELECT
        g.game_id,
        g.division_id,
        g.division_label,
        g.team1_id AS team_id,
        g.team1_name AS team_name,
        g.team1_pts AS points_for,
        g.team2_id AS opponent_id,
        g.team2_pts AS points_against
      FROM filtered_games g
      UNION ALL
      SELECT
        g.game_id,
        g.division_id,
        g.division_label,
        g.team2_id AS team_id,
        g.team2_name AS team_name,
        g.team2_pts AS points_for,
        g.team1_id AS opponent_id,
        g.team1_pts AS points_against
      FROM filtered_games g
    ),
    team_base AS (
      SELECT
        p.team_id,
        MIN(p.team_name) AS team_name,
        MIN(p.division_id) AS division_id,
        MIN(p.division_label) AS division_label,
        COUNT(*) AS games_played,
        SUM(CASE WHEN p.points_for > p.points_against THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN p.points_for < p.points_against THEN 1 ELSE 0 END) AS losses,
        SUM(CASE WHEN p.points_for = p.points_against THEN 1 ELSE 0 END) AS ties,
        AVG(p.points_for::float8) AS offensive_rating_raw,
        AVG(p.points_against::float8) AS defensive_rating_raw,
        AVG((p.points_for - p.points_against)::float8) AS net_rating_raw,
        AVG((CASE WHEN p.points_for > p.points_against THEN 1 ELSE 0 END)::float8) AS win_pct_raw
      FROM pairings p
      GROUP BY p.team_id
    ),
    league_avg AS (
      SELECT COALESCE(AVG(points_for::float8), 0) AS league_average_points
      FROM pairings
    ),
    opponent_stats AS (
      SELECT
        p.team_id,
        COALESCE(AVG(tb.win_pct_raw), 0) AS opponent_win_pct,
        COALESCE(AVG(tb.net_rating_raw), 0) AS strength_of_schedule,
        COALESCE(AVG(tb.offensive_rating_raw), 0) AS average_opponent_offense,
        COALESCE(AVG(tb.defensive_rating_raw), 0) AS average_opponent_defense
      FROM pairings p
      JOIN team_base tb ON tb.team_id = p.opponent_id
      GROUP BY p.team_id
    )
    SELECT
      tb.team_id,
      tb.team_name,
      tb.division_id,
      tb.division_label,
      tb.games_played,
      tb.wins,
      tb.losses,
      tb.ties,
      ROUND(tb.win_pct_raw::numeric, 4)::float8 AS win_pct,
      ROUND(tb.offensive_rating_raw::numeric, 4)::float8 AS offensive_rating,
      ROUND(tb.defensive_rating_raw::numeric, 4)::float8 AS defensive_rating,
      ROUND(tb.net_rating_raw::numeric, 4)::float8 AS net_rating,
      ROUND(os.strength_of_schedule::numeric, 4)::float8 AS strength_of_schedule,
      ROUND(os.opponent_win_pct::numeric, 4)::float8 AS opponent_win_pct,
      ROUND((tb.offensive_rating_raw - os.average_opponent_defense + la.league_average_points)::numeric, 4)::float8 AS adjusted_offensive_rating,
      ROUND((tb.defensive_rating_raw - os.average_opponent_offense + la.league_average_points)::numeric, 4)::float8 AS adjusted_defensive_rating,
      ROUND(((tb.offensive_rating_raw - os.average_opponent_defense + la.league_average_points) - (tb.defensive_rating_raw - os.average_opponent_offense + la.league_average_points))::numeric, 4)::float8 AS adjusted_net_rating
    FROM team_base tb
    LEFT JOIN opponent_stats os ON os.team_id = tb.team_id
    CROSS JOIN league_avg la
    ORDER BY tb.wins DESC, tb.losses ASC, adjusted_net_rating DESC, tb.team_name ASC
    """
    params = (division_id, division_id, season_year, season_year, season_term, season_term)
    with get_postgres_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


@lru_cache(maxsize=64)
def fetch_postgres_players(division_id="", season_year="", season_term=""):
    sql = f"""
    SELECT
      p.player_id,
      p.player_name,
      COUNT(DISTINCT pgs.division_id) AS division_count,
      ARRAY_AGG(DISTINCT pgs.division_id ORDER BY pgs.division_id) AS division_ids,
      ARRAY_AGG(DISTINCT pgs.division_label ORDER BY pgs.division_label) AS division_labels
    FROM players p
    JOIN player_game_stats pgs ON pgs.player_id = p.player_id
    WHERE {postgres_filter_sql('pgs')}
    GROUP BY p.player_id, p.player_name
    ORDER BY p.player_name
    """
    with get_postgres_conn() as conn, conn.cursor() as cur:
        cur.execute(
            sql,
            (
                division_id,
                division_id,
                season_year,
                season_year,
                season_term,
                season_term,
            ),
        )
        return cur.fetchall()


@lru_cache(maxsize=128)
def fetch_postgres_games(
    division_id="",
    season_year="",
    season_term="",
    sort_by="date_desc",
    limit=100,
    offset=0,
):
    sql = f"""
    SELECT
      g.game_id,
      g.game_key,
      g.division_id,
      g.division_label,
      g.game_url,
      COALESCE(TO_CHAR(g.game_date, 'FMMonth FMDD, YYYY'), '') AS game_date,
      g.team1_id,
      g.team1_name,
      g.team1_pts,
      g.team2_id,
      g.team2_name,
      g.team2_pts,
      g.season,
      g.season_year,
      g.season_term,
      g.venue,
      g.league
    FROM games g
    WHERE {postgres_filter_sql('g')}
    ORDER BY {postgres_game_order_clause(sort_by, 'g')}
    LIMIT %s OFFSET %s
    """
    with get_postgres_conn() as conn, conn.cursor() as cur:
        cur.execute(
            sql,
            (
                division_id,
                division_id,
                season_year,
                season_year,
                season_term,
                season_term,
                limit,
                offset,
            ),
        )
        return cur.fetchall()


@lru_cache(maxsize=128)
def fetch_postgres_leaderboard(sort="pts", limit=50, division_id="", season_year="", season_term=""):
    order_columns = {
        "pts": "pts",
        "reb": "reb",
        "ast": "ast",
        "stl": "stl",
        "blk": "blk",
        "tpm": "tpm",
    }
    if sort not in order_columns:
        raise HTTPException(
            status_code=400,
            detail=f"sort must be one of {sorted(order_columns)}",
        )

    sql = f"""
    SELECT
      pst.player_id,
      pst.player_name,
      SUM(pst.games_played) AS games_played,
      COUNT(DISTINCT pst.division_id) AS division_count,
      ARRAY_AGG(DISTINCT pst.division_id ORDER BY pst.division_id) AS division_ids,
      ARRAY_AGG(DISTINCT pst.division_label ORDER BY pst.division_label) AS division_labels,
      SUM(pst.pts) AS pts,
      SUM(pst.reb) AS reb,
      SUM(pst.ast) AS ast,
      SUM(pst.stl) AS stl,
      SUM(pst.blk) AS blk,
      SUM(pst.tov) AS tov,
      SUM(pst.fouls) AS fouls,
      SUM(pst.fgm) AS fgm,
      SUM(pst.fga) AS fga,
      CASE
        WHEN SUM(pst.fga) = 0 THEN 0
        ELSE ROUND(SUM(pst.fgm)::numeric / SUM(pst.fga), 4)
      END AS fg_pct,
      SUM(pst.tpm) AS tpm,
      SUM(pst.tpa) AS tpa,
      CASE
        WHEN SUM(pst.tpa) = 0 THEN 0
        ELSE ROUND(SUM(pst.tpm)::numeric / SUM(pst.tpa), 4)
      END AS tp_pct,
      SUM(pst.ftm) AS ftm,
      SUM(pst.fta) AS fta,
      CASE
        WHEN SUM(pst.fta) = 0 THEN 0
        ELSE ROUND(SUM(pst.ftm)::numeric / SUM(pst.fta), 4)
      END AS ft_pct
    FROM player_season_totals pst
    WHERE (%s = '' OR pst.division_id = %s)
      AND (%s = '' OR COALESCE(pst.season_year, '') = %s)
      AND (%s = '' OR COALESCE(pst.season_term, '') = %s)
    GROUP BY pst.player_id, pst.player_name
    ORDER BY {order_columns[sort]} DESC, pst.player_name ASC
    LIMIT %s
    """
    with get_postgres_conn() as conn, conn.cursor() as cur:
        cur.execute(
            sql,
            (
                division_id,
                division_id,
                season_year,
                season_year,
                season_term,
                season_term,
                limit,
            ),
        )
        return cur.fetchall()


@lru_cache(maxsize=32)
def fetch_postgres_home_summary(division_id=""):
    with get_postgres_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              COUNT(*) AS total_games,
              COALESCE(TO_CHAR(MAX(game_date), 'FMMonth FMDD, YYYY'), '') AS latest_game_date
            FROM games
            WHERE (%s = '' OR division_id = %s)
            """,
            (division_id, division_id),
        )
        games_row = cur.fetchone() or {}

        cur.execute(
            """
            SELECT COUNT(DISTINCT player_id) AS total_players
            FROM player_game_stats
            WHERE (%s = '' OR division_id = %s)
            """,
            (division_id, division_id),
        )
        players_row = cur.fetchone() or {}

        cur.execute(
            """
            SELECT COUNT(DISTINCT team_id) AS total_teams
            FROM teams
            WHERE (%s = '' OR division_id = %s)
            """,
            (division_id, division_id),
        )
        teams_row = cur.fetchone() or {}

        cur.execute(
            """
            WITH player_totals AS (
              SELECT
                player_id,
                player_name,
                SUM(games_played) AS games_played,
                SUM(pts) AS pts
              FROM player_season_totals
              WHERE (%s = '' OR division_id = %s)
              GROUP BY player_id, player_name
            )
            SELECT player_id, player_name, games_played, pts
            FROM player_totals
            ORDER BY (pts::float8 / NULLIF(games_played, 0)) DESC NULLS LAST, player_name
            LIMIT 1
            """,
            (division_id, division_id),
        )
        scoring_leader = cur.fetchone()

        cur.execute(
            """
            WITH player_totals AS (
              SELECT
                player_id,
                player_name,
                SUM(games_played) AS games_played,
                SUM(pts) AS pts,
                SUM(fga) AS fga,
                SUM(fta) AS fta
              FROM player_season_totals
              WHERE (%s = '' OR division_id = %s)
              GROUP BY player_id, player_name
            )
            SELECT player_id, player_name, games_played,
                   CASE
                     WHEN (2 * (fga + 0.44 * fta)) = 0 THEN 0
                     ELSE pts::float8 / (2 * (fga + 0.44 * fta))
                   END AS ts
            FROM player_totals
            WHERE games_played >= 3
            ORDER BY ts DESC, player_name
            LIMIT 1
            """,
            (division_id, division_id),
        )
        efficiency_leader = cur.fetchone()

        cur.execute(
            """
            WITH player_totals AS (
              SELECT
                player_id,
                player_name,
                SUM(games_played) AS games_played,
                SUM(ast) AS ast,
                SUM(tov) AS tov
              FROM player_season_totals
              WHERE (%s = '' OR division_id = %s)
              GROUP BY player_id, player_name
            )
            SELECT
              player_id,
              player_name,
              games_played,
              CASE
                WHEN tov = 0 AND ast > 0 THEN NULL
                WHEN tov = 0 THEN 0
                ELSE ast::float8 / tov
              END AS ast_to,
              (tov = 0 AND ast > 0) AS perfect
            FROM player_totals
            WHERE games_played >= 3
            ORDER BY
              CASE WHEN tov = 0 AND ast > 0 THEN 1 ELSE 0 END DESC,
              CASE WHEN tov = 0 THEN ast::float8 ELSE ast::float8 / NULLIF(tov, 0) END DESC,
              player_name
            LIMIT 1
            """,
            (division_id, division_id),
        )
        playmaking_leader = cur.fetchone()

    return {
        "total_games": games_row.get("total_games", 0) or 0,
        "total_players": players_row.get("total_players", 0) or 0,
        "total_teams": teams_row.get("total_teams", 0) or 0,
        "latest_game_date": games_row.get("latest_game_date") or "",
        "scoring_leader": scoring_leader,
        "efficiency_leader": efficiency_leader,
        "playmaking_leader": playmaking_leader,
    }


def list_divisions_from_store():
    store = get_csv_store()
    divisions = {}

    for game in store["games"]:
        division_id = normalize_division_id(game.get("division_id"))
        if not division_id:
            continue
        division = divisions.setdefault(
            division_id,
            {
                "division_id": division_id,
                "division_label": normalize_space(game.get("division_label")) or division_id,
                "games": 0,
                "teams": set(),
                "players": set(),
            },
        )
        division["games"] += 1
        if game.get("team1_id"):
            division["teams"].add(game["team1_id"])
        if game.get("team2_id"):
            division["teams"].add(game["team2_id"])

    for row in store["player_game_rows"]:
        division_id = normalize_division_id(row.get("division_id"))
        if not division_id:
            continue
        division = divisions.setdefault(
            division_id,
            {
                "division_id": division_id,
                "division_label": normalize_space(row.get("division_label")) or division_id,
                "games": 0,
                "teams": set(),
                "players": set(),
            },
        )
        division["players"].add(row["player_id"])
        if row.get("team_id"):
            division["teams"].add(row["team_id"])

    return [
        {
            "division_id": division["division_id"],
            "division_label": division["division_label"],
            "games": division["games"],
            "teams": len(division["teams"]),
            "players": len(division["players"]),
        }
        for division in sorted(divisions.values(), key=lambda row: row["division_label"])
    ]


def safe_divide(numerator, denominator):
    return numerator / (denominator or 1)


def round_metric(value, digits=2):
    return round(float(value or 0), digits)


@lru_cache(maxsize=64)
def _build_team_analytics(_snapshot_key, division_id="", season_year="", season_term=""):
    store = get_csv_store()
    teams_by_id = {}

    for game in store["games"]:
        if not matches_filters(game, division_id, season_year, season_term):
            continue
        team1_id = game.get("team1_id")
        team2_id = game.get("team2_id")
        if not team1_id or not team2_id:
            continue

        pairings = [
            (
                team1_id,
                game.get("team1_name"),
                game.get("team1_pts", 0),
                team2_id,
                game.get("team2_pts", 0),
            ),
            (
                team2_id,
                game.get("team2_name"),
                game.get("team2_pts", 0),
                team1_id,
                game.get("team1_pts", 0),
            ),
        ]

        for team_id, team_name, points_for, opponent_id, points_against in pairings:
            team_row = teams_by_id.setdefault(
                team_id,
                {
                    "team_id": team_id,
                    "team_name": team_name or f"Team {team_id}",
                    "division_id": game.get("division_id", ""),
                    "division_label": game.get("division_label", ""),
                    "games_played": 0,
                    "wins": 0,
                    "losses": 0,
                    "ties": 0,
                    "points_for": 0,
                    "points_against": 0,
                    "opponents": [],
                },
            )
            team_row["team_name"] = team_name or team_row["team_name"]
            team_row["games_played"] += 1
            team_row["points_for"] += points_for
            team_row["points_against"] += points_against
            team_row["opponents"].append(opponent_id)
            if points_for > points_against:
                team_row["wins"] += 1
            elif points_for < points_against:
                team_row["losses"] += 1
            else:
                team_row["ties"] += 1

    league_average_points = safe_divide(
        sum(team["points_for"] for team in teams_by_id.values()),
        sum(team["games_played"] for team in teams_by_id.values()),
    )

    for team_row in teams_by_id.values():
        team_row["win_pct_raw"] = safe_divide(team_row["wins"], team_row["games_played"])
        team_row["offensive_rating_raw"] = safe_divide(
            team_row["points_for"], team_row["games_played"]
        )
        team_row["defensive_rating_raw"] = safe_divide(
            team_row["points_against"], team_row["games_played"]
        )
        team_row["net_rating_raw"] = (
            team_row["offensive_rating_raw"] - team_row["defensive_rating_raw"]
        )

    analytics_by_id = {}
    for team_id, team_row in teams_by_id.items():
        opponents = [
            teams_by_id[opponent_id]
            for opponent_id in team_row["opponents"]
            if opponent_id in teams_by_id
        ]
        average_opponent_win_pct = safe_divide(
            sum(opponent["win_pct_raw"] for opponent in opponents),
            len(opponents),
        )
        strength_of_schedule = safe_divide(
            sum(opponent["net_rating_raw"] for opponent in opponents),
            len(opponents),
        )
        average_opponent_offense = safe_divide(
            sum(opponent["offensive_rating_raw"] for opponent in opponents),
            len(opponents),
        )
        average_opponent_defense = safe_divide(
            sum(opponent["defensive_rating_raw"] for opponent in opponents),
            len(opponents),
        )
        adjusted_offense = (
            team_row["offensive_rating_raw"] - average_opponent_defense + league_average_points
        )
        adjusted_defense = (
            team_row["defensive_rating_raw"] - average_opponent_offense + league_average_points
        )
        adjusted_net = adjusted_offense - adjusted_defense

        analytics_by_id[team_id] = {
            "team_id": team_id,
            "team_name": team_row["team_name"],
            "division_id": team_row.get("division_id", ""),
            "division_label": team_row.get("division_label", ""),
            "games_played": team_row["games_played"],
            "wins": team_row["wins"],
            "losses": team_row["losses"],
            "ties": team_row["ties"],
            "win_pct": round_metric(team_row["win_pct_raw"]),
            "offensive_rating": round_metric(team_row["offensive_rating_raw"]),
            "defensive_rating": round_metric(team_row["defensive_rating_raw"]),
            "net_rating": round_metric(team_row["net_rating_raw"]),
            "strength_of_schedule": round_metric(strength_of_schedule),
            "opponent_win_pct": round_metric(average_opponent_win_pct),
            "adjusted_offensive_rating": round_metric(adjusted_offense),
            "adjusted_defensive_rating": round_metric(adjusted_defense),
            "adjusted_net_rating": round_metric(adjusted_net),
        }

    return analytics_by_id


def get_team_analytics_store():
    return _build_team_analytics(csv_snapshot_key())


def get_filtered_team_analytics_store(division_id="", season_year="", season_term=""):
    return _build_team_analytics(csv_snapshot_key(), division_id, season_year, season_term)


def build_team_summary_from_store(team_id: int, division_id="", season_year="", season_term=""):
    store = get_csv_store()
    analytics_by_id = get_filtered_team_analytics_store(division_id, season_year, season_term)
    team_by_id = {row["team_id"]: row for row in store["teams"]}
    team_row = team_by_id.get(team_id)
    if team_row is None:
        raise HTTPException(status_code=404, detail="team not found")
    team_name = team_row["team_name"]

    team_game_rows = []
    for game in store["games"]:
        if not matches_filters(game, division_id, season_year, season_term):
            continue
        if game["team1_id"] == team_id:
            team_pts = next(
                (
                    row["pts"]
                    for row in store["team_totals"]
                    if row["game_key"] == game["game_key"] and row["table_index"] == 1
                ),
                0,
            )
            opponent_pts = next(
                (
                    row["pts"]
                    for row in store["team_totals"]
                    if row["game_key"] == game["game_key"] and row["table_index"] == 2
                ),
                0,
            )
            opponent_name = game["team2_name"]
        elif game["team2_id"] == team_id:
            team_pts = next(
                (
                    row["pts"]
                    for row in store["team_totals"]
                    if row["game_key"] == game["game_key"] and row["table_index"] == 2
                ),
                0,
            )
            opponent_pts = next(
                (
                    row["pts"]
                    for row in store["team_totals"]
                    if row["game_key"] == game["game_key"] and row["table_index"] == 1
                ),
                0,
            )
            opponent_name = game["team1_name"]
        else:
            continue

        team_game_rows.append(
            {
                "game_id": game["game_id"],
                "game_key": game["game_key"],
                "division_id": game.get("division_id", ""),
                "division_label": game.get("division_label", ""),
                "game_date": game["game_date"],
                "game_url": game["game_url"],
                "opponent_team_name": opponent_name,
                "team_pts": team_pts,
                "opponent_pts": opponent_pts,
                "result": "W" if team_pts > opponent_pts else "L" if team_pts < opponent_pts else "T",
            }
        )

    player_totals = {}
    for row in store["player_game_rows"]:
        if row["team_id"] != team_id or not matches_filters(row, division_id, season_year, season_term):
            continue
        player_total = player_totals.setdefault(
            row["player_id"],
            {
                "player_id": row["player_id"],
                "player_name": row["player_name"],
                "games": set(),
                "pts": 0,
                "reb": 0,
                "ast": 0,
                "stl": 0,
                "blk": 0,
                "tov": 0,
                "fouls": 0,
                "fgm": 0,
                "fga": 0,
                "tpm": 0,
                "tpa": 0,
                "ftm": 0,
                "fta": 0,
            },
        )
        player_total["games"].add(row["game_id"])
        for key in ["pts", "reb", "ast", "stl", "blk", "tov", "fouls", "fgm", "fga", "tpm", "tpa", "ftm", "fta"]:
            player_total[key] += row[key]

    players = []
    for total in player_totals.values():
        fga = total["fga"]
        tpa = total["tpa"]
        fta = total["fta"]
        players.append(
            {
                "player_id": total["player_id"],
                "player_name": total["player_name"],
                "games_played": len(total["games"]),
                "pts": total["pts"],
                "reb": total["reb"],
                "ast": total["ast"],
                "stl": total["stl"],
                "blk": total["blk"],
                "tov": total["tov"],
                "fouls": total["fouls"],
                "fgm": total["fgm"],
                "fga": fga,
                "fg_pct": round(total["fgm"] / fga, 4) if fga else 0,
                "tpm": total["tpm"],
                "tpa": tpa,
                "tp_pct": round(total["tpm"] / tpa, 4) if tpa else 0,
                "ftm": total["ftm"],
                "fta": fta,
                "ft_pct": round(total["ftm"] / fta, 4) if fta else 0,
            }
        )

    players.sort(key=lambda row: (-row["pts"], row["player_name"]))

    totals_rows = [
        row
        for row in store["team_totals"]
        if row["team_id"] == team_id and matches_filters(row, division_id, season_year, season_term)
    ]
    total_fga = sum(row["fga"] for row in totals_rows)
    total_tpa = sum(row["tpa"] for row in totals_rows)
    total_fta = sum(row["fta"] for row in totals_rows)
    wins = sum(1 for row in team_game_rows if row["result"] == "W")
    losses = sum(1 for row in team_game_rows if row["result"] == "L")

    recent_games = sorted(
        team_game_rows,
        key=lambda row: (game_date_sort_value(row.get("game_date")), row["game_id"]),
        reverse=True,
    )[:5]
    analytics = analytics_by_id.get(team_id, {})

    return {
        "team_id": team_id,
        "division_id": team_row.get("division_id", ""),
        "division_label": team_row.get("division_label", ""),
        "team_name": team_name,
        "games_played": len(team_game_rows),
        "wins": wins,
        "losses": losses,
        "pts": sum(row["pts"] for row in totals_rows),
        "reb": sum(row["reb"] for row in totals_rows),
        "ast": sum(row["ast"] for row in totals_rows),
        "stl": sum(row["stl"] for row in totals_rows),
        "blk": sum(row["blk"] for row in totals_rows),
        "tov": sum(row["tov"] for row in totals_rows),
        "fouls": sum(row["pf"] for row in totals_rows),
        "fgm": sum(row["fgm"] for row in totals_rows),
        "fga": total_fga,
        "fg_pct": round(sum(row["fgm"] for row in totals_rows) / total_fga, 4) if total_fga else 0,
        "tpm": sum(row["tpm"] for row in totals_rows),
        "tpa": total_tpa,
        "tp_pct": round(sum(row["tpm"] for row in totals_rows) / total_tpa, 4) if total_tpa else 0,
        "ftm": sum(row["ftm"] for row in totals_rows),
        "fta": total_fta,
        "ft_pct": round(sum(row["ftm"] for row in totals_rows) / total_fta, 4) if total_fta else 0,
        "win_pct": analytics.get("win_pct", 0),
        "offensive_rating": analytics.get("offensive_rating", 0),
        "defensive_rating": analytics.get("defensive_rating", 0),
        "net_rating": analytics.get("net_rating", 0),
        "strength_of_schedule": analytics.get("strength_of_schedule", 0),
        "opponent_win_pct": analytics.get("opponent_win_pct", 0),
        "adjusted_offensive_rating": analytics.get("adjusted_offensive_rating", 0),
        "adjusted_defensive_rating": analytics.get("adjusted_defensive_rating", 0),
        "adjusted_net_rating": analytics.get("adjusted_net_rating", 0),
        "players": players,
        "recent_games": recent_games,
    }


@app.get("/health")
def health():
    if csv_enabled():
        store = get_csv_store()
        dates = [row["game_date"] for row in store["games"] if row["game_date"]]
        return {
            "ok": True,
            "data_source": "csv",
            "total_games": len(store["games"]),
            "latest_game_date": max(dates) if dates else None,
        }

    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  COUNT(*) AS total_games,
                  MAX(game_date) AS latest_game_date
                FROM d3_games
                """
            )
            stats = cur.fetchone() or {}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"database unavailable: {exc}") from exc

    return {"ok": True, "data_source": "db", **stats}


@app.get("/divisions")
def list_divisions():
    if postgres_analytics_enabled():
        try:
            return fetch_postgres_divisions()
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
    if csv_enabled():
        return list_divisions_from_store()
    return []


@app.get("/season-options")
def list_season_options(division: str | None = Query(None)):
    division_id = normalize_division_id(division)
    if postgres_analytics_enabled():
        try:
            return fetch_postgres_season_options(division_id)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    if not csv_enabled():
        return {"years": [], "season_terms": [], "year_terms": []}

    store = get_csv_store()
    years = set()
    season_terms = set()
    terms_by_year = defaultdict(set)

    for game in store["games"]:
        if not matches_division(game, division_id):
            continue
        year = normalize_year(game.get("season_year"))
        season_term = normalize_season_term(game.get("season_term"))
        if year:
            years.add(year)
        if season_term:
            season_terms.add(season_term)
        if year and season_term:
            terms_by_year[year].add(season_term)

    sorted_years = sorted(years, reverse=True)
    sorted_terms = sorted(season_terms, key=season_term_sort_key)
    return {
        "years": sorted_years,
        "season_terms": sorted_terms,
        "year_terms": [
            {
                "year": year,
                "season_terms": sorted(terms_by_year.get(year, set()), key=season_term_sort_key),
            }
            for year in sorted_years
        ],
    }


@app.get("/home-summary")
def home_summary(division: str | None = Query(None)):
    division_id = normalize_division_id(division)
    if postgres_analytics_enabled():
        try:
            return fetch_postgres_home_summary(division_id)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    store = get_csv_store()
    filtered_games = [row for row in store["games"] if matches_division(row, division_id)]
    filtered_players = {
        row["player_id"] for row in store["player_game_rows"] if matches_division(row, division_id)
    }
    filtered_teams = {
        row["team_id"] for row in store["team_totals"] if matches_division(row, division_id)
    }
    leaderboard_rows = leaderboard(limit=200, division=division_id or None)
    scoring_leader = leaderboard_rows[0] if leaderboard_rows else None
    efficiency_leader = next(
        (
            row
            for row in sorted(
                (
                    {
                        **row,
                        "ts": (
                            row["pts"] / (2 * (row["fga"] + 0.44 * row["fta"]))
                            if (row["fga"] + 0.44 * row["fta"])
                            else 0
                        ),
                    }
                    for row in leaderboard_rows
                    if row["games_played"] >= 3
                ),
                key=lambda entry: (entry["ts"], entry["player_name"]),
                reverse=True,
            )
        ),
        None,
    )
    playmaking_leader = next(
        (
            row
            for row in sorted(
                (
                    {
                        **row,
                        "ast_to": (
                            None
                            if row["tov"] == 0 and row["ast"] > 0
                            else row["ast"] / row["tov"]
                            if row["tov"]
                            else 0
                        ),
                        "perfect": row["tov"] == 0 and row["ast"] > 0,
                    }
                    for row in leaderboard_rows
                    if row["games_played"] >= 3
                ),
                key=lambda entry: (
                    1 if entry["perfect"] else 0,
                    entry["ast"] if entry["tov"] == 0 else (entry["ast"] / entry["tov"] if entry["tov"] else 0),
                    entry["player_name"],
                ),
                reverse=True,
            )
        ),
        None,
    )
    latest_game = max(
        filtered_games,
        key=lambda row: game_date_sort_value(row.get("game_date")),
        default=None,
    )
    return {
        "total_games": len(filtered_games),
        "total_players": len(filtered_players),
        "total_teams": len(filtered_teams),
        "latest_game_date": latest_game["game_date"] if latest_game else "",
        "scoring_leader": scoring_leader,
        "efficiency_leader": efficiency_leader,
        "playmaking_leader": playmaking_leader,
    }


@app.get("/players")
def get_players(
    division: str | None = Query(None),
    year: str | None = Query(None),
    season_term: str | None = Query(None),
):
    division_id = normalize_division_id(division)
    season_year = normalize_year(year)
    normalized_season_term = normalize_season_term(season_term)
    if postgres_analytics_enabled():
        try:
            return fetch_postgres_players(division_id, season_year, normalized_season_term)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    if csv_enabled():
        store = get_csv_store()
        if not division_id:
            players = {}
            for row in store["player_game_rows"]:
                if not matches_filters(row, division_id, season_year, normalized_season_term):
                    continue
                player = players.setdefault(
                    row["player_id"],
                    {
                        "player_id": row["player_id"],
                        "player_name": row["player_name"],
                        "division_ids": set(),
                        "division_labels": set(),
                    },
                )
                if row.get("division_id"):
                    player["division_ids"].add(row["division_id"])
                if row.get("division_label"):
                    player["division_labels"].add(row["division_label"])
        else:
            players = {}
            for row in store["player_game_rows"]:
                if not matches_filters(row, division_id, season_year, normalized_season_term):
                    continue
                player = players.setdefault(
                    row["player_id"],
                    {
                        "player_id": row["player_id"],
                        "player_name": row["player_name"],
                        "division_ids": set(),
                        "division_labels": set(),
                    },
                )
                if row.get("division_id"):
                    player["division_ids"].add(row["division_id"])
                if row.get("division_label"):
                    player["division_labels"].add(row["division_label"])

        return sorted(
            [
                {
                    "player_id": player["player_id"],
                    "player_name": player["player_name"],
                    "division_count": len(player["division_ids"]),
                    "division_ids": sorted(player["division_ids"]),
                    "division_labels": sorted(player["division_labels"]),
                }
                for player in players.values()
            ],
            key=lambda row: row["player_name"],
        )

    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT player_id, player_name FROM players ORDER BY player_name")
            return cur.fetchall()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/players-page")
def get_players_page(
    q: str | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    division: str | None = Query(None),
    year: str | None = Query(None),
    season_term: str | None = Query(None),
):
    division_id = normalize_division_id(division)
    season_year = normalize_year(year)
    normalized_season_term = normalize_season_term(season_term)
    query = normalize_space(q).lower()
    offset = (page - 1) * limit

    if postgres_analytics_enabled():
        cte = f"""
        WITH filtered_players AS (
          SELECT
            p.player_id,
            p.player_name,
            COUNT(DISTINCT pgs.division_id) AS division_count,
            ARRAY_AGG(DISTINCT pgs.division_id ORDER BY pgs.division_id) AS division_ids,
            ARRAY_AGG(DISTINCT pgs.division_label ORDER BY pgs.division_label) AS division_labels
          FROM players p
          JOIN player_game_stats pgs ON pgs.player_id = p.player_id
          WHERE {postgres_filter_sql('pgs')}
            AND (%s = '' OR LOWER(p.player_name) LIKE %s)
          GROUP BY p.player_id, p.player_name
        )
        """
        try:
            with get_postgres_conn() as conn, conn.cursor() as cur:
                cur.execute(
                    cte + "SELECT COUNT(*) AS total FROM filtered_players",
                    (
                        division_id,
                        division_id,
                        season_year,
                        season_year,
                        normalized_season_term,
                        normalized_season_term,
                        query,
                        f"%{query}%",
                    ),
                )
                total = (cur.fetchone() or {}).get("total", 0) or 0
                cur.execute(
                    cte
                    + """
                    SELECT *
                    FROM filtered_players
                    ORDER BY player_name
                    LIMIT %s OFFSET %s
                    """,
                    (
                        division_id,
                        division_id,
                        season_year,
                        season_year,
                        normalized_season_term,
                        normalized_season_term,
                        query,
                        f"%{query}%",
                        limit,
                        offset,
                    ),
                )
                items = cur.fetchall()
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": limit,
            "total_pages": (total + limit - 1) // limit if total else 0,
        }

    if csv_enabled():
        players = get_players(division=division, year=year, season_term=season_term)
        if query:
            players = [
                row for row in players if query in normalize_space(row.get("player_name")).lower()
            ]
        total = len(players)
        return {
            "items": players[offset : offset + limit],
            "total": total,
            "page": page,
            "page_size": limit,
            "total_pages": (total + limit - 1) // limit if total else 0,
        }

    return {"items": [], "total": 0, "page": page, "page_size": limit, "total_pages": 0}


@app.get("/players/{player_id}")
def get_player(player_id: int):
    if postgres_analytics_enabled():
        try:
            player = fetch_postgres_player_identity(player_id)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        if player is None:
            raise HTTPException(status_code=404, detail="player not found")
        return player

    if csv_enabled():
        store = get_csv_store()
        player_name = ""
        division_ids = set()
        division_labels = set()
        for row in store["player_game_rows"]:
            if row["player_id"] != player_id:
                continue
            player_name = row["player_name"]
            if row.get("division_id"):
                division_ids.add(row["division_id"])
            if row.get("division_label"):
                division_labels.add(row["division_label"])
        if not player_name:
            raise HTTPException(status_code=404, detail="player not found")
        return {
            "player_id": player_id,
            "player_name": player_name,
            "division_count": len(division_ids),
            "division_ids": sorted(division_ids),
            "division_labels": sorted(division_labels),
        }

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT player_id, player_name FROM players WHERE player_id = %s", (player_id,))
        player = cur.fetchone()
        if player is None:
            raise HTTPException(status_code=404, detail="player not found")
        return player


@app.get("/players/{player_id}/games")
def player_game_log(
    player_id: int,
    limit: int = Query(50, ge=1, le=500),
    division: str | None = Query(None),
    year: str | None = Query(None),
    season_term: str | None = Query(None),
):
    division_id = normalize_division_id(division)
    season_year = normalize_year(year)
    normalized_season_term = normalize_season_term(season_term)
    if postgres_analytics_enabled():
        sql = f"""
        SELECT
          pgs.game_id,
          g.game_key,
          pgs.division_id,
          pgs.division_label,
          g.game_url,
          COALESCE(TO_CHAR(g.game_date, 'FMMonth FMDD, YYYY'), '') AS game_date,
          pgs.team_id,
          pgs.team_name,
          CASE
            WHEN g.team1_id = pgs.team_id THEN g.team2_name
            ELSE g.team1_name
          END AS opponent_team_name,
          CASE
            WHEN g.team1_id = pgs.team_id THEN g.team1_pts
            ELSE g.team2_pts
          END AS team_pts,
          CASE
            WHEN g.team1_id = pgs.team_id THEN g.team2_pts
            ELSE g.team1_pts
          END AS opponent_pts,
          CASE
            WHEN (
              CASE WHEN g.team1_id = pgs.team_id THEN g.team1_pts ELSE g.team2_pts END
            ) > (
              CASE WHEN g.team1_id = pgs.team_id THEN g.team2_pts ELSE g.team1_pts END
            ) THEN 'W'
            WHEN (
              CASE WHEN g.team1_id = pgs.team_id THEN g.team1_pts ELSE g.team2_pts END
            ) < (
              CASE WHEN g.team1_id = pgs.team_id THEN g.team2_pts ELSE g.team1_pts END
            ) THEN 'L'
            ELSE 'T'
          END AS result,
          pgs.pts,
          pgs.reb,
          pgs.ast,
          pgs.stl,
          pgs.blk,
          pgs.tov,
          pgs.fouls,
          pgs.fgm,
          pgs.fga,
          pgs.fg_pct,
          pgs.tpm,
          pgs.tpa,
          pgs.tp_pct,
          pgs.ftm,
          pgs.fta,
          pgs.ft_pct
        FROM player_game_stats pgs
        JOIN games g ON g.game_id = pgs.game_id
        WHERE pgs.player_id = %s
          AND {postgres_filter_sql('pgs')}
        ORDER BY g.game_date DESC NULLS LAST, pgs.game_id DESC
        LIMIT %s
        """
        try:
            with get_postgres_conn() as conn, conn.cursor() as cur:
                cur.execute(
                    sql,
                    (
                        player_id,
                        division_id,
                        division_id,
                        season_year,
                        season_year,
                        normalized_season_term,
                        normalized_season_term,
                        limit,
                    ),
                )
                rows = cur.fetchall()
                if not rows:
                    cur.execute("SELECT 1 FROM players WHERE player_id = %s", (player_id,))
                    if cur.fetchone() is None:
                        raise HTTPException(status_code=404, detail="player not found")
                return rows
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    if csv_enabled():
        store = get_csv_store()
        player_ids = {row["player_id"] for row in store["players"]}
        game_map = {row["game_id"]: row for row in store["games"]}
        rows = [
            {
                "game_id": row["game_id"],
                "game_key": row["game_key"],
                "division_id": row.get("division_id", ""),
                "division_label": row.get("division_label", ""),
                "game_url": row["game_url"],
                "game_date": row["game_date"],
                "team_id": row["team_id"],
                "team_name": row["team_name"],
                "opponent_team_name": (
                    game_map[row["game_id"]]["team2_name"]
                    if game_map[row["game_id"]].get("team1_id") == row["team_id"]
                    else game_map[row["game_id"]]["team1_name"]
                ),
                "team_pts": (
                    game_map[row["game_id"]]["team1_pts"]
                    if game_map[row["game_id"]].get("team1_id") == row["team_id"]
                    else game_map[row["game_id"]]["team2_pts"]
                ),
                "opponent_pts": (
                    game_map[row["game_id"]]["team2_pts"]
                    if game_map[row["game_id"]].get("team1_id") == row["team_id"]
                    else game_map[row["game_id"]]["team1_pts"]
                ),
                "result": (
                    "W"
                    if (
                        (
                            game_map[row["game_id"]]["team1_pts"]
                            if game_map[row["game_id"]].get("team1_id") == row["team_id"]
                            else game_map[row["game_id"]]["team2_pts"]
                        )
                        > (
                            game_map[row["game_id"]]["team2_pts"]
                            if game_map[row["game_id"]].get("team1_id") == row["team_id"]
                            else game_map[row["game_id"]]["team1_pts"]
                        )
                    )
                    else "L"
                    if (
                        (
                            game_map[row["game_id"]]["team1_pts"]
                            if game_map[row["game_id"]].get("team1_id") == row["team_id"]
                            else game_map[row["game_id"]]["team2_pts"]
                        )
                        < (
                            game_map[row["game_id"]]["team2_pts"]
                            if game_map[row["game_id"]].get("team1_id") == row["team_id"]
                            else game_map[row["game_id"]]["team1_pts"]
                        )
                    )
                    else "T"
                ),
                "pts": row["pts"],
                "reb": row["reb"],
                "ast": row["ast"],
                "stl": row["stl"],
                "blk": row["blk"],
                "tov": row["tov"],
                "fouls": row["fouls"],
                "fgm": row["fgm"],
                "fga": row["fga"],
                "fg_pct": row["fg_pct"],
                "tpm": row["tpm"],
                "tpa": row["tpa"],
                "tp_pct": row["tp_pct"],
                "ftm": row["ftm"],
                "fta": row["fta"],
                "ft_pct": row["ft_pct"],
            }
            for row in store["player_game_rows"]
            if row["player_id"] == player_id
            and matches_filters(row, division_id, season_year, normalized_season_term)
        ]
        rows.sort(
            key=lambda row: (game_date_sort_value(row.get("game_date")), row["game_id"]),
            reverse=True,
        )
        if not rows and player_id not in player_ids:
            raise HTTPException(status_code=404, detail="player not found")
        return rows[:limit]

    sql = """
    SELECT
      g.id AS game_id,
      g.game_key,
      g.game_url,
      g.game_date,
      pgs.team_id,
      t.team_name,
      pgs.pts,
      pgs.reb,
      pgs.ast,
      pgs.stl,
      pgs.blk,
      pgs.tov,
      pgs.fouls,
      pgs.fgm,
      pgs.fga,
      pgs.fg_pct,
      pgs.tpm,
      pgs.tpa,
      pgs.tp_pct,
      pgs.ftm,
      pgs.fta,
      pgs.ft_pct
    FROM player_game_stats pgs
    JOIN d3_games g ON g.id = pgs.game_id
    JOIN teams t ON t.team_id = pgs.team_id
    WHERE pgs.player_id = %s
    ORDER BY g.id DESC
    LIMIT %s
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, (player_id, limit))
        rows = cur.fetchall()
        if not rows:
            cur.execute("SELECT 1 FROM players WHERE player_id = %s", (player_id,))
            if cur.fetchone() is None:
                raise HTTPException(status_code=404, detail="player not found")
        return rows


@app.get("/leaderboard")
def leaderboard(
    sort: str = Query("pts"),
    limit: int = Query(50, ge=1, le=5000),
    division: str | None = Query(None),
    year: str | None = Query(None),
    season_term: str | None = Query(None),
):
    division_id = normalize_division_id(division)
    season_year = normalize_year(year)
    normalized_season_term = normalize_season_term(season_term)
    if postgres_analytics_enabled():
        try:
            return fetch_postgres_leaderboard(
                sort,
                limit,
                division_id,
                season_year,
                normalized_season_term,
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    if csv_enabled():
        totals = {}
        for row in get_csv_store()["player_game_rows"]:
            if not matches_filters(row, division_id, season_year, normalized_season_term):
                continue
            player_id = row["player_id"]
            player_total = totals.setdefault(
                player_id,
                {
                    "player_id": player_id,
                    "player_name": row["player_name"],
                    "games": set(),
                    "division_ids": set(),
                    "division_labels": set(),
                    "pts": 0,
                    "reb": 0,
                    "ast": 0,
                    "stl": 0,
                    "blk": 0,
                    "tov": 0,
                    "fouls": 0,
                    "fgm": 0,
                    "fga": 0,
                    "tpm": 0,
                    "tpa": 0,
                    "ftm": 0,
                    "fta": 0,
                },
            )
            player_total["games"].add(row["game_id"])
            if row.get("division_id"):
                player_total["division_ids"].add(row["division_id"])
            if row.get("division_label"):
                player_total["division_labels"].add(row["division_label"])
            for key in ["pts", "reb", "ast", "stl", "blk", "tov", "fouls", "fgm", "fga", "tpm", "tpa", "ftm", "fta"]:
                player_total[key] += row[key]

        allowed = {"pts", "reb", "ast", "stl", "blk", "tpm"}
        if sort not in allowed:
            raise HTTPException(status_code=400, detail=f"sort must be one of {sorted(allowed)}")

        rows = []
        for total in totals.values():
            fga = total["fga"]
            tpa = total["tpa"]
            fta = total["fta"]
            rows.append(
                {
                    "player_id": total["player_id"],
                    "player_name": total["player_name"],
                    "games_played": len(total["games"]),
                    "division_count": len(total["division_ids"]),
                    "division_ids": sorted(total["division_ids"]),
                    "division_labels": sorted(total["division_labels"]),
                    "pts": total["pts"],
                    "reb": total["reb"],
                    "ast": total["ast"],
                    "stl": total["stl"],
                    "blk": total["blk"],
                    "tov": total["tov"],
                    "fouls": total["fouls"],
                    "fgm": total["fgm"],
                    "fga": fga,
                    "fg_pct": round(total["fgm"] / fga, 4) if fga else 0,
                    "tpm": total["tpm"],
                    "tpa": tpa,
                    "tp_pct": round(total["tpm"] / tpa, 4) if tpa else 0,
                    "ftm": total["ftm"],
                    "fta": fta,
                    "ft_pct": round(total["ftm"] / fta, 4) if fta else 0,
                }
            )

        rows.sort(key=lambda row: (row[sort], row["player_name"]), reverse=True)
        return rows[:limit]

    order_columns = {
        "pts": "pts",
        "reb": "reb",
        "ast": "ast",
        "stl": "stl",
        "blk": "blk",
        "tpm": "tpm",
    }
    if sort not in order_columns:
        raise HTTPException(
            status_code=400,
            detail=f"sort must be one of {sorted(order_columns)}",
        )

    sql = f"""
    SELECT
      p.player_id,
      p.player_name,
      COUNT(DISTINCT pgs.game_id) AS games_played,
      SUM(pgs.pts) AS pts,
      SUM(pgs.reb) AS reb,
      SUM(pgs.ast) AS ast,
      SUM(pgs.stl) AS stl,
      SUM(pgs.blk) AS blk,
      SUM(pgs.tov) AS tov,
      SUM(pgs.fouls) AS fouls,
      SUM(pgs.fgm) AS fgm,
      SUM(pgs.fga) AS fga,
      CASE
        WHEN SUM(pgs.fga) = 0 THEN 0
        ELSE ROUND(SUM(pgs.fgm) / SUM(pgs.fga), 4)
      END AS fg_pct,
      SUM(pgs.tpm) AS tpm,
      SUM(pgs.tpa) AS tpa,
      CASE
        WHEN SUM(pgs.tpa) = 0 THEN 0
        ELSE ROUND(SUM(pgs.tpm) / SUM(pgs.tpa), 4)
      END AS tp_pct,
      SUM(pgs.ftm) AS ftm,
      SUM(pgs.fta) AS fta,
      CASE
        WHEN SUM(pgs.fta) = 0 THEN 0
        ELSE ROUND(SUM(pgs.ftm) / SUM(pgs.fta), 4)
      END AS ft_pct
    FROM player_game_stats pgs
    JOIN players p ON p.player_id = pgs.player_id
    GROUP BY p.player_id, p.player_name
    ORDER BY {order_columns[sort]} DESC, p.player_name ASC
    LIMIT %s
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, (limit,))
        return cur.fetchall()


@app.get("/teams")
def list_teams(
    division: str | None = Query(None),
    year: str | None = Query(None),
    season_term: str | None = Query(None),
):
    division_id = normalize_division_id(division)
    season_year = normalize_year(year)
    normalized_season_term = normalize_season_term(season_term)
    if postgres_analytics_enabled():
        try:
            return fetch_postgres_team_analytics(division_id, season_year, normalized_season_term)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    if csv_enabled():
        return sorted(
            [
                row
                for row in get_filtered_team_analytics_store(
                    division_id, season_year, normalized_season_term
                ).values()
            ],
            key=lambda row: (
                -row["wins"],
                row["losses"],
                -row["adjusted_net_rating"],
                row["team_name"],
            ),
        )

    sql = "SELECT team_id, team_name FROM teams ORDER BY team_name"
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql)
        return cur.fetchall()


@app.get("/teams/{team_id}/roster")
def team_roster(team_id: int):
    if csv_enabled():
        return build_team_summary_from_store(team_id)["players"]

    sql = """
    SELECT
      p.player_id,
      p.player_name,
      COUNT(DISTINCT pgs.game_id) AS games_played,
      SUM(pgs.pts) AS pts,
      SUM(pgs.reb) AS reb,
      SUM(pgs.ast) AS ast,
      SUM(pgs.stl) AS stl,
      SUM(pgs.blk) AS blk,
      SUM(pgs.tov) AS tov,
      SUM(pgs.fgm) AS fgm,
      SUM(pgs.fga) AS fga,
      CASE
        WHEN SUM(pgs.fga) = 0 THEN 0
        ELSE ROUND(SUM(pgs.fgm) / SUM(pgs.fga), 4)
      END AS fg_pct,
      SUM(pgs.tpm) AS tpm,
      SUM(pgs.tpa) AS tpa,
      CASE
        WHEN SUM(pgs.tpa) = 0 THEN 0
        ELSE ROUND(SUM(pgs.tpm) / SUM(pgs.tpa), 4)
      END AS tp_pct,
      SUM(pgs.ftm) AS ftm,
      SUM(pgs.fta) AS fta,
      CASE
        WHEN SUM(pgs.fta) = 0 THEN 0
        ELSE ROUND(SUM(pgs.ftm) / SUM(pgs.fta), 4)
      END AS ft_pct
    FROM player_game_stats pgs
    JOIN players p ON p.player_id = pgs.player_id
    WHERE pgs.team_id = %s
    GROUP BY p.player_id, p.player_name
    ORDER BY pts DESC, p.player_name
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, (team_id,))
        rows = cur.fetchall()
        if not rows:
            cur.execute("SELECT 1 FROM teams WHERE team_id = %s", (team_id,))
            if cur.fetchone() is None:
                raise HTTPException(status_code=404, detail="team not found")
        return rows


@app.get("/teams/{team_id}/summary")
def team_summary(
    team_id: int,
    division: str | None = Query(None),
    year: str | None = Query(None),
    season_term: str | None = Query(None),
):
    division_id = normalize_division_id(division)
    season_year = normalize_year(year)
    normalized_season_term = normalize_season_term(season_term)
    if postgres_analytics_enabled():
        try:
            analytics_rows = fetch_postgres_team_analytics(
                division_id, season_year, normalized_season_term
            )
            analytics = next((row for row in analytics_rows if row["team_id"] == team_id), None)

            with get_postgres_conn() as conn, conn.cursor() as cur:
                cur.execute(
                    "SELECT team_id, team_name, division_id, division_label FROM teams WHERE team_id = %s",
                    (team_id,),
                )
                team = cur.fetchone()
                if team is None:
                    raise HTTPException(status_code=404, detail="team not found")

                cur.execute(
                    f"""
                    SELECT
                      p.player_id,
                      p.player_name,
                      COUNT(DISTINCT pgs.game_id) AS games_played,
                      SUM(pgs.pts) AS pts,
                      SUM(pgs.reb) AS reb,
                      SUM(pgs.ast) AS ast,
                      SUM(pgs.stl) AS stl,
                      SUM(pgs.blk) AS blk,
                      SUM(pgs.tov) AS tov,
                      SUM(pgs.fouls) AS fouls,
                      SUM(pgs.fgm) AS fgm,
                      SUM(pgs.fga) AS fga,
                      CASE WHEN SUM(pgs.fga) = 0 THEN 0 ELSE ROUND((SUM(pgs.fgm)::numeric / SUM(pgs.fga)), 4)::float8 END AS fg_pct,
                      SUM(pgs.tpm) AS tpm,
                      SUM(pgs.tpa) AS tpa,
                      CASE WHEN SUM(pgs.tpa) = 0 THEN 0 ELSE ROUND((SUM(pgs.tpm)::numeric / SUM(pgs.tpa)), 4)::float8 END AS tp_pct,
                      SUM(pgs.ftm) AS ftm,
                      SUM(pgs.fta) AS fta,
                      CASE WHEN SUM(pgs.fta) = 0 THEN 0 ELSE ROUND((SUM(pgs.ftm)::numeric / SUM(pgs.fta)), 4)::float8 END AS ft_pct
                    FROM player_game_stats pgs
                    JOIN players p ON p.player_id = pgs.player_id
                    WHERE pgs.team_id = %s
                      AND {postgres_filter_sql('pgs')}
                    GROUP BY p.player_id, p.player_name
                    ORDER BY SUM(pgs.pts) DESC, p.player_name
                    """,
                    (
                        team_id,
                        division_id,
                        division_id,
                        season_year,
                        season_year,
                        normalized_season_term,
                        normalized_season_term,
                    ),
                )
                players = cur.fetchall()

                cur.execute(
                    f"""
                    SELECT
                      COALESCE(SUM(tgt.pts), 0) AS pts,
                      COALESCE(SUM(tgt.reb), 0) AS reb,
                      COALESCE(SUM(tgt.ast), 0) AS ast,
                      COALESCE(SUM(tgt.stl), 0) AS stl,
                      COALESCE(SUM(tgt.blk), 0) AS blk,
                      COALESCE(SUM(tgt.tov), 0) AS tov,
                      COALESCE(SUM(tgt.pf), 0) AS fouls,
                      COALESCE(SUM(tgt.fgm), 0) AS fgm,
                      COALESCE(SUM(tgt.fga), 0) AS fga,
                      CASE WHEN COALESCE(SUM(tgt.fga), 0) = 0 THEN 0 ELSE ROUND((SUM(tgt.fgm)::numeric / SUM(tgt.fga)), 4)::float8 END AS fg_pct,
                      COALESCE(SUM(tgt.tpm), 0) AS tpm,
                      COALESCE(SUM(tgt.tpa), 0) AS tpa,
                      CASE WHEN COALESCE(SUM(tgt.tpa), 0) = 0 THEN 0 ELSE ROUND((SUM(tgt.tpm)::numeric / SUM(tgt.tpa)), 4)::float8 END AS tp_pct,
                      COALESCE(SUM(tgt.ftm), 0) AS ftm,
                      COALESCE(SUM(tgt.fta), 0) AS fta,
                      CASE WHEN COALESCE(SUM(tgt.fta), 0) = 0 THEN 0 ELSE ROUND((SUM(tgt.ftm)::numeric / SUM(tgt.fta)), 4)::float8 END AS ft_pct
                    FROM team_game_totals tgt
                    WHERE tgt.team_id = %s
                      AND {postgres_filter_sql('tgt')}
                    """,
                    (
                        team_id,
                        division_id,
                        division_id,
                        season_year,
                        season_year,
                        normalized_season_term,
                        normalized_season_term,
                    ),
                )
                totals = cur.fetchone() or {}

                cur.execute(
                    f"""
                    SELECT
                      g.game_id,
                      g.game_key,
                      COALESCE(TO_CHAR(g.game_date, 'FMMonth FMDD, YYYY'), '') AS game_date,
                      g.game_url,
                      CASE WHEN g.team1_id = %s THEN g.team2_name ELSE g.team1_name END AS opponent_team_name,
                      CASE WHEN g.team1_id = %s THEN g.team1_pts ELSE g.team2_pts END AS team_pts,
                      CASE WHEN g.team1_id = %s THEN g.team2_pts ELSE g.team1_pts END AS opponent_pts,
                      CASE
                        WHEN (CASE WHEN g.team1_id = %s THEN g.team1_pts ELSE g.team2_pts END)
                           > (CASE WHEN g.team1_id = %s THEN g.team2_pts ELSE g.team1_pts END) THEN 'W'
                        WHEN (CASE WHEN g.team1_id = %s THEN g.team1_pts ELSE g.team2_pts END)
                           < (CASE WHEN g.team1_id = %s THEN g.team2_pts ELSE g.team1_pts END) THEN 'L'
                        ELSE 'T'
                      END AS result
                    FROM games g
                    WHERE (g.team1_id = %s OR g.team2_id = %s)
                      AND {postgres_filter_sql('g')}
                    ORDER BY g.game_date DESC NULLS LAST, g.game_id DESC
                    LIMIT 5
                    """,
                    (
                        team_id,
                        team_id,
                        team_id,
                        team_id,
                        team_id,
                        team_id,
                        team_id,
                        team_id,
                        team_id,
                        division_id,
                        division_id,
                        season_year,
                        season_year,
                        normalized_season_term,
                        normalized_season_term,
                    ),
                )
                recent_games = cur.fetchall()

            analytics = analytics or {}
            return {
                "team_id": team_id,
                "division_id": analytics.get("division_id", team.get("division_id", "")),
                "division_label": analytics.get("division_label", team.get("division_label", "")),
                "team_name": team["team_name"],
                "games_played": analytics.get("games_played", 0) or 0,
                "wins": analytics.get("wins", 0) or 0,
                "losses": analytics.get("losses", 0) or 0,
                "pts": totals.get("pts", 0) or 0,
                "reb": totals.get("reb", 0) or 0,
                "ast": totals.get("ast", 0) or 0,
                "stl": totals.get("stl", 0) or 0,
                "blk": totals.get("blk", 0) or 0,
                "tov": totals.get("tov", 0) or 0,
                "fouls": totals.get("fouls", 0) or 0,
                "fgm": totals.get("fgm", 0) or 0,
                "fga": totals.get("fga", 0) or 0,
                "fg_pct": totals.get("fg_pct", 0) or 0,
                "tpm": totals.get("tpm", 0) or 0,
                "tpa": totals.get("tpa", 0) or 0,
                "tp_pct": totals.get("tp_pct", 0) or 0,
                "ftm": totals.get("ftm", 0) or 0,
                "fta": totals.get("fta", 0) or 0,
                "ft_pct": totals.get("ft_pct", 0) or 0,
                "win_pct": analytics.get("win_pct", 0) or 0,
                "offensive_rating": analytics.get("offensive_rating", 0) or 0,
                "defensive_rating": analytics.get("defensive_rating", 0) or 0,
                "net_rating": analytics.get("net_rating", 0) or 0,
                "strength_of_schedule": analytics.get("strength_of_schedule", 0) or 0,
                "opponent_win_pct": analytics.get("opponent_win_pct", 0) or 0,
                "adjusted_offensive_rating": analytics.get("adjusted_offensive_rating", 0) or 0,
                "adjusted_defensive_rating": analytics.get("adjusted_defensive_rating", 0) or 0,
                "adjusted_net_rating": analytics.get("adjusted_net_rating", 0) or 0,
                "players": players,
                "recent_games": recent_games,
            }
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    if csv_enabled():
        return build_team_summary_from_store(
            team_id,
            division_id=division_id,
            season_year=season_year,
            season_term=normalized_season_term,
        )

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT team_name FROM teams WHERE team_id = %s", (team_id,))
        team = cur.fetchone()
        if team is None:
            raise HTTPException(status_code=404, detail="team not found")

        cur.execute(
            """
            SELECT
              COUNT(DISTINCT pgs.game_id) AS games_played,
              SUM(pgs.pts) AS pts,
              SUM(pgs.reb) AS reb,
              SUM(pgs.ast) AS ast,
              SUM(pgs.stl) AS stl,
              SUM(pgs.blk) AS blk,
              SUM(pgs.tov) AS tov,
              SUM(pgs.fgm) AS fgm,
              SUM(pgs.fga) AS fga,
              CASE
                WHEN SUM(pgs.fga) = 0 THEN 0
                ELSE ROUND(SUM(pgs.fgm) / SUM(pgs.fga), 4)
              END AS fg_pct,
              SUM(pgs.tpm) AS tpm,
              SUM(pgs.tpa) AS tpa,
              CASE
                WHEN SUM(pgs.tpa) = 0 THEN 0
                ELSE ROUND(SUM(pgs.tpm) / SUM(pgs.tpa), 4)
              END AS tp_pct,
              SUM(pgs.ftm) AS ftm,
              SUM(pgs.fta) AS fta,
              CASE
                WHEN SUM(pgs.fta) = 0 THEN 0
                ELSE ROUND(SUM(pgs.ftm) / SUM(pgs.fta), 4)
              END AS ft_pct
            FROM player_game_stats pgs
            WHERE pgs.team_id = %s
            """,
            (team_id,),
        )
        totals = cur.fetchone() or {}

        cur.execute(
            """
            SELECT
              p.player_id,
              p.player_name,
              COUNT(DISTINCT pgs.game_id) AS games_played,
              SUM(pgs.pts) AS pts,
              SUM(pgs.reb) AS reb,
              SUM(pgs.ast) AS ast,
              SUM(pgs.stl) AS stl,
              SUM(pgs.blk) AS blk,
              SUM(pgs.tov) AS tov,
              SUM(pgs.fgm) AS fgm,
              SUM(pgs.fga) AS fga,
              CASE
                WHEN SUM(pgs.fga) = 0 THEN 0
                ELSE ROUND(SUM(pgs.fgm) / SUM(pgs.fga), 4)
              END AS fg_pct,
              SUM(pgs.tpm) AS tpm,
              SUM(pgs.tpa) AS tpa,
              CASE
                WHEN SUM(pgs.tpa) = 0 THEN 0
                ELSE ROUND(SUM(pgs.tpm) / SUM(pgs.tpa), 4)
              END AS tp_pct,
              SUM(pgs.ftm) AS ftm,
              SUM(pgs.fta) AS fta,
              CASE
                WHEN SUM(pgs.fta) = 0 THEN 0
                ELSE ROUND(SUM(pgs.ftm) / SUM(pgs.fta), 4)
              END AS ft_pct
            FROM player_game_stats pgs
            JOIN players p ON p.player_id = pgs.player_id
            WHERE pgs.team_id = %s
            GROUP BY p.player_id, p.player_name
            ORDER BY pts DESC, p.player_name
            """,
            (team_id,),
        )
        players = cur.fetchall()

        cur.execute(
            """
            SELECT
              g.id AS game_id,
              g.game_key,
              g.game_date,
              g.game_url,
              opp.team_name AS opponent_team_name,
              SUM(CASE WHEN pgs.team_id = %s THEN pgs.pts ELSE 0 END) AS team_pts,
              SUM(CASE WHEN pgs.team_id <> %s THEN pgs.pts ELSE 0 END) AS opponent_pts
            FROM player_game_stats pgs
            JOIN d3_games g ON g.id = pgs.game_id
            JOIN teams opp ON opp.team_id = CASE
              WHEN g.team1_id = %s THEN g.team2_id
              ELSE g.team1_id
            END
            WHERE g.team1_id = %s OR g.team2_id = %s
            GROUP BY g.id, g.game_key, g.game_date, g.game_url, opp.team_name
            ORDER BY g.game_date DESC, g.id DESC
            """,
            (team_id, team_id, team_id, team_id, team_id),
        )
        recent_games = cur.fetchall()

    wins = sum(1 for row in recent_games if row["team_pts"] > row["opponent_pts"])
    losses = sum(1 for row in recent_games if row["team_pts"] < row["opponent_pts"])
    for row in recent_games:
        row["result"] = "W" if row["team_pts"] > row["opponent_pts"] else "L" if row["team_pts"] < row["opponent_pts"] else "T"

    return {
        "team_id": team_id,
        "team_name": team["team_name"],
        "games_played": totals.get("games_played", 0) or 0,
        "wins": wins,
        "losses": losses,
        "pts": totals.get("pts", 0) or 0,
        "reb": totals.get("reb", 0) or 0,
        "ast": totals.get("ast", 0) or 0,
        "stl": totals.get("stl", 0) or 0,
        "blk": totals.get("blk", 0) or 0,
        "tov": totals.get("tov", 0) or 0,
        "fgm": totals.get("fgm", 0) or 0,
        "fga": totals.get("fga", 0) or 0,
        "fg_pct": totals.get("fg_pct", 0) or 0,
        "tpm": totals.get("tpm", 0) or 0,
        "tpa": totals.get("tpa", 0) or 0,
        "tp_pct": totals.get("tp_pct", 0) or 0,
        "ftm": totals.get("ftm", 0) or 0,
        "fta": totals.get("fta", 0) or 0,
        "ft_pct": totals.get("ft_pct", 0) or 0,
        "players": players,
        "recent_games": recent_games[:5],
    }


@app.get("/games")
def list_games(
    limit: int = Query(100, ge=1, le=500),
    division: str | None = Query(None),
    year: str | None = Query(None),
    season_term: str | None = Query(None),
    sort_by: str = Query("date_desc"),
):
    division_id = normalize_division_id(division)
    season_year = normalize_year(year)
    normalized_season_term = normalize_season_term(season_term)
    allowed_sorts = {
        "date_desc",
        "date_asc",
        "season_desc",
        "season_asc",
        "division_asc",
        "division_desc",
    }
    if sort_by not in allowed_sorts:
        raise HTTPException(status_code=400, detail=f"sort_by must be one of {sorted(allowed_sorts)}")
    if postgres_analytics_enabled():
        try:
            return fetch_postgres_games(
                division_id,
                season_year,
                normalized_season_term,
                sort_by,
                limit,
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    if csv_enabled():
        games = sort_games(
            [
                row
                for row in get_csv_store()["games"]
                if matches_filters(row, division_id, season_year, normalized_season_term)
            ],
            sort_by,
        )
        return games[:limit]

    sql = """
    SELECT
      g.id AS game_id,
      g.game_key,
      g.game_url,
      g.game_date,
      g.team1_id,
      t1.team_name AS team1_name,
      SUM(CASE WHEN pgs.team_id = g.team1_id THEN pgs.pts ELSE 0 END) AS team1_pts,
      g.team2_id,
      t2.team_name AS team2_name,
      SUM(CASE WHEN pgs.team_id = g.team2_id THEN pgs.pts ELSE 0 END) AS team2_pts
    FROM d3_games g
    LEFT JOIN teams t1 ON t1.team_id = g.team1_id
    LEFT JOIN teams t2 ON t2.team_id = g.team2_id
    LEFT JOIN player_game_stats pgs ON pgs.game_id = g.id
    GROUP BY g.id, g.game_key, g.game_url, g.game_date, g.team1_id, t1.team_name, g.team2_id, t2.team_name
    ORDER BY g.id DESC
    LIMIT %s
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, (limit,))
        return cur.fetchall()


@app.get("/games-page")
def list_games_page(
    page: int = Query(1, ge=1),
    limit: int = Query(40, ge=1, le=100),
    division: str | None = Query(None),
    year: str | None = Query(None),
    season_term: str | None = Query(None),
    sort_by: str = Query("date_desc"),
):
    division_id = normalize_division_id(division)
    season_year = normalize_year(year)
    normalized_season_term = normalize_season_term(season_term)
    allowed_sorts = {
        "date_desc",
        "date_asc",
        "season_desc",
        "season_asc",
        "division_asc",
        "division_desc",
    }
    if sort_by not in allowed_sorts:
        raise HTTPException(status_code=400, detail=f"sort_by must be one of {sorted(allowed_sorts)}")
    offset = (page - 1) * limit

    if postgres_analytics_enabled():
        try:
            with get_postgres_conn() as conn, conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT COUNT(*) AS total
                    FROM games g
                    WHERE {postgres_filter_sql('g')}
                    """,
                    (
                        division_id,
                        division_id,
                        season_year,
                        season_year,
                        normalized_season_term,
                        normalized_season_term,
                    ),
                )
                total = (cur.fetchone() or {}).get("total", 0) or 0
            items = fetch_postgres_games(
                division_id,
                season_year,
                normalized_season_term,
                sort_by,
                limit,
                offset,
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": limit,
            "total_pages": (total + limit - 1) // limit if total else 0,
        }

    if csv_enabled():
        games = list_games(
            limit=5000,
            division=division,
            year=year,
            season_term=season_term,
            sort_by=sort_by,
        )
        total = len(games)
        return {
            "items": games[offset : offset + limit],
            "total": total,
            "page": page,
            "page_size": limit,
            "total_pages": (total + limit - 1) // limit if total else 0,
        }

    return {"items": [], "total": 0, "page": page, "page_size": limit, "total_pages": 0}


@app.get("/games/{game_id}")
def get_game(game_id: int):
    if postgres_analytics_enabled():
        try:
            game = fetch_postgres_game_summary(game_id)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        if game is None:
            raise HTTPException(status_code=404, detail="game not found")
        return game

    if csv_enabled():
        game = next((row for row in get_csv_store()["games"] if row["game_id"] == game_id), None)
        if game is None:
            raise HTTPException(status_code=404, detail="game not found")
        return game

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              id AS game_id,
              game_key,
              game_url,
              game_date,
              team1_name,
              team1_pts,
              team2_name,
              team2_pts,
              venue,
              league
            FROM d3_games
            WHERE id = %s
            """,
            (game_id,),
        )
        game = cur.fetchone()
        if game is None:
            raise HTTPException(status_code=404, detail="game not found")
        return game


@app.get("/games/{game_id}/boxscore")
def game_boxscore(game_id: int):
    if postgres_analytics_enabled():
        sql = """
        SELECT
          t.team_name,
          p.player_name,
          pgs.pts,
          pgs.reb,
          pgs.ast,
          pgs.stl,
          pgs.blk,
          pgs.tov,
          pgs.fouls,
          pgs.fgm,
          pgs.fga,
          pgs.fg_pct,
          pgs.tpm,
          pgs.tpa,
          pgs.tp_pct,
          pgs.ftm,
          pgs.fta,
          pgs.ft_pct
        FROM player_game_stats pgs
        JOIN players p ON p.player_id = pgs.player_id
        JOIN teams t ON t.team_id = pgs.team_id
        WHERE pgs.game_id = %s
        ORDER BY t.team_name, pgs.pts DESC, p.player_name
        """
        try:
            with get_postgres_conn() as conn, conn.cursor() as cur:
                cur.execute(sql, (game_id,))
                rows = cur.fetchall()
                if not rows:
                    cur.execute("SELECT 1 FROM games WHERE game_id = %s", (game_id,))
                    if cur.fetchone() is None:
                        raise HTTPException(status_code=404, detail="game not found")
                return rows
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    if csv_enabled():
        store = get_csv_store()
        game_ids = {row["game_id"] for row in store["games"]}
        rows = [
            {
                "team_name": row["team_name"],
                "player_name": row["player_name"],
                "pts": row["pts"],
                "reb": row["reb"],
                "ast": row["ast"],
                "stl": row["stl"],
                "blk": row["blk"],
                "tov": row["tov"],
                "fouls": row["fouls"],
                "fgm": row["fgm"],
                "fga": row["fga"],
                "fg_pct": row["fg_pct"],
                "tpm": row["tpm"],
                "tpa": row["tpa"],
                "tp_pct": row["tp_pct"],
                "ftm": row["ftm"],
                "fta": row["fta"],
                "ft_pct": row["ft_pct"],
            }
            for row in store["player_game_rows"]
            if row["game_id"] == game_id
        ]
        rows.sort(key=lambda row: (row["team_name"], -row["pts"], row["player_name"]))
        if not rows and game_id not in game_ids:
            raise HTTPException(status_code=404, detail="game not found")
        return rows

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              t.team_name,
              p.player_name,
              pgs.pts,
              pgs.reb,
              pgs.ast,
              pgs.stl,
              pgs.blk,
              pgs.tov,
              pgs.fouls,
              pgs.fgm,
              pgs.fga,
              pgs.fg_pct,
              pgs.tpm,
              pgs.tpa,
              pgs.tp_pct,
              pgs.ftm,
              pgs.fta,
              pgs.ft_pct
            FROM player_game_stats pgs
            JOIN players p ON p.player_id = pgs.player_id
            JOIN teams t ON t.team_id = pgs.team_id
            WHERE pgs.game_id = %s
            ORDER BY t.team_name, pgs.pts DESC, p.player_name
            """,
            (game_id,),
        )
        rows = cur.fetchall()
        if not rows:
            cur.execute("SELECT 1 FROM d3_games WHERE id = %s", (game_id,))
            if cur.fetchone() is None:
                raise HTTPException(status_code=404, detail="game not found")
        return rows
