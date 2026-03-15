from __future__ import annotations

import argparse
from datetime import date, datetime

import psycopg
from dotenv import load_dotenv

import main as app_main

ROOT_DIR = app_main.ROOT_DIR
load_dotenv(ROOT_DIR / ".env")


DDL = """
CREATE TABLE IF NOT EXISTS teams (
    team_id INTEGER PRIMARY KEY,
    division_id TEXT NOT NULL,
    division_label TEXT NOT NULL,
    team_name TEXT NOT NULL,
    team_key TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
    player_id INTEGER PRIMARY KEY,
    player_name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS games (
    game_id INTEGER PRIMARY KEY,
    game_key TEXT NOT NULL UNIQUE,
    division_id TEXT NOT NULL,
    division_label TEXT NOT NULL,
    game_url TEXT,
    game_date DATE,
    season TEXT,
    season_year TEXT,
    season_term TEXT,
    venue TEXT,
    league TEXT,
    team1_id INTEGER REFERENCES teams(team_id),
    team1_name TEXT,
    team1_pts INTEGER NOT NULL DEFAULT 0,
    team2_id INTEGER REFERENCES teams(team_id),
    team2_name TEXT,
    team2_pts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS player_game_stats (
    game_id INTEGER NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    team_id INTEGER NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
    division_id TEXT NOT NULL,
    division_label TEXT NOT NULL,
    game_key TEXT NOT NULL,
    game_url TEXT,
    game_date DATE,
    season TEXT,
    season_year TEXT,
    season_term TEXT,
    team_name TEXT NOT NULL,
    pts INTEGER NOT NULL DEFAULT 0,
    reb INTEGER NOT NULL DEFAULT 0,
    ast INTEGER NOT NULL DEFAULT 0,
    stl INTEGER NOT NULL DEFAULT 0,
    blk INTEGER NOT NULL DEFAULT 0,
    tov INTEGER NOT NULL DEFAULT 0,
    fouls INTEGER NOT NULL DEFAULT 0,
    fgm INTEGER NOT NULL DEFAULT 0,
    fga INTEGER NOT NULL DEFAULT 0,
    fg_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
    tpm INTEGER NOT NULL DEFAULT 0,
    tpa INTEGER NOT NULL DEFAULT 0,
    tp_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
    ftm INTEGER NOT NULL DEFAULT 0,
    fta INTEGER NOT NULL DEFAULT 0,
    ft_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
    table_index INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (game_id, player_id, team_id)
);

CREATE TABLE IF NOT EXISTS team_game_totals (
    game_id INTEGER NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
    team_id INTEGER NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
    division_id TEXT NOT NULL,
    division_label TEXT NOT NULL,
    game_key TEXT NOT NULL,
    game_url TEXT,
    game_date DATE,
    season TEXT,
    season_year TEXT,
    season_term TEXT,
    table_index INTEGER NOT NULL,
    team_name TEXT NOT NULL,
    pts INTEGER NOT NULL DEFAULT 0,
    reb INTEGER NOT NULL DEFAULT 0,
    ast INTEGER NOT NULL DEFAULT 0,
    stl INTEGER NOT NULL DEFAULT 0,
    blk INTEGER NOT NULL DEFAULT 0,
    fgm INTEGER NOT NULL DEFAULT 0,
    fga INTEGER NOT NULL DEFAULT 0,
    fg_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
    tpm INTEGER NOT NULL DEFAULT 0,
    tpa INTEGER NOT NULL DEFAULT 0,
    tp_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
    ftm INTEGER NOT NULL DEFAULT 0,
    fta INTEGER NOT NULL DEFAULT 0,
    ft_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
    tov INTEGER NOT NULL DEFAULT 0,
    pf INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (game_id, team_id, table_index)
);

CREATE TABLE IF NOT EXISTS player_season_totals (
    division_id TEXT NOT NULL,
    division_label TEXT NOT NULL,
    season_year TEXT NOT NULL,
    season_term TEXT NOT NULL,
    player_id INTEGER NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    player_name TEXT NOT NULL,
    games_played INTEGER NOT NULL DEFAULT 0,
    pts INTEGER NOT NULL DEFAULT 0,
    reb INTEGER NOT NULL DEFAULT 0,
    ast INTEGER NOT NULL DEFAULT 0,
    stl INTEGER NOT NULL DEFAULT 0,
    blk INTEGER NOT NULL DEFAULT 0,
    tov INTEGER NOT NULL DEFAULT 0,
    fouls INTEGER NOT NULL DEFAULT 0,
    fgm INTEGER NOT NULL DEFAULT 0,
    fga INTEGER NOT NULL DEFAULT 0,
    tpm INTEGER NOT NULL DEFAULT 0,
    tpa INTEGER NOT NULL DEFAULT 0,
    ftm INTEGER NOT NULL DEFAULT 0,
    fta INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (division_id, season_year, season_term, player_id)
);

CREATE TABLE IF NOT EXISTS team_season_totals (
    division_id TEXT NOT NULL,
    division_label TEXT NOT NULL,
    season_year TEXT NOT NULL,
    season_term TEXT NOT NULL,
    team_id INTEGER NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
    team_name TEXT NOT NULL,
    games_played INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    ties INTEGER NOT NULL DEFAULT 0,
    points_for INTEGER NOT NULL DEFAULT 0,
    points_against INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (division_id, season_year, season_term, team_id)
);

CREATE INDEX IF NOT EXISTS idx_games_division_season ON games (division_id, season_year, season_term);
CREATE INDEX IF NOT EXISTS idx_games_date ON games (game_date DESC);
CREATE INDEX IF NOT EXISTS idx_teams_team_key ON teams (team_key);
CREATE INDEX IF NOT EXISTS idx_pgs_player ON player_game_stats (player_id);
CREATE INDEX IF NOT EXISTS idx_pgs_team ON player_game_stats (team_id);
CREATE INDEX IF NOT EXISTS idx_pgs_division_season ON player_game_stats (division_id, season_year, season_term);
CREATE INDEX IF NOT EXISTS idx_tgt_division_season ON team_game_totals (division_id, season_year, season_term);
"""


def parse_date_or_none(value: str | None) -> date | None:
    text = app_main.normalize_space(value)
    if not text:
        return None

    for fmt in ("%Y-%m-%d", "%B %d, %Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue

    return None


def get_conn():
    return psycopg.connect(
        host=app_main.os.getenv("DB_HOST", "localhost"),
        port=int(app_main.os.getenv("DB_PORT", "5432")),
        dbname=app_main.os.getenv("DB_NAME"),
        user=app_main.os.getenv("DB_USER"),
        password=app_main.os.getenv("DB_PASSWORD"),
    )


def truncate_tables(cur) -> None:
    cur.execute(
        """
        TRUNCATE TABLE
          player_season_totals,
          team_season_totals,
          player_game_stats,
          team_game_totals,
          games,
          players,
          teams
        RESTART IDENTITY CASCADE
        """
    )


def import_store(cur, store: dict[str, list[dict[str, object]]]) -> None:
    cur.executemany(
        """
        INSERT INTO teams (team_id, division_id, division_label, team_name, team_key)
        VALUES (%s, %s, %s, %s, %s)
        """,
        [
            (
                row["team_id"],
                row["division_id"],
                row["division_label"],
                row["team_name"],
                f'{row["division_id"]}:{app_main.clean_team_name(row["team_name"]).lower()}',
            )
            for row in store["teams"]
        ],
    )

    cur.executemany(
        "INSERT INTO players (player_id, player_name) VALUES (%s, %s)",
        [(row["player_id"], row["player_name"]) for row in store["players"]],
    )

    cur.executemany(
        """
        INSERT INTO games (
          game_id, game_key, division_id, division_label, game_url, game_date,
          season, season_year, season_term, venue, league,
          team1_id, team1_name, team1_pts, team2_id, team2_name, team2_pts
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        [
            (
                row["game_id"],
                row["game_key"],
                row["division_id"],
                row["division_label"],
                row["game_url"],
                parse_date_or_none(row.get("game_date")),
                row.get("season", ""),
                row.get("season_year", ""),
                row.get("season_term", ""),
                row.get("venue", ""),
                row.get("league", ""),
                row.get("team1_id"),
                row.get("team1_name", ""),
                row.get("team1_pts", 0),
                row.get("team2_id"),
                row.get("team2_name", ""),
                row.get("team2_pts", 0),
            )
            for row in store["games"]
        ],
    )

    cur.executemany(
        """
        INSERT INTO player_game_stats (
          game_id, player_id, team_id, division_id, division_label, game_key, game_url, game_date,
          season, season_year, season_term, team_name, pts, reb, ast, stl, blk, tov, fouls,
          fgm, fga, fg_pct, tpm, tpa, tp_pct, ftm, fta, ft_pct, table_index
        )
        VALUES (
          %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
          %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        )
        """,
        [
            (
                row["game_id"],
                row["player_id"],
                row["team_id"],
                row["division_id"],
                row["division_label"],
                row["game_key"],
                row.get("game_url", ""),
                parse_date_or_none(row.get("game_date")),
                row.get("season", ""),
                row.get("season_year", ""),
                row.get("season_term", ""),
                row["team_name"],
                row["pts"],
                row["reb"],
                row["ast"],
                row["stl"],
                row["blk"],
                row["tov"],
                row["fouls"],
                row["fgm"],
                row["fga"],
                row["fg_pct"],
                row["tpm"],
                row["tpa"],
                row["tp_pct"],
                row["ftm"],
                row["fta"],
                row["ft_pct"],
                row["table_index"],
            )
            for row in store["player_game_rows"]
        ],
    )

    cur.executemany(
        """
        INSERT INTO team_game_totals (
          game_id, team_id, division_id, division_label, game_key, game_url, game_date,
          season, season_year, season_term, table_index, team_name, pts, reb, ast, stl, blk,
          fgm, fga, fg_pct, tpm, tpa, tp_pct, ftm, fta, ft_pct, tov, pf
        )
        VALUES (
          %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
          %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        )
        """,
        [
            (
                row["game_id_int"],
                row["team_id"],
                row["division_id"],
                row["division_label"],
                row["game_key"],
                row.get("game_url", ""),
                parse_date_or_none(row.get("game_date")),
                row.get("season", ""),
                row.get("season_year", ""),
                row.get("season_term", ""),
                row["table_index"],
                row["team_name"],
                row["pts"],
                row["reb"],
                row["ast"],
                row["stl"],
                row["blk"],
                row["fgm"],
                row["fga"],
                row["fg_pct"],
                row["tpm"],
                row["tpa"],
                row["tp_pct"],
                row["ftm"],
                row["fta"],
                row["ft_pct"],
                row["tov"],
                row["pf"],
            )
            for row in store["team_totals"]
            if row.get("game_id_int") and row.get("team_id")
        ],
    )

    cur.execute(
        """
        INSERT INTO player_season_totals (
          division_id, division_label, season_year, season_term, player_id, player_name,
          games_played, pts, reb, ast, stl, blk, tov, fouls, fgm, fga, tpm, tpa, ftm, fta
        )
        SELECT
          pgs.division_id,
          MIN(pgs.division_label) AS division_label,
          COALESCE(NULLIF(pgs.season_year, ''), 'unknown') AS season_year,
          COALESCE(NULLIF(pgs.season_term, ''), 'ALL') AS season_term,
          pgs.player_id,
          MIN(p.player_name) AS player_name,
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
          SUM(pgs.tpm) AS tpm,
          SUM(pgs.tpa) AS tpa,
          SUM(pgs.ftm) AS ftm,
          SUM(pgs.fta) AS fta
        FROM player_game_stats pgs
        JOIN players p ON p.player_id = pgs.player_id
        GROUP BY
          pgs.division_id,
          COALESCE(NULLIF(pgs.season_year, ''), 'unknown'),
          COALESCE(NULLIF(pgs.season_term, ''), 'ALL'),
          pgs.player_id
        """
    )

    cur.execute(
        """
        INSERT INTO team_season_totals (
          division_id, division_label, season_year, season_term, team_id, team_name,
          games_played, wins, losses, ties, points_for, points_against
        )
        SELECT
          g.division_id,
          MIN(g.division_label) AS division_label,
          COALESCE(NULLIF(g.season_year, ''), 'unknown') AS season_year,
          COALESCE(NULLIF(g.season_term, ''), 'ALL') AS season_term,
          t.team_id,
          MIN(t.team_name) AS team_name,
          COUNT(*) AS games_played,
          SUM(CASE WHEN side.team_pts > side.opp_pts THEN 1 ELSE 0 END) AS wins,
          SUM(CASE WHEN side.team_pts < side.opp_pts THEN 1 ELSE 0 END) AS losses,
          SUM(CASE WHEN side.team_pts = side.opp_pts THEN 1 ELSE 0 END) AS ties,
          SUM(side.team_pts) AS points_for,
          SUM(side.opp_pts) AS points_against
        FROM (
          SELECT game_id, team1_id AS team_id, team1_pts AS team_pts, team2_pts AS opp_pts FROM games
          UNION ALL
          SELECT game_id, team2_id AS team_id, team2_pts AS team_pts, team1_pts AS opp_pts FROM games
        ) side
        JOIN games g ON g.game_id = side.game_id
        JOIN teams t ON t.team_id = side.team_id
        WHERE side.team_id IS NOT NULL
        GROUP BY
          g.division_id,
          COALESCE(NULLIF(g.season_year, ''), 'unknown'),
          COALESCE(NULLIF(g.season_term, ''), 'ALL'),
          t.team_id
        """
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import the current CSV-backed store into PostgreSQL for faster querying."
    )
    parser.add_argument(
        "--truncate",
        action="store_true",
        help="Explicitly rebuild all imported Postgres tables from scratch.",
    )
    args = parser.parse_args()

    store = app_main.get_csv_store()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(DDL)
            cur.execute("DROP INDEX IF EXISTS teams_team_key_key")
            if args.truncate:
                truncate_tables(cur)
            else:
                truncate_tables(cur)
            import_store(cur, store)
        conn.commit()

    print(
        f"Imported {len(store['games'])} games, {len(store['players'])} players, "
        f"{len(store['teams'])} teams, and {len(store['player_game_rows'])} player stat rows into PostgreSQL."
    )


if __name__ == "__main__":
    main()
