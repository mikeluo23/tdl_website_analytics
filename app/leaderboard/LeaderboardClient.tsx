"use client";

import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { apiGet } from "@/lib/api";
import {
  axisTickStyle,
  chartPalette,
  gridStroke,
  piePalette,
} from "@/app/components/chartTheme";
import AnalyticsMethodology from "@/app/components/AnalyticsMethodology";
import ChartTooltip from "@/app/components/ChartTooltip";
import {
  calcGameScore,
  calcEfgPercent,
  calcPointsPerShotAttempt,
  calcRate,
  calcRatio,
  calcShotDiet,
  calcTsPercent,
  calcTurnoverRateProxy,
  calcTwoPointAttemptRate,
  calcTwoPointPercent,
  formatFixed,
  roundTo,
} from "@/lib/stats";
import { normalizeDivision, withDivision, withQuery } from "@/lib/divisions";

type Row = Record<string, unknown>;
type SortKey =
  | "ppg"
  | "rpg"
  | "apg"
  | "ts"
  | "efg"
  | "ast_to"
  | "threepar"
  | "ftr"
  | "stocks_pg"
  | "tov_rate"
  | "ppsa"
  | "two_pct"
  | "two_par"
  | "game_score"
  | "pts"
  | "reb"
  | "ast";

type ExplorerMetricKey =
  | "ppg"
  | "rpg"
  | "apg"
  | "ts"
  | "efg"
  | "ast_to"
  | "threepar"
  | "ftr"
  | "stocks_pg"
  | "tov_rate"
  | "ppsa"
  | "two_pct"
  | "two_par"
  | "game_score"
  | "fg_pct"
  | "tp_pct"
  | "ft_pct"
  | "two_point_share"
  | "three_point_share"
  | "free_throw_share"
  | "gp";

type PlayerPoolSize = 50 | 100 | 200 | 5000;

const explorerMetricOptions: { key: ExplorerMetricKey; label: string }[] = [
  { key: "ppg", label: "PPG" },
  { key: "rpg", label: "RPG" },
  { key: "apg", label: "APG" },
  { key: "ts", label: "TS%" },
  { key: "efg", label: "eFG%" },
  { key: "ast_to", label: "AST/TO" },
  { key: "threepar", label: "3PA Rate" },
  { key: "ftr", label: "FT Rate" },
  { key: "stocks_pg", label: "Stocks / G" },
  { key: "tov_rate", label: "TOV Rate" },
  { key: "ppsa", label: "Pts / Shot Att" },
  { key: "two_pct", label: "2P%" },
  { key: "two_par", label: "2PA Rate" },
  { key: "game_score", label: "Game Score / G" },
  { key: "fg_pct", label: "FG%" },
  { key: "tp_pct", label: "3P%" },
  { key: "ft_pct", label: "FT%" },
  { key: "two_point_share", label: "2PT Share" },
  { key: "three_point_share", label: "3PT Share" },
  { key: "free_throw_share", label: "FT Share" },
  { key: "gp", label: "Games Played" },
];

function num(x: unknown): number {
  const value = Number(x);
  return Number.isFinite(value) ? value : 0;
}

function safeName(row: Row) {
  return (row.player_name ?? row.name ?? "").toString();
}

function safeId(row: Row) {
  return num(row.player_id ?? row.id);
}

function getGP(row: Row) {
  return num(row.games_played ?? row.gp ?? row.games);
}

export default function LeaderboardClient() {
  const searchParams = useSearchParams();
  const division = normalizeDivision(searchParams.get("division"));
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"per_game" | "totals">("per_game");
  const [sortKey, setSortKey] = useState<SortKey>("ppg");
  const [sortDirection, setSortDirection] = useState<"desc" | "asc">("desc");
  const [minGP, setMinGP] = useState<number>(2);
  const [playerPoolSize, setPlayerPoolSize] = useState<PlayerPoolSize>(5000);
  const [q, setQ] = useState<string>("");
  const [xMetric, setXMetric] = useState<ExplorerMetricKey>("ppg");
  const [yMetric, setYMetric] = useState<ExplorerMetricKey>("ts");
  const [zMetric, setZMetric] = useState<ExplorerMetricKey | "none">("gp");
  const headerScrollRef = useRef<HTMLDivElement | null>(null);
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  const tableContentRef = useRef<HTMLTableElement | null>(null);
  const rangeInputRef = useRef<HTMLInputElement | null>(null);
  const progressLabelRef = useRef<HTMLSpanElement | null>(null);
  const syncingRef = useRef<"header" | "body" | null>(null);
  const scrollLeftRef = useRef(0);
  const pendingScrollLeftRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const [stickyTop, setStickyTop] = useState(0);
  const [maxScrollLeft, setMaxScrollLeft] = useState(0);

  useEffect(() => {
    apiGet<Row[]>(
      withQuery("/leaderboard", {
        division: division || undefined,
        limit: String(playerPoolSize),
      }),
    )
      .then((data) => {
        setRows(data);
        setErr(null);
      })
      .catch((error) => setErr(String(error)));
  }, [division, playerPoolSize]);

  useEffect(() => {
    const nav = document.querySelector<HTMLElement>("[data-sticky-nav]");
    if (!nav) return;

    const updateStickyTop = () => {
      const navHeight = nav.getBoundingClientRect().height;
      setStickyTop(navHeight);
    };

    updateStickyTop();
    const observer = new ResizeObserver(updateStickyTop);
    observer.observe(nav);
    window.addEventListener("resize", updateStickyTop);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateStickyTop);
    };
  }, []);

  useLayoutEffect(() => {
    const updateMetrics = () => {
      const scrollWidth = tableContentRef.current?.scrollWidth ?? 0;
      const viewportWidth = bodyScrollRef.current?.clientWidth ?? 0;
      const nextMaxScrollLeft = Math.max(scrollWidth - viewportWidth, 0);

      setMaxScrollLeft(nextMaxScrollLeft);
      scrollLeftRef.current = Math.min(
        bodyScrollRef.current?.scrollLeft ?? 0,
        nextMaxScrollLeft,
      );
    };

    updateMetrics();
    const observer = new ResizeObserver(updateMetrics);
    if (tableContentRef.current) observer.observe(tableContentRef.current);
    if (bodyScrollRef.current) observer.observe(bodyScrollRef.current);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const updateScrollUI = (nextScrollLeft: number) => {
      scrollLeftRef.current = nextScrollLeft;

      if (rangeInputRef.current) {
        rangeInputRef.current.value = String(Math.min(nextScrollLeft, Math.max(maxScrollLeft, 1)));
      }

      if (progressLabelRef.current) {
        progressLabelRef.current.textContent =
          maxScrollLeft > 0
            ? `${Math.round((nextScrollLeft / maxScrollLeft) * 100)}%`
            : "Fit";
      }
    };

    updateScrollUI(scrollLeftRef.current);
  }, [maxScrollLeft]);

  useEffect(() => {
    const header = headerScrollRef.current;
    const body = bodyScrollRef.current;
    if (!header || !body) return;

    const flushScrollUI = () => {
      animationFrameRef.current = null;
      const nextScrollLeft = pendingScrollLeftRef.current;

      if (rangeInputRef.current) {
        rangeInputRef.current.value = String(Math.min(nextScrollLeft, Math.max(maxScrollLeft, 1)));
      }

      if (progressLabelRef.current) {
        progressLabelRef.current.textContent =
          maxScrollLeft > 0
            ? `${Math.round((nextScrollLeft / maxScrollLeft) * 100)}%`
            : "Fit";
      }

      scrollLeftRef.current = nextScrollLeft;
    };

    const scheduleScrollUI = (nextScrollLeft: number) => {
      pendingScrollLeftRef.current = nextScrollLeft;
      if (animationFrameRef.current !== null) return;
      animationFrameRef.current = window.requestAnimationFrame(flushScrollUI);
    };

    const syncHeader = () => {
      if (syncingRef.current === "body") return;
      syncingRef.current = "header";
      body.scrollLeft = header.scrollLeft;
      scheduleScrollUI(header.scrollLeft);
      syncingRef.current = null;
    };

    const syncBody = () => {
      if (syncingRef.current === "header") return;
      syncingRef.current = "body";
      header.scrollLeft = body.scrollLeft;
      scheduleScrollUI(body.scrollLeft);
      syncingRef.current = null;
    };

    header.addEventListener("scroll", syncHeader, { passive: true });
    body.addEventListener("scroll", syncBody, { passive: true });

    return () => {
      header.removeEventListener("scroll", syncHeader);
      body.removeEventListener("scroll", syncBody);
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [maxScrollLeft]);

  const cleaned = useMemo(() => {
    const normalized = rows.map((row) => {
      const gp = getGP(row);
      const pts = num(row.pts ?? row.points);
      const reb = num(row.reb ?? row.rebounds);
      const ast = num(row.ast ?? row.assists);
      const tov = num(row.tov);
      const fga = num(row.fga);
      const fgm = num(row.fgm);
      const tpa = num(row.tpa);
      const tpm = num(row.tpm);
      const fta = num(row.fta);
      const ftm = num(row.ftm);
      const fouls = num(row.fouls);
      const shotDiet = calcShotDiet(fgm, tpm, ftm);
      const gameScoreTotal = calcGameScore(
        pts,
        fgm,
        fga,
        ftm,
        fta,
        reb,
        ast,
        num(row.stl),
        num(row.blk),
        fouls,
        tov,
      );

      return {
        player_id: safeId(row),
        player_name: safeName(row),
        division_labels: Array.isArray(row.division_labels)
          ? row.division_labels.map((value) => String(value))
          : [],
        gp,
        pts,
        reb,
        ast,
        stl: num(row.stl),
        blk: num(row.blk),
        tov,
        fouls,
        fgm,
        fga,
        fg_pct: calcRate(fgm, fga),
        tpm,
        tpa,
        tp_pct: calcRate(tpm, tpa),
        ftm,
        fta,
        ft_pct: calcRate(ftm, fta),
        ppg: roundTo(pts / (gp || 1)),
        rpg: roundTo(reb / (gp || 1)),
        apg: roundTo(ast / (gp || 1)),
        ts: calcTsPercent(pts, fga, fta),
        efg: calcEfgPercent(fgm, tpm, fga),
        ast_to: calcRatio(ast, tov),
        threepar: calcRate(tpa, fga),
        ftr: calcRate(fta, fga),
        stocks_pg: roundTo((num(row.stl) + num(row.blk)) / (gp || 1)),
        tov_rate: calcTurnoverRateProxy(tov, fga, fta),
        ppsa: calcPointsPerShotAttempt(pts, fga, fta),
        two_pct: calcTwoPointPercent(fgm, tpm, fga, tpa),
        two_par: calcTwoPointAttemptRate(fga, tpa),
        game_score: roundTo(gameScoreTotal / (gp || 1)),
        two_point_share: shotDiet.twoPointShare,
        three_point_share: shotDiet.threePointShare,
        free_throw_share: shotDiet.freeThrowShare,
      };
    });

    return normalized
      .filter((row) => row.player_id > 0)
      .filter((row) => row.gp >= minGP)
      .filter((row) =>
        q.trim()
          ? row.player_name.toLowerCase().includes(q.trim().toLowerCase())
          : true,
      )
      .sort((a, b) =>
        sortDirection === "desc"
          ? num(b[sortKey]) - num(a[sortKey])
          : num(a[sortKey]) - num(b[sortKey]),
      );
  }, [rows, minGP, q, sortDirection, sortKey]);

  const tableRows = useMemo(
    () =>
      cleaned.map((row) => ({
        ...row,
        show_pts: mode === "totals" ? row.pts : row.ppg,
        show_reb: mode === "totals" ? row.reb : row.rpg,
        show_ast: mode === "totals" ? row.ast : row.apg,
      })),
    [cleaned, mode],
  );

  const top10 = useMemo(
    () =>
      tableRows.slice(0, 10).map((row) => ({
        name: row.player_name,
        value: row.show_pts,
        player_id: row.player_id,
      })),
    [tableRows],
  );

  const scatter = useMemo(
    () =>
      cleaned.map((row) => ({
        name: row.player_name,
        ppg: row.ppg,
        ts: row.ts,
        gp: row.gp,
      })),
    [cleaned],
  );

  const scatterHighlights = useMemo(
    () =>
      [...scatter]
        .sort((a, b) => b.ppg + b.ts / 12 - (a.ppg + a.ts / 12))
        .slice(0, 6),
    [scatter],
  );

  const creators = useMemo(
    () =>
      cleaned
        .filter((row) => row.gp >= Math.max(minGP, 2) && row.ast > 0)
        .sort((a, b) => b.ast_to - a.ast_to)
        .slice(0, 8)
        .map((row) => ({
          name: row.player_name,
          ast_to: row.ast_to,
        })),
    [cleaned, minGP],
  );

  const spacingMap = useMemo(
    () =>
      cleaned.map((row) => ({
        name: row.player_name,
        threepar: row.threepar,
        ts: row.ts,
        gp: row.gp,
      })),
    [cleaned],
  );

  const spacingHighlights = useMemo(
    () =>
      [...spacingMap]
        .sort((a, b) => b.threepar + b.ts / 10 - (a.threepar + a.ts / 10))
        .slice(0, 6),
    [spacingMap],
  );

  const shotMix = useMemo(() => {
    const totals = cleaned.reduce(
      (acc, row) => {
        acc.twoPoint += Math.max((row.fgm - row.tpm) * 2, 0);
        acc.threePoint += row.tpm * 3;
        acc.freeThrow += row.ftm;
        return acc;
      },
      { twoPoint: 0, threePoint: 0, freeThrow: 0 },
    );

    return [
      { name: "2PT Points", value: totals.twoPoint },
      { name: "3PT Points", value: totals.threePoint },
      { name: "FT Points", value: totals.freeThrow },
    ].filter((segment) => segment.value > 0);
  }, [cleaned]);

  const metricLeaders = useMemo(() => {
    const sample = cleaned.filter((row) => row.gp >= Math.max(minGP, 3));
    return {
      scoring: sample[0] ?? null,
      efficiency: [...sample].sort((a, b) => b.ts - a.ts)[0] ?? null,
      playmaking: [...sample].sort((a, b) => b.ast_to - a.ast_to)[0] ?? null,
    };
  }, [cleaned, minGP]);

  const showDivisionColumn = useMemo(
    () => !division && cleaned.some((row) => row.division_labels.length > 0),
    [cleaned, division],
  );

  const columns = useMemo(
    () => [
      { key: "player", label: "Player", align: "left", width: "18rem" },
      ...(showDivisionColumn
        ? [{ key: "divisions", label: "Divisions", align: "left", width: "14rem" }]
        : []),
      { key: "gp", label: "GP", align: "right", width: "5rem" },
      { key: "pts", label: mode === "totals" ? "PTS" : "PPG", align: "right", width: "6.75rem" },
      { key: "reb", label: mode === "totals" ? "REB" : "RPG", align: "right", width: "6.75rem" },
      { key: "ast", label: mode === "totals" ? "AST" : "APG", align: "right", width: "6.75rem" },
      { key: "ts", label: "TS%", align: "right", width: "6.75rem" },
      { key: "efg", label: "eFG%", align: "right", width: "6.75rem" },
      { key: "ast_to", label: "AST/TO", align: "right", width: "6.75rem" },
      { key: "stocks_pg", label: "Stocks/G", align: "right", width: "6.75rem" },
      { key: "tov_rate", label: "TOV Rate", align: "right", width: "6.75rem" },
      { key: "ppsa", label: "Pts/Shot", align: "right", width: "6.75rem" },
      { key: "two_pct", label: "2P%", align: "right", width: "6.75rem" },
      { key: "two_par", label: "2PA Rate", align: "right", width: "6.75rem" },
      { key: "game_score", label: "Game Score/G", align: "right", width: "7.5rem" },
      { key: "threepar", label: "3PA Rate", align: "right", width: "6.75rem" },
      { key: "ftr", label: "FT Rate", align: "right", width: "6.75rem" },
      { key: "fg_pct", label: "FG%", align: "right", width: "6.75rem" },
      { key: "tp_pct", label: "3P%", align: "right", width: "6.75rem" },
      { key: "ft_pct", label: "FT%", align: "right", width: "6.75rem" },
    ],
    [mode, showDivisionColumn],
  );
  const tableMinWidth = useMemo(
    () => columns.reduce((total, column) => total + Number.parseFloat(column.width), 0),
    [columns],
  );

  const explorerMetricLabel = (key: ExplorerMetricKey | "none") =>
    explorerMetricOptions.find((option) => option.key === key)?.label ?? key;

  const explorerData = useMemo(
    () =>
      cleaned.map((row) => ({
        name: row.player_name,
        x: num(row[xMetric]),
        y: num(row[yMetric]),
        z: zMetric === "none" ? 1 : Math.max(num(row[zMetric]), 0.1),
      })),
    [cleaned, xMetric, yMetric, zMetric],
  );

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Leaderboard</h1>
            <p className="mt-1 text-sm text-zinc-400">
              {cleaned.length} players shown | map pool{" "}
              {playerPoolSize === 5000 ? "all" : `top ${playerPoolSize}`} | min GP {minGP}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/40">
              <button
                className={`px-3 py-2 text-sm ${
                  mode === "per_game"
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-300 hover:text-white"
                }`}
                onClick={() => setMode("per_game")}
              >
                Per Game
              </button>
              <button
                className={`px-3 py-2 text-sm ${
                  mode === "totals"
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-300 hover:text-white"
                }`}
                onClick={() => setMode("totals")}
              >
                Totals
              </button>
            </div>

            <select
              className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-white"
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value as SortKey)}
            >
              <option value="ppg">Sort: PPG</option>
              <option value="rpg">Sort: RPG</option>
              <option value="apg">Sort: APG</option>
              <option value="ts">Sort: TS%</option>
              <option value="efg">Sort: eFG%</option>
              <option value="ast_to">Sort: AST/TO</option>
              <option value="threepar">Sort: 3PA Rate</option>
              <option value="ftr">Sort: FT Rate</option>
              <option value="stocks_pg">Sort: Stocks / G</option>
              <option value="tov_rate">Sort: TOV Rate</option>
              <option value="ppsa">Sort: Points / Shot Att</option>
              <option value="two_pct">Sort: 2P%</option>
              <option value="two_par">Sort: 2PA Rate</option>
              <option value="game_score">Sort: Game Score / G</option>
              <option value="pts">Sort: Total PTS</option>
              <option value="reb">Sort: Total REB</option>
              <option value="ast">Sort: Total AST</option>
            </select>

            <div className="flex overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/40">
              <button
                className={`px-3 py-2 text-sm ${
                  sortDirection === "desc"
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-300 hover:text-white"
                }`}
                onClick={() => setSortDirection("desc")}
              >
                Desc
              </button>
              <button
                className={`px-3 py-2 text-sm ${
                  sortDirection === "asc"
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-300 hover:text-white"
                }`}
                onClick={() => setSortDirection("asc")}
              >
                Asc
              </button>
            </div>

            <input
              className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-white placeholder:text-zinc-500"
              placeholder="Search..."
              value={q}
              onChange={(event) => setQ(event.target.value)}
            />

            <input
              className="w-28 rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-white"
              type="number"
              min={0}
              step={1}
              value={minGP}
              onChange={(event) => setMinGP(Math.max(0, Number(event.target.value)))}
              title="Minimum games played"
            />

            <select
              className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-white"
              value={playerPoolSize}
              onChange={(event) =>
                setPlayerPoolSize(Number(event.target.value) as PlayerPoolSize)
              }
              title="Players loaded into leaderboard charts and table"
            >
              <option value={50}>Map Pool: Top 50</option>
              <option value={100}>Map Pool: Top 100</option>
              <option value={200}>Map Pool: Top 200</option>
              <option value={5000}>Map Pool: All</option>
            </select>
          </div>
        </div>

        {err ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-red-300">
            {err}
          </div>
        ) : null}

        <div className="mb-6 grid gap-4 lg:grid-cols-3">
          <div className="rounded-[26px] border border-sky-400/20 bg-slate-950/65 p-5 shadow-[0_20px_60px_rgba(8,15,29,0.45)] backdrop-blur">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Top Scorer</div>
            <div className="mt-2 text-xl font-semibold text-white">
              {metricLeaders.scoring?.player_name ?? "-"}
            </div>
            <div className="mt-1 text-sm text-zinc-400">
              {metricLeaders.scoring ? `${formatFixed(metricLeaders.scoring.ppg)} PPG` : ""}
            </div>
          </div>
          <div className="rounded-[26px] border border-cyan-400/20 bg-slate-950/65 p-5 shadow-[0_20px_60px_rgba(8,15,29,0.45)] backdrop-blur">
            <div className="text-xs uppercase tracking-wide text-zinc-500">
              Best TS% (min 3 GP)
            </div>
            <div className="mt-2 text-xl font-semibold text-white">
              {metricLeaders.efficiency?.player_name ?? "-"}
            </div>
            <div className="mt-1 text-sm text-zinc-400">
              {metricLeaders.efficiency ? `${formatFixed(metricLeaders.efficiency.ts)}%` : ""}
            </div>
          </div>
          <div className="rounded-[26px] border border-blue-400/20 bg-slate-950/65 p-5 shadow-[0_20px_60px_rgba(8,15,29,0.45)] backdrop-blur">
            <div className="text-xs uppercase tracking-wide text-zinc-500">
              Best AST/TO (min 3 GP)
            </div>
            <div className="mt-2 text-xl font-semibold text-white">
              {metricLeaders.playmaking?.player_name ?? "-"}
            </div>
            <div className="mt-1 text-sm text-zinc-400">
              {metricLeaders.playmaking ? formatFixed(metricLeaders.playmaking.ast_to) : ""}
            </div>
          </div>
        </div>

        <div className="mb-6 grid gap-6 xl:grid-cols-2">
          <div className="rounded-[28px] border border-sky-400/20 bg-slate-950/65 p-5 shadow-[0_20px_60px_rgba(8,15,29,0.45)] backdrop-blur">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold text-white">
                Top 10 {mode === "totals" ? "Scoring Totals" : "Scoring Rate"}
              </h2>
              <span className="text-xs uppercase tracking-[0.2em] text-sky-200/80">
                {mode === "totals" ? "PTS" : "PPG"}
              </span>
            </div>
            <div style={{ width: "100%", height: 320 }}>
              <ResponsiveContainer>
                <BarChart data={top10} layout="vertical" margin={{ left: 10, right: 10 }}>
                  <CartesianGrid stroke={gridStroke} horizontal={false} />
                  <XAxis type="number" tick={axisTickStyle} />
                  <YAxis type="category" dataKey="name" width={160} tick={axisTickStyle} />
                  <Tooltip
                    cursor={{ fill: "rgba(56, 189, 248, 0.08)" }}
                    content={<ChartTooltip />}
                  />
                  <Bar dataKey="value" radius={[0, 12, 12, 0]}>
                    {top10.map((entry, index) => (
                      <Cell
                        key={`${entry.player_id}-${entry.name}`}
                        fill={chartPalette[index % chartPalette.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Switch Per Game / Totals to compare volume or rate.
            </p>
          </div>

          <div className="rounded-[28px] border border-cyan-400/20 bg-slate-950/65 p-5 shadow-[0_20px_60px_rgba(8,15,29,0.45)] backdrop-blur">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold text-white">Efficiency Map</h2>
              <span className="text-xs uppercase tracking-[0.2em] text-cyan-200/80">
                TS% vs PPG
              </span>
            </div>
            <div style={{ width: "100%", height: 320 }}>
              <ResponsiveContainer>
                <ScatterChart margin={{ left: 10, right: 10 }}>
                  <CartesianGrid stroke={gridStroke} />
                  <XAxis
                    type="number"
                    dataKey="ppg"
                    name="PPG"
                    tick={axisTickStyle}
                    stroke="rgba(125, 211, 252, 0.45)"
                  />
                  <YAxis
                    type="number"
                    dataKey="ts"
                    name="TS%"
                    tick={axisTickStyle}
                    stroke="rgba(34, 211, 238, 0.45)"
                  />
                  <ZAxis type="number" dataKey="gp" range={[40, 240]} name="GP" />
                  <Tooltip
                    cursor={{ strokeDasharray: "4 4", stroke: "rgba(96, 165, 250, 0.55)" }}
                    content={<ChartTooltip showPointName />}
                  />
                  <Scatter
                    data={scatter}
                    fill="#38bdf8"
                    fillOpacity={0.52}
                    stroke="#7dd3fc"
                    strokeWidth={1}
                  />
                  <Scatter
                    data={scatterHighlights}
                    fill="#67e8f9"
                    stroke="#60a5fa"
                    strokeWidth={1.5}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Upper-right is the sweet spot: volume and efficiency together.
            </p>
          </div>
        </div>

        <div className="mb-6 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="grid gap-6">
            <div className="rounded-[28px] border border-blue-400/20 bg-slate-950/65 p-5 shadow-[0_20px_60px_rgba(8,15,29,0.45)] backdrop-blur">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold text-white">Playmaking Security</h2>
                <span className="text-xs uppercase tracking-[0.2em] text-blue-200/80">
                  AST/TO
                </span>
              </div>
              <div style={{ width: "100%", height: 320 }}>
                <ResponsiveContainer>
                  <BarChart data={creators} margin={{ left: 6, right: 10, top: 8 }}>
                    <CartesianGrid stroke={gridStroke} vertical={false} />
                    <XAxis
                      dataKey="name"
                      interval={0}
                      angle={-20}
                      textAnchor="end"
                      height={72}
                      tick={axisTickStyle}
                    />
                    <YAxis tick={axisTickStyle} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="ast_to" radius={[12, 12, 0, 0]} fill="#38bdf8" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Useful for finding ball-handlers who create without bleeding possessions.
              </p>
            </div>

            <div className="rounded-[28px] border border-violet-400/20 bg-slate-950/65 p-5 shadow-[0_20px_60px_rgba(8,15,29,0.45)] backdrop-blur">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-white">Relationship Explorer</h2>
                  <p className="text-sm text-slate-400">
                    Compare any three metrics with X, Y, and bubble size controls.
                  </p>
                </div>
              </div>
              <div className="mb-4 grid gap-3 md:grid-cols-3">
                <select
                  className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-white"
                  value={xMetric}
                  onChange={(event) => setXMetric(event.target.value as ExplorerMetricKey)}
                >
                  {explorerMetricOptions.map((option) => (
                    <option key={`x-${option.key}`} value={option.key}>
                      X: {option.label}
                    </option>
                  ))}
                </select>
                <select
                  className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-white"
                  value={yMetric}
                  onChange={(event) => setYMetric(event.target.value as ExplorerMetricKey)}
                >
                  {explorerMetricOptions.map((option) => (
                    <option key={`y-${option.key}`} value={option.key}>
                      Y: {option.label}
                    </option>
                  ))}
                </select>
                <select
                  className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-white"
                  value={zMetric}
                  onChange={(event) =>
                    setZMetric(event.target.value as ExplorerMetricKey | "none")
                  }
                >
                  <option value="none">Bubble Size: Fixed</option>
                  {explorerMetricOptions.map((option) => (
                    <option key={`z-${option.key}`} value={option.key}>
                      Bubble Size: {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ width: "100%", height: 340 }}>
                <ResponsiveContainer>
                  <ScatterChart margin={{ left: 8, right: 16, top: 10, bottom: 8 }}>
                    <CartesianGrid stroke={gridStroke} />
                    <XAxis
                      type="number"
                      dataKey="x"
                      name={explorerMetricLabel(xMetric)}
                      tick={axisTickStyle}
                      stroke="rgba(139, 92, 246, 0.45)"
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name={explorerMetricLabel(yMetric)}
                      tick={axisTickStyle}
                      stroke="rgba(56, 189, 248, 0.45)"
                    />
                    <ZAxis
                      type="number"
                      dataKey="z"
                      name={
                        zMetric === "none" ? "Bubble Size (Fixed)" : explorerMetricLabel(zMetric)
                      }
                      range={zMetric === "none" ? [140, 140] : [60, 260]}
                    />
                    <Tooltip content={<ChartTooltip showPointName />} />
                    <Scatter
                      data={explorerData}
                      fill="#8b5cf6"
                      fillOpacity={0.45}
                      stroke="#67e8f9"
                      strokeWidth={1.2}
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Current view: {explorerMetricLabel(xMetric)} vs {explorerMetricLabel(yMetric)}
                {zMetric === "none" ? " with fixed bubbles." : ` with bubble size by ${explorerMetricLabel(zMetric)}.`}
              </p>
            </div>
          </div>

          <div className="grid gap-6">
            <div className="rounded-[28px] border border-sky-400/20 bg-slate-950/65 p-5 shadow-[0_20px_60px_rgba(8,15,29,0.45)] backdrop-blur">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold text-white">League Shot Mix</h2>
                <span className="text-xs uppercase tracking-[0.2em] text-sky-200/80">
                  Points Source
                </span>
              </div>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={shotMix}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={60}
                      outerRadius={94}
                      paddingAngle={3}
                    >
                      {shotMix.map((segment, index) => (
                        <Cell
                          key={segment.name}
                          fill={piePalette[index % piePalette.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid gap-2 text-sm text-slate-300">
                {shotMix.map((segment, index) => (
                  <div
                    key={segment.name}
                    className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/4 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: piePalette[index % piePalette.length] }}
                      />
                      <span>{segment.name}</span>
                    </div>
                    <span>{segment.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-indigo-400/20 bg-slate-950/65 p-5 shadow-[0_20px_60px_rgba(8,15,29,0.45)] backdrop-blur">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold text-white">Spacing vs Efficiency</h2>
                <span className="text-xs uppercase tracking-[0.2em] text-indigo-200/80">
                  3PA Rate vs TS%
                </span>
              </div>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <ScatterChart margin={{ left: 6, right: 16, top: 10, bottom: 4 }}>
                    <CartesianGrid stroke={gridStroke} />
                    <XAxis
                      type="number"
                      dataKey="threepar"
                      name="3PA Rate"
                      tick={axisTickStyle}
                      stroke="rgba(125, 211, 252, 0.45)"
                    />
                    <YAxis
                      type="number"
                      dataKey="ts"
                      name="TS%"
                      tick={axisTickStyle}
                      stroke="rgba(45, 212, 191, 0.45)"
                    />
                    <ZAxis type="number" dataKey="gp" range={[40, 220]} name="GP" />
                    <Tooltip content={<ChartTooltip showPointName />} />
                    <Scatter
                      data={spacingMap}
                      fill="#38bdf8"
                      fillOpacity={0.5}
                      stroke="#7dd3fc"
                      strokeWidth={1}
                    />
                    <Scatter
                      data={spacingHighlights}
                      fill="#818cf8"
                      stroke="#67e8f9"
                      strokeWidth={1.5}
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>

        <div
          style={
            {
              "--leaderboard-sticky-top": `${stickyTop}px`,
            } as CSSProperties
          }
          className="rounded-[28px] border border-sky-400/15 bg-slate-950/65 shadow-[0_20px_60px_rgba(8,15,29,0.4)] backdrop-blur"
        >
          <div className="sticky top-[var(--leaderboard-sticky-top)] z-30 border-b border-white/10 bg-zinc-950/95 backdrop-blur">
            <div className="flex items-center gap-3 px-3 py-2">
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
                Scroll Stats
              </span>
              <input
                ref={rangeInputRef}
                aria-label="Horizontal table scroll"
                className="h-2 w-full cursor-pointer accent-sky-400"
                type="range"
                min={0}
                max={Math.max(maxScrollLeft, 1)}
                step={1}
                defaultValue={0}
                disabled={maxScrollLeft <= 0}
                onChange={(event) => {
                  const nextScrollLeft = Number(event.target.value);
                  scrollLeftRef.current = nextScrollLeft;
                  if (bodyScrollRef.current) bodyScrollRef.current.scrollLeft = nextScrollLeft;
                  if (headerScrollRef.current) {
                    headerScrollRef.current.scrollLeft = nextScrollLeft;
                  }
                  if (progressLabelRef.current) {
                    progressLabelRef.current.textContent =
                      maxScrollLeft > 0
                        ? `${Math.round((nextScrollLeft / maxScrollLeft) * 100)}%`
                        : "Fit";
                  }
                }}
              />
              <span
                ref={progressLabelRef}
                className="w-10 text-right text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500"
              >
                Fit
              </span>
            </div>

            <div
              ref={headerScrollRef}
              className="overflow-x-auto border-t border-white/8 [&::-webkit-scrollbar]:hidden"
              style={{ scrollbarWidth: "none" }}
            >
              <table
                className="w-max table-fixed text-sm text-zinc-300"
                style={{ minWidth: `${tableMinWidth}rem` }}
                aria-hidden="true"
              >
                <colgroup>
                  {columns.map((column) => (
                    <col key={`sticky-col-${column.key}`} style={{ width: column.width }} />
                  ))}
                </colgroup>
                <thead className="bg-zinc-950/95">
                  <tr>
                    {columns.map((column) => (
                      <th
                        key={`sticky-header-${column.key}`}
                        className={`p-3 font-medium ${
                          column.align === "left" ? "text-left" : "text-right"
                        }`}
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
              </table>
            </div>
          </div>

          <div ref={bodyScrollRef} className="overflow-x-auto">
            <table
              ref={tableContentRef}
              className="w-max table-fixed text-sm"
              style={{ minWidth: `${tableMinWidth}rem` }}
            >
              <colgroup>
                {columns.map((column) => (
                  <col key={`body-col-${column.key}`} style={{ width: column.width }} />
                ))}
              </colgroup>
              <thead className="sr-only">
                <tr>
                  {columns.map((column) => (
                    <th key={`sr-header-${column.key}`} scope="col">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row) => (
                  <tr
                    key={row.player_id}
                    className="border-t border-zinc-800 transition hover:bg-zinc-800/40"
                  >
                    <td className="p-3 font-medium text-left">
                      <Link
                        className="hover:underline"
                        href={withDivision(`/players/${row.player_id}`, division)}
                      >
                        {row.player_name}
                      </Link>
                    </td>
                    {showDivisionColumn ? (
                      <td className="p-3 text-left text-zinc-300">
                        {row.division_labels.join(", ") || "-"}
                      </td>
                    ) : null}
                    <td className="p-3 text-right">{row.gp}</td>
                    <td className="p-3 text-right">{formatFixed(row.show_pts)}</td>
                    <td className="p-3 text-right">{formatFixed(row.show_reb)}</td>
                    <td className="p-3 text-right">{formatFixed(row.show_ast)}</td>
                    <td className="p-3 text-right">{formatFixed(row.ts)}</td>
                    <td className="p-3 text-right">{formatFixed(row.efg)}</td>
                    <td className="p-3 text-right">{formatFixed(row.ast_to)}</td>
                    <td className="p-3 text-right">{formatFixed(row.stocks_pg)}</td>
                    <td className="p-3 text-right">{formatFixed(row.tov_rate)}</td>
                    <td className="p-3 text-right">{formatFixed(row.ppsa)}</td>
                    <td className="p-3 text-right">{formatFixed(row.two_pct)}</td>
                    <td className="p-3 text-right">{formatFixed(row.two_par)}</td>
                    <td className="p-3 text-right">{formatFixed(row.game_score)}</td>
                    <td className="p-3 text-right">{formatFixed(row.threepar)}</td>
                    <td className="p-3 text-right">{formatFixed(row.ftr)}</td>
                    <td className="p-3 text-right">{formatFixed(row.fg_pct)}</td>
                    <td className="p-3 text-right">{formatFixed(row.tp_pct)}</td>
                    <td className="p-3 text-right">{formatFixed(row.ft_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6">
          <AnalyticsMethodology />
        </div>
      </div>
    </main>
  );
}
