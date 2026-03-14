import csv
import os
from collections import defaultdict
from functools import lru_cache
from pathlib import Path

import pymysql
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).resolve().parent
load_dotenv(ROOT_DIR / ".env")

DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
]

DATA_SOURCE = os.getenv("DATA_SOURCE", "csv").strip().lower()
CSV_FILES = [
    ROOT_DIR / "games.csv",
    ROOT_DIR / "player_game_stats.csv",
    ROOT_DIR / "team_game_totals.csv",
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
    return tuple(path.stat().st_mtime_ns if path.exists() else 0 for path in CSV_FILES)


def read_csv_rows(path: Path):
    if not path.exists():
        raise FileNotFoundError(f"Missing CSV snapshot: {path}")
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


@lru_cache(maxsize=4)
def _load_csv_store(_snapshot_key):
    games_rows = read_csv_rows(ROOT_DIR / "games.csv")
    player_rows_raw = read_csv_rows(ROOT_DIR / "player_game_stats.csv")
    team_totals_raw = read_csv_rows(ROOT_DIR / "team_game_totals.csv")

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
            "venue": normalize_space(row.get("venue")),
            "league": normalize_space(row.get("league")),
        }

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
            }
            for totals in team_totals_by_game.values()
            for row in totals
        ],
    }


def get_csv_store():
    return _load_csv_store(csv_snapshot_key())


def csv_enabled():
    return DATA_SOURCE != "db"


def normalize_division_id(value):
    return normalize_space(value)


def matches_division(row, division_id):
    if not division_id:
        return True
    return normalize_division_id(row.get("division_id")) == division_id


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


@lru_cache(maxsize=4)
def _build_team_analytics(_snapshot_key):
    store = get_csv_store()
    teams_by_id = {
        row["team_id"]: {
            "team_id": row["team_id"],
            "team_name": row["team_name"],
            "division_id": row.get("division_id", ""),
            "division_label": row.get("division_label", ""),
            "games_played": 0,
            "wins": 0,
            "losses": 0,
            "ties": 0,
            "points_for": 0,
            "points_against": 0,
            "opponents": [],
        }
        for row in store["teams"]
    }

    for game in store["games"]:
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


def build_team_summary_from_store(team_id: int):
    store = get_csv_store()
    analytics_by_id = get_team_analytics_store()
    team_by_id = {row["team_id"]: row for row in store["teams"]}
    team_row = team_by_id.get(team_id)
    if team_row is None:
        raise HTTPException(status_code=404, detail="team not found")
    team_name = team_row["team_name"]

    team_game_rows = []
    for game in store["games"]:
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
        if row["team_id"] != team_id:
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

    totals_rows = [row for row in store["team_totals"] if row["team_id"] == team_id]
    total_fga = sum(row["fga"] for row in totals_rows)
    total_tpa = sum(row["tpa"] for row in totals_rows)
    total_fta = sum(row["fta"] for row in totals_rows)
    wins = sum(1 for row in team_game_rows if row["result"] == "W")
    losses = sum(1 for row in team_game_rows if row["result"] == "L")

    recent_games = sorted(
        team_game_rows,
        key=lambda row: (row["game_date"] or "", row["game_id"]),
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
    if csv_enabled():
        return list_divisions_from_store()
    return []


@app.get("/players")
def get_players(division: str | None = Query(None)):
    division_id = normalize_division_id(division)
    if csv_enabled():
        store = get_csv_store()
        if not division_id:
            players = {}
            for row in store["player_game_rows"]:
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
                if not matches_division(row, division_id):
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


@app.get("/players/{player_id}/games")
def player_game_log(
    player_id: int,
    limit: int = Query(50, ge=1, le=500),
    division: str | None = Query(None),
):
    division_id = normalize_division_id(division)
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
            if row["player_id"] == player_id and matches_division(row, division_id)
        ]
        rows.sort(key=lambda row: (row["game_date"] or "", row["game_id"]), reverse=True)
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
):
    division_id = normalize_division_id(division)
    if csv_enabled():
        totals = {}
        for row in get_csv_store()["player_game_rows"]:
            if not matches_division(row, division_id):
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
def list_teams(division: str | None = Query(None)):
    division_id = normalize_division_id(division)
    if csv_enabled():
        return sorted(
            [
                row
                for row in get_team_analytics_store().values()
                if matches_division(row, division_id)
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
def team_summary(team_id: int):
    if csv_enabled():
        return build_team_summary_from_store(team_id)

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
):
    division_id = normalize_division_id(division)
    if csv_enabled():
        games = sorted(
            [
                row
                for row in get_csv_store()["games"]
                if matches_division(row, division_id)
            ],
            key=lambda row: (row["game_date"] or "", row["game_id"]),
            reverse=True,
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


@app.get("/games/{game_id}/boxscore")
def game_boxscore(game_id: int):
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
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, (game_id,))
        rows = cur.fetchall()
        if not rows:
            cur.execute("SELECT 1 FROM d3_games WHERE id = %s", (game_id,))
            if cur.fetchone() is None:
                raise HTTPException(status_code=404, detail="game not found")
        return rows
