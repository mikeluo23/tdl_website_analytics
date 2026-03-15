"use client";

import {
  type CSSProperties,
  type WheelEvent,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ReferenceArea,
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
  | "division"
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

type ChartMetricKey = Exclude<SortKey, "division">;
type ScatterMetricKey = ExplorerMetricKey;

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
type SeasonOptions = {
  years: string[];
  season_terms: string[];
  year_terms: { year: string; season_terms: string[] }[];
};

type ScatterPoint = {
  name: string;
  x: number;
  y: number;
  gp?: number;
  z?: number;
};

type ZoomState = {
  xDomain: [number, number] | null;
  yDomain: [number, number] | null;
};

type DragState = {
  x1: number | null;
  y1: number | null;
  x2: number | null;
  y2: number | null;
};

type ScatterDomain = [number, number];

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

const primaryChartConfigBySort: Record<
  ChartMetricKey,
  { valueKey: ChartMetricKey; title: string; metricLabel: string }
> = {
  ppg: { valueKey: "ppg", title: "Top 10 Scoring Rate", metricLabel: "PPG" },
  rpg: { valueKey: "rpg", title: "Top 10 Rebounding Rate", metricLabel: "RPG" },
  apg: { valueKey: "apg", title: "Top 10 Assist Rate", metricLabel: "APG" },
  ts: { valueKey: "ts", title: "Top 10 True Shooting", metricLabel: "TS%" },
  efg: { valueKey: "efg", title: "Top 10 eFG", metricLabel: "eFG%" },
  ast_to: { valueKey: "ast_to", title: "Top 10 AST/TO", metricLabel: "AST/TO" },
  threepar: { valueKey: "threepar", title: "Top 10 3PA Rate", metricLabel: "3PA Rate" },
  ftr: { valueKey: "ftr", title: "Top 10 FT Rate", metricLabel: "FT Rate" },
  stocks_pg: { valueKey: "stocks_pg", title: "Top 10 Stocks / Game", metricLabel: "Stocks / G" },
  tov_rate: { valueKey: "tov_rate", title: "Top 10 TOV Rate", metricLabel: "TOV Rate" },
  ppsa: { valueKey: "ppsa", title: "Top 10 Points / Shot Attempt", metricLabel: "Pts / Shot" },
  two_pct: { valueKey: "two_pct", title: "Top 10 2P%", metricLabel: "2P%" },
  two_par: { valueKey: "two_par", title: "Top 10 2PA Rate", metricLabel: "2PA Rate" },
  game_score: { valueKey: "game_score", title: "Top 10 Game Score / G", metricLabel: "Game Score / G" },
  pts: { valueKey: "pts", title: "Top 10 Total Points", metricLabel: "PTS" },
  reb: { valueKey: "reb", title: "Top 10 Total Rebounds", metricLabel: "REB" },
  ast: { valueKey: "ast", title: "Top 10 Total Assists", metricLabel: "AST" },
};

const MAX_CHART_POINTS = 180;
const MIN_DOMAIN_SPAN = 0.0000001;
const ZOOM_IN_FACTOR = 0.55;
const ZOOM_OUT_FACTOR = 1.8;
const percentLikeMetricKeys = new Set<ExplorerMetricKey | ChartMetricKey>([
  "ts",
  "efg",
  "threepar",
  "ftr",
  "tov_rate",
  "two_pct",
  "two_par",
  "fg_pct",
  "tp_pct",
  "ft_pct",
  "two_point_share",
  "three_point_share",
  "free_throw_share",
]);
const dynamicScatterConfigBySort: Partial<
  Record<
    SortKey,
    {
      title: string;
      badge: string;
      xKey: ScatterMetricKey;
      yKey: ScatterMetricKey;
      xLabel: string;
      yLabel: string;
      description: string;
      preferHigherY?: boolean;
    }
  >
> = {
  ppg: {
    title: "Scoring vs Efficiency",
    badge: "PPG vs TS%",
    xKey: "ppg",
    yKey: "ts",
    xLabel: "PPG",
    yLabel: "TS%",
    description: "Upper-right is the sweet spot: volume and efficiency together.",
    preferHigherY: true,
  },
  pts: {
    title: "Volume vs Efficiency",
    badge: "Total PTS vs TS%",
    xKey: "ppg",
    yKey: "ts",
    xLabel: "PPG",
    yLabel: "TS%",
    description: "Useful for spotting who combines raw scoring load with efficient finishing.",
    preferHigherY: true,
  },
  rpg: {
    title: "Hustle Map",
    badge: "RPG vs Stocks/G",
    xKey: "rpg",
    yKey: "stocks_pg",
    xLabel: "RPG",
    yLabel: "Stocks / G",
    description: "Highlights players impacting possessions through rebounding and defensive events.",
    preferHigherY: true,
  },
  reb: {
    title: "Hustle Map",
    badge: "RPG vs Stocks/G",
    xKey: "rpg",
    yKey: "stocks_pg",
    xLabel: "RPG",
    yLabel: "Stocks / G",
    description: "Highlights players impacting possessions through rebounding and defensive events.",
    preferHigherY: true,
  },
  apg: {
    title: "Creation vs Security",
    badge: "APG vs TOV Rate",
    xKey: "apg",
    yKey: "tov_rate",
    xLabel: "APG",
    yLabel: "TOV Rate",
    description: "Best profiles sit rightward without drifting too high on turnover rate.",
    preferHigherY: false,
  },
  ast: {
    title: "Creation vs Security",
    badge: "APG vs TOV Rate",
    xKey: "apg",
    yKey: "tov_rate",
    xLabel: "APG",
    yLabel: "TOV Rate",
    description: "Best profiles sit rightward without drifting too high on turnover rate.",
    preferHigherY: false,
  },
  ast_to: {
    title: "Playmaking Balance",
    badge: "APG vs AST/TO",
    xKey: "apg",
    yKey: "ast_to",
    xLabel: "APG",
    yLabel: "AST/TO",
    description: "Shows who creates a lot while staying clean with the ball.",
    preferHigherY: true,
  },
  tov_rate: {
    title: "Creation vs Security",
    badge: "APG vs TOV Rate",
    xKey: "apg",
    yKey: "tov_rate",
    xLabel: "APG",
    yLabel: "TOV Rate",
    description: "Best profiles sit rightward without drifting too high on turnover rate.",
    preferHigherY: false,
  },
  threepar: {
    title: "Spacing vs Efficiency",
    badge: "3PA Rate vs TS%",
    xKey: "threepar",
    yKey: "ts",
    xLabel: "3PA Rate",
    yLabel: "TS%",
    description: "Shows which shooters pair perimeter volume with real efficiency.",
    preferHigherY: true,
  },
  ftr: {
    title: "Pressure vs Efficiency",
    badge: "FT Rate vs TS%",
    xKey: "ftr",
    yKey: "ts",
    xLabel: "FT Rate",
    yLabel: "TS%",
    description: "Captures downhill scoring pressure and whether it turns into efficient offense.",
    preferHigherY: true,
  },
  stocks_pg: {
    title: "Hustle Map",
    badge: "Stocks/G vs RPG",
    xKey: "stocks_pg",
    yKey: "rpg",
    xLabel: "Stocks / G",
    yLabel: "RPG",
    description: "Highlights defenders who also finish possessions on the glass.",
    preferHigherY: true,
  },
  ts: {
    title: "Efficiency vs Volume",
    badge: "TS% vs PPG",
    xKey: "ts",
    yKey: "ppg",
    xLabel: "TS%",
    yLabel: "PPG",
    description: "Separates efficient scorers who also carry real shot volume.",
    preferHigherY: true,
  },
  efg: {
    title: "Shot Making Profile",
    badge: "eFG% vs 3PA Rate",
    xKey: "efg",
    yKey: "threepar",
    xLabel: "eFG%",
    yLabel: "3PA Rate",
    description: "Useful for seeing who combines shot quality with real perimeter pressure.",
    preferHigherY: true,
  },
  ppsa: {
    title: "Scoring Efficiency",
    badge: "Pts / Shot vs TS%",
    xKey: "ppsa",
    yKey: "ts",
    xLabel: "Pts / Shot",
    yLabel: "TS%",
    description: "Shows who converts possessions into points most efficiently.",
    preferHigherY: true,
  },
  two_pct: {
    title: "Interior Finishing",
    badge: "2P% vs FT Rate",
    xKey: "two_pct",
    yKey: "ftr",
    xLabel: "2P%",
    yLabel: "FT Rate",
    description: "Highlights finishers who also pressure the rim enough to draw fouls.",
    preferHigherY: true,
  },
  two_par: {
    title: "Interior Volume",
    badge: "2PA Rate vs 2P%",
    xKey: "two_par",
    yKey: "two_pct",
    xLabel: "2PA Rate",
    yLabel: "2P%",
    description: "Shows who leans into two-point volume without giving up finishing quality.",
    preferHigherY: true,
  },
  game_score: {
    title: "Impact Snapshot",
    badge: "Game Score/G vs TS%",
    xKey: "game_score",
    yKey: "ts",
    xLabel: "Game Score / G",
    yLabel: "TS%",
    description: "A compact view of overall box-score impact against efficiency.",
    preferHigherY: true,
  },
};

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

function truncateLabel(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function getGP(row: Row) {
  return num(row.games_played ?? row.gp ?? row.games);
}

function extent(points: ScatterPoint[], key: "x" | "y") {
  if (points.length === 0) return [0, 1] as [number, number];
  const values = points.map((point) => point[key]).filter((value) => Number.isFinite(value));
  if (values.length === 0) return [0, 1] as [number, number];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    const padding = min === 0 ? 1 : Math.abs(min) * 0.1;
    return [Math.max(0, min - padding), max + padding] as [number, number];
  }
  const padding = (max - min) * 0.08;
  return [Math.max(0, min - padding), max + padding] as [number, number];
}

function roundDomain(domain: ScatterDomain): ScatterDomain {
  const span = domain[1] - domain[0];
  if (!Number.isFinite(span) || span <= 0) return domain;
  if (span >= 50) return [Math.floor(domain[0]), Math.ceil(domain[1])];
  if (span >= 10) return [Math.floor(domain[0] * 2) / 2, Math.ceil(domain[1] * 2) / 2];
  if (span >= 1) return [Math.floor(domain[0] * 10) / 10, Math.ceil(domain[1] * 10) / 10];
  if (span >= 0.1) return [Math.floor(domain[0] * 100) / 100, Math.ceil(domain[1] * 100) / 100];
  if (span >= 0.01) {
    return [Math.floor(domain[0] * 1000) / 1000, Math.ceil(domain[1] * 1000) / 1000];
  }
  if (span >= 0.001) {
    return [Math.floor(domain[0] * 10000) / 10000, Math.ceil(domain[1] * 10000) / 10000];
  }
  if (span >= 0.0001) {
    return [Math.floor(domain[0] * 100000) / 100000, Math.ceil(domain[1] * 100000) / 100000];
  }
  if (span >= 0.00001) {
    return [Math.floor(domain[0] * 1000000) / 1000000, Math.ceil(domain[1] * 1000000) / 1000000];
  }
  return [Math.floor(domain[0] * 10000000) / 10000000, Math.ceil(domain[1] * 10000000) / 10000000];
}

function clampDomain(domain: ScatterDomain, full: ScatterDomain): ScatterDomain {
  const fullSpan = full[1] - full[0];
  const minSpan = Math.max(
    Math.min((fullSpan || MIN_DOMAIN_SPAN) * 0.00001, 0.001),
    MIN_DOMAIN_SPAN,
  );
  const requestedSpan = Math.max(domain[1] - domain[0], Math.min(minSpan, fullSpan || minSpan));
  const clampedSpan = Math.min(requestedSpan, fullSpan || requestedSpan);
  let min = Math.max(full[0], domain[0]);
  let max = min + clampedSpan;
  if (max > full[1]) {
    max = full[1];
    min = Math.max(full[0], max - clampedSpan);
  }
  return roundDomain([min, max]);
}

function zoomDomain(current: ScatterDomain, full: ScatterDomain, factor: number): ScatterDomain {
  const center = (current[0] + current[1]) / 2;
  const span = current[1] - current[0];
  const minSpan = Math.max(
    Math.min(((full[1] - full[0]) || MIN_DOMAIN_SPAN) * 0.00001, 0.001),
    MIN_DOMAIN_SPAN,
  );
  const nextSpan = Math.max(minSpan, Math.min((full[1] - full[0]) || span, span * factor));
  return clampDomain([center - nextSpan / 2, center + nextSpan / 2], full);
}

function zoomDomainAroundRatio(
  current: ScatterDomain,
  full: ScatterDomain,
  factor: number,
  ratio: number,
): ScatterDomain {
  const span = current[1] - current[0];
  const fullSpan = (full[1] - full[0]) || span;
  const minSpan = Math.max(Math.min(fullSpan * 0.00001, 0.001), MIN_DOMAIN_SPAN);
  const nextSpan = Math.max(minSpan, Math.min(fullSpan, span * factor));
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  const focusValue = current[0] + span * clampedRatio;
  const nextMin = focusValue - nextSpan * clampedRatio;
  return clampDomain([nextMin, nextMin + nextSpan], full);
}

function panDomain(current: ScatterDomain, full: ScatterDomain, fraction: number): ScatterDomain {
  const span = current[1] - current[0];
  return clampDomain([current[0] + span * fraction, current[1] + span * fraction], full);
}

function formatAxisTick(value: number, metricKey: ScatterMetricKey | ChartMetricKey) {
  if (!Number.isFinite(value)) return "";
  if (metricKey === "gp") return `${Math.round(value)}`;
  const rounded =
    Math.abs(value) >= 100
      ? value.toFixed(0)
      : Math.abs(value) >= 10
        ? value.toFixed(1)
        : Math.abs(value) >= 1
          ? value.toFixed(2)
          : Math.abs(value) >= 0.1
            ? value.toFixed(3)
            : Math.abs(value) >= 0.01
              ? value.toFixed(4)
              : Math.abs(value) >= 0.001
                ? value.toFixed(5)
                : Math.abs(value) >= 0.0001
                  ? value.toFixed(6)
                  : value.toFixed(7);
  return percentLikeMetricKeys.has(metricKey) ? `${rounded}%` : rounded;
}

function readScatterPoint(event: unknown) {
  if (!event || typeof event !== "object") return null;
  const maybePoint = event as { xValue?: unknown; yValue?: unknown };
  const xValue = Number(maybePoint.xValue);
  const yValue = Number(maybePoint.yValue);
  if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) return null;
  return { xValue, yValue };
}

export default function LeaderboardClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const division = normalizeDivision(searchParams.get("division"));
  const year = searchParams.get("year")?.trim() ?? "";
  const seasonTerm = searchParams.get("season_term")?.trim().toUpperCase() ?? "";
  const [rows, setRows] = useState<Row[]>([]);
  const [seasonOptions, setSeasonOptions] = useState<SeasonOptions>({
    years: [],
    season_terms: [],
    year_terms: [],
  });
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"per_game" | "totals">("per_game");
  const [sortKey, setSortKey] = useState<SortKey>("ppg");
  const [sortDirection, setSortDirection] = useState<"desc" | "asc">("desc");
  const [minGP, setMinGP] = useState<number>(2);
  const [playerPoolSize, setPlayerPoolSize] = useState<PlayerPoolSize>(200);
  const [tablePageSize, setTablePageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [q, setQ] = useState<string>("");
  const [xMetric, setXMetric] = useState<ExplorerMetricKey>("ppg");
  const [yMetric, setYMetric] = useState<ExplorerMetricKey>("ts");
  const [zMetric, setZMetric] = useState<ExplorerMetricKey | "none">("gp");
  const [dynamicZoom, setDynamicZoom] = useState<ZoomState>({
    xDomain: null,
    yDomain: null,
  });
  const [dynamicDrag, setDynamicDrag] = useState<DragState>({
    x1: null,
    y1: null,
    x2: null,
    y2: null,
  });
  const [explorerZoom, setExplorerZoom] = useState<ZoomState>({
    xDomain: null,
    yDomain: null,
  });
  const [explorerDrag, setExplorerDrag] = useState<DragState>({
    x1: null,
    y1: null,
    x2: null,
    y2: null,
  });
  const headerScrollRef = useRef<HTMLDivElement | null>(null);
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  const tableContentRef = useRef<HTMLTableElement | null>(null);
  const rangeInputRef = useRef<HTMLInputElement | null>(null);
  const progressLabelRef = useRef<HTMLSpanElement | null>(null);
  const dynamicScatterRef = useRef<HTMLDivElement | null>(null);
  const explorerScatterRef = useRef<HTMLDivElement | null>(null);
  const activeWheelPlotRef = useRef<"dynamic" | "explorer" | null>(null);
  const syncingRef = useRef<"header" | "body" | null>(null);
  const scrollLeftRef = useRef(0);
  const pendingScrollLeftRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const [stickyTop, setStickyTop] = useState(0);
  const [maxScrollLeft, setMaxScrollLeft] = useState(0);
  const [isCompactCharts, setIsCompactCharts] = useState(false);
  const deferredQuery = useDeferredValue(q);
  const collator = useMemo(
    () =>
      new Intl.Collator(undefined, {
        sensitivity: "base",
        numeric: true,
      }),
    [],
  );

  useEffect(() => {
    apiGet<Row[]>(
      withQuery("/leaderboard", {
        division: division || undefined,
        year: year || undefined,
        season_term: seasonTerm || undefined,
        limit: String(playerPoolSize),
      }),
    )
      .then((data) => {
        setRows(data);
        setErr(null);
      })
      .catch((error) => setErr(String(error)));
  }, [division, playerPoolSize, seasonTerm, year]);

  useEffect(() => {
    apiGet<SeasonOptions>(
      withQuery("/season-options", { division: division || undefined }),
    )
      .then((data) => setSeasonOptions(data))
      .catch(() =>
        setSeasonOptions({
          years: [],
          season_terms: [],
          year_terms: [],
        }),
      );
  }, [division]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const updateCompactCharts = () => setIsCompactCharts(media.matches);
    updateCompactCharts();
    media.addEventListener("change", updateCompactCharts);
    return () => media.removeEventListener("change", updateCompactCharts);
  }, []);

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
        division_sort:
          Array.isArray(row.division_labels) && row.division_labels.length > 0
            ? row.division_labels.map((value) => String(value)).join(", ")
            : "",
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
        deferredQuery.trim()
          ? row.player_name.toLowerCase().includes(deferredQuery.trim().toLowerCase())
          : true,
      )
      .sort((a, b) => {
        if (sortKey === "division") {
          const divisionComparison = collator.compare(a.division_sort, b.division_sort);
          if (divisionComparison !== 0) {
            return sortDirection === "desc" ? -divisionComparison : divisionComparison;
          }

          return collator.compare(a.player_name, b.player_name);
        }

        const diff =
          sortDirection === "desc"
            ? num(b[sortKey]) - num(a[sortKey])
            : num(a[sortKey]) - num(b[sortKey]);

        if (diff !== 0) {
          return diff;
        }

        return collator.compare(a.player_name, b.player_name);
      });
  }, [collator, deferredQuery, minGP, rows, sortDirection, sortKey]);

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
  const totalPages = Math.max(1, Math.ceil(tableRows.length / tablePageSize));
  const displayPage = Math.min(currentPage, totalPages);
  const primaryChartConfig =
    sortKey === "division" ? primaryChartConfigBySort.ppg : primaryChartConfigBySort[sortKey];
  const chartRows = useMemo(
    () => tableRows.slice(0, Math.min(tableRows.length, MAX_CHART_POINTS)),
    [tableRows],
  );
  const paginatedTableRows = useMemo(() => {
    const startIndex = (displayPage - 1) * tablePageSize;
    return tableRows.slice(startIndex, startIndex + tablePageSize);
  }, [displayPage, tablePageSize, tableRows]);

  const top10 = useMemo(
    () =>
      tableRows.slice(0, 10).map((row) => ({
        name: row.player_name,
        value: num(row[primaryChartConfig.valueKey]),
        player_id: row.player_id,
      })),
    [primaryChartConfig.valueKey, tableRows],
  );
  const topChartData = useMemo(
    () =>
      (isCompactCharts ? top10.slice(0, 7) : top10).map((entry) => ({
        ...entry,
        displayName: truncateLabel(entry.name, isCompactCharts ? 12 : 24),
      })),
    [isCompactCharts, top10],
  );

  const dynamicScatterConfig =
    dynamicScatterConfigBySort[sortKey] ?? dynamicScatterConfigBySort.ppg!;
  const dynamicScatterData = useMemo(
    () =>
      chartRows.map((row) => ({
        name: row.player_name,
        x: num(row[dynamicScatterConfig.xKey]),
        y: num(row[dynamicScatterConfig.yKey]),
        gp: row.gp,
      })),
    [chartRows, dynamicScatterConfig],
  );
  const dynamicFullDomain = useMemo(
    () => ({
      xDomain: roundDomain(extent(dynamicScatterData, "x")),
      yDomain: roundDomain(extent(dynamicScatterData, "y")),
    }),
    [dynamicScatterData],
  );

  const scatterHighlights = useMemo(
    () =>
      [...dynamicScatterData]
        .sort((a, b) => {
          const aScore = a.x + (dynamicScatterConfig.preferHigherY === false ? -a.y : a.y);
          const bScore = b.x + (dynamicScatterConfig.preferHigherY === false ? -b.y : b.y);
          return bScore - aScore;
        })
        .slice(0, 6),
    [dynamicScatterConfig, dynamicScatterData],
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
  const seasonTermsByYear = seasonOptions.year_terms;
  const getSeasonTermsForYear = (selectedYear: string) => {
    if (!selectedYear) return seasonOptions.season_terms;
    return (
      seasonTermsByYear.find((option) => option.year === selectedYear)?.season_terms ??
      seasonOptions.season_terms
    );
  };
  const seasonTermsForYear = getSeasonTermsForYear(year);

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
      chartRows.map((row) => ({
        name: row.player_name,
        x: num(row[xMetric]),
        y: num(row[yMetric]),
        z: zMetric === "none" ? 1 : Math.max(num(row[zMetric]), 0.1),
      })),
    [chartRows, xMetric, yMetric, zMetric],
  );
  const explorerFullDomain = useMemo(
    () => ({
      xDomain: roundDomain(extent(explorerData, "x")),
      yDomain: roundDomain(extent(explorerData, "y")),
    }),
    [explorerData],
  );

  const beginScatterDrag =
    (setDrag: (value: DragState) => void) =>
    (event?: unknown) => {
      const point = readScatterPoint(event);
      if (!point) return;
      setDrag({
        x1: point.xValue,
        y1: point.yValue,
        x2: point.xValue,
        y2: point.yValue,
      });
    };

  const updateScatterDrag =
    (setDrag: (value: DragState | ((current: DragState) => DragState)) => void) =>
    (event?: unknown) => {
      const point = readScatterPoint(event);
      if (!point) return;
      setDrag((current) =>
        current.x1 === null || current.y1 === null
          ? current
          : {
              ...current,
              x2: point.xValue,
              y2: point.yValue,
            },
      );
    };

  const applyScatterZoom = (
    drag: DragState,
    setDrag: (value: DragState) => void,
    setZoom: (value: ZoomState) => void,
  ) => {
    if (
      drag.x1 === null ||
      drag.x2 === null ||
      drag.y1 === null ||
      drag.y2 === null ||
      Math.abs(drag.x2 - drag.x1) < Number.EPSILON ||
      Math.abs(drag.y2 - drag.y1) < Number.EPSILON
    ) {
      setDrag({ x1: null, y1: null, x2: null, y2: null });
      return;
    }

    setZoom({
      xDomain: roundDomain([Math.min(drag.x1, drag.x2), Math.max(drag.x1, drag.x2)]),
      yDomain: roundDomain([Math.min(drag.y1, drag.y2), Math.max(drag.y1, drag.y2)]),
    });
    setDrag({ x1: null, y1: null, x2: null, y2: null });
  };

  const applyPointerZoom = (
    clientX: number,
    clientY: number,
    deltaY: number,
    container: HTMLDivElement | null,
    zoom: ZoomState,
    fullDomain: { xDomain: ScatterDomain; yDomain: ScatterDomain },
    setZoom: (value: ZoomState) => void,
  ) => {
    const currentX = zoom.xDomain ?? fullDomain.xDomain;
    const currentY = zoom.yDomain ?? fullDomain.yDomain;
    const factor = deltaY < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
    const rect = container?.getBoundingClientRect();
    const xRatio = rect && rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
    const yRatio = rect && rect.height > 0 ? 1 - (clientY - rect.top) / rect.height : 0.5;
    setZoom({
      xDomain: zoomDomainAroundRatio(currentX, fullDomain.xDomain, factor, xRatio),
      yDomain: zoomDomainAroundRatio(currentY, fullDomain.yDomain, factor, yRatio),
    });
  };

  const applyWheelZoom = (
    event: WheelEvent<HTMLDivElement>,
    container: HTMLDivElement | null,
    zoom: ZoomState,
    fullDomain: { xDomain: ScatterDomain; yDomain: ScatterDomain },
    setZoom: (value: ZoomState) => void,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
    applyPointerZoom(
      event.clientX,
      event.clientY,
      event.deltaY,
      container,
      zoom,
      fullDomain,
      setZoom,
    );
  };

  useEffect(() => {
    const handleWindowWheel = (event: globalThis.WheelEvent) => {
      const dynamicNode = dynamicScatterRef.current;
      const explorerNode = explorerScatterRef.current;

      if (activeWheelPlotRef.current === "dynamic" && dynamicNode) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        applyPointerZoom(
          event.clientX,
          event.clientY,
          event.deltaY,
          dynamicNode,
          dynamicZoom,
          dynamicFullDomain,
          setDynamicZoom,
        );
        return;
      }

      if (activeWheelPlotRef.current === "explorer" && explorerNode) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        applyPointerZoom(
          event.clientX,
          event.clientY,
          event.deltaY,
          explorerNode,
          explorerZoom,
          explorerFullDomain,
          setExplorerZoom,
        );
      }
    };

    window.addEventListener("wheel", handleWindowWheel, {
      passive: false,
      capture: true,
    });
    return () =>
      window.removeEventListener("wheel", handleWindowWheel, {
        capture: true,
      });
  }, [dynamicFullDomain, dynamicZoom, explorerFullDomain, explorerZoom]);

  const updateLeaderboardFilters = (nextParams: Record<string, string | undefined>) => {
    setCurrentPage(1);
    router.replace(
      withQuery("/leaderboard", {
        ...Object.fromEntries(searchParams.entries()),
        ...nextParams,
        division: division || undefined,
      }),
      { scroll: false },
    );
  };

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Leaderboard</h1>
            <p className="mt-1 text-sm text-zinc-400">
              {cleaned.length} players shown | map pool{" "}
              {playerPoolSize === 5000 ? "all" : `top ${playerPoolSize}`} | min GP {minGP}
              {year ? ` | year ${year}` : ""}
              {seasonTerm ? ` | season ${seasonTerm}` : ""}
              {tableRows.length
                ? ` | rows ${Math.min((displayPage - 1) * tablePageSize + 1, tableRows.length)}-${Math.min(
                    displayPage * tablePageSize,
                    tableRows.length,
                  )}`
                : ""}
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
                onClick={() => {
                  setCurrentPage(1);
                  setMode("per_game");
                }}
              >
                Per Game
              </button>
              <button
                className={`px-3 py-2 text-sm ${
                  mode === "totals"
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-300 hover:text-white"
                }`}
                onClick={() => {
                  setCurrentPage(1);
                  setMode("totals");
                }}
              >
                Totals
              </button>
            </div>

            <select
              className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-white"
              value={sortKey}
              onChange={(event) => {
                setCurrentPage(1);
                setDynamicZoom({ xDomain: null, yDomain: null });
                setDynamicDrag({ x1: null, y1: null, x2: null, y2: null });
                setSortKey(event.target.value as SortKey);
              }}
            >
              <option value="division">Sort: Division</option>
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
                onClick={() => {
                  setCurrentPage(1);
                  setSortDirection("desc");
                }}
              >
                Desc
              </button>
              <button
                className={`px-3 py-2 text-sm ${
                  sortDirection === "asc"
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-300 hover:text-white"
                }`}
                onClick={() => {
                  setCurrentPage(1);
                  setSortDirection("asc");
                }}
              >
                Asc
              </button>
            </div>

            <input
              className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-white placeholder:text-zinc-500"
              placeholder="Search..."
              value={q}
              onChange={(event) => {
                setCurrentPage(1);
                setQ(event.target.value);
              }}
            />

            <input
              className="w-28 rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-white"
              type="number"
              min={0}
              step={1}
              value={minGP}
              onChange={(event) => {
                setCurrentPage(1);
                setMinGP(Math.max(0, Number(event.target.value)));
              }}
              title="Minimum games played"
            />

            <select
              className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-white"
              value={playerPoolSize}
              onChange={(event) => {
                setCurrentPage(1);
                setPlayerPoolSize(Number(event.target.value) as PlayerPoolSize);
              }}
              title="Players loaded into leaderboard charts and table"
            >
              <option value={50}>Map Pool: Top 50</option>
              <option value={100}>Map Pool: Top 100</option>
              <option value={200}>Map Pool: Top 200</option>
              <option value={5000}>Map Pool: All</option>
            </select>

            <select
              className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-white"
              value={year}
              onChange={(event) => {
                const nextYear = event.target.value;
                const nextYearTerms = getSeasonTermsForYear(nextYear);
                updateLeaderboardFilters({
                  year: nextYear || undefined,
                  season_term: nextYearTerms.includes(seasonTerm)
                    ? seasonTerm || undefined
                    : undefined,
                });
              }}
              title="Filter leaderboard by season year"
            >
              <option value="">All Years</option>
              {seasonOptions.years.map((optionYear) => (
                <option key={optionYear} value={optionYear}>
                  Year: {optionYear}
                </option>
              ))}
            </select>

            <select
              className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-white"
              value={seasonTerm}
              onChange={(event) =>
                updateLeaderboardFilters({
                  season_term: event.target.value || undefined,
                })
              }
              title="Filter leaderboard by season term within the selected year"
            >
              <option value="">All Seasons</option>
              {seasonTermsForYear.map((term) => (
                <option key={term} value={term}>
                  Season: {term}
                </option>
              ))}
            </select>

            <select
              className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-white"
              value={tablePageSize}
              onChange={(event) => {
                setCurrentPage(1);
                setTablePageSize(Number(event.target.value));
              }}
              title="Rows rendered per leaderboard page"
            >
              <option value={50}>Table: 50 rows</option>
              <option value={100}>Table: 100 rows</option>
              <option value={200}>Table: 200 rows</option>
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

        <div className="mb-6 grid gap-4 xl:grid-cols-2">
          <div className="rounded-[28px] border border-sky-400/20 bg-slate-950/65 p-5 shadow-[0_20px_60px_rgba(8,15,29,0.45)] backdrop-blur">
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="font-semibold text-white">
                {sortKey === "division" ? "Top 10 Scoring Rate" : primaryChartConfig.title}
              </h2>
              <span className="text-xs uppercase tracking-[0.2em] text-sky-200/80">
                {sortKey === "division" ? "PPG" : primaryChartConfig.metricLabel}
              </span>
            </div>
            <div style={{ width: "100%", height: isCompactCharts ? 260 : 320 }}>
              <ResponsiveContainer>
                <BarChart
                  data={topChartData}
                  layout="vertical"
                  margin={{ left: 6, right: 8, top: 4, bottom: 4 }}
                >
                  <CartesianGrid stroke={gridStroke} horizontal={false} />
                  <XAxis type="number" tick={axisTickStyle} />
                  <YAxis
                    type="category"
                    dataKey="displayName"
                    width={isCompactCharts ? 88 : 160}
                    tick={axisTickStyle}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(56, 189, 248, 0.08)" }}
                    content={<ChartTooltip />}
                  />
                  <Bar dataKey="value" radius={[0, 12, 12, 0]}>
                    {topChartData.map((entry, index) => (
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
              Mirrors the current leaderboard sort. Division sort falls back to scoring rate.
            </p>
          </div>

          <div className="rounded-[28px] border border-cyan-400/20 bg-slate-950/65 p-5 shadow-[0_20px_60px_rgba(8,15,29,0.45)] backdrop-blur">
            <div className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="font-semibold text-white">{dynamicScatterConfig.title}</h2>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs uppercase tracking-[0.2em] text-cyan-200/80">
                  {dynamicScatterConfig.badge}
                </span>
                <button
                  type="button"
                  className="rounded-lg border border-zinc-700 bg-zinc-950/50 px-2 py-1 text-xs text-white transition hover:border-zinc-500 hover:bg-zinc-900"
                  onClick={() =>
                    setDynamicZoom((current) => ({
                      xDomain: zoomDomain(current.xDomain ?? dynamicFullDomain.xDomain, dynamicFullDomain.xDomain, ZOOM_IN_FACTOR),
                      yDomain: zoomDomain(current.yDomain ?? dynamicFullDomain.yDomain, dynamicFullDomain.yDomain, ZOOM_IN_FACTOR),
                    }))
                  }
                >
                  +
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-zinc-700 bg-zinc-950/50 px-2 py-1 text-xs text-white transition hover:border-zinc-500 hover:bg-zinc-900"
                  onClick={() =>
                    setDynamicZoom((current) => ({
                      xDomain: zoomDomain(current.xDomain ?? dynamicFullDomain.xDomain, dynamicFullDomain.xDomain, ZOOM_OUT_FACTOR),
                      yDomain: zoomDomain(current.yDomain ?? dynamicFullDomain.yDomain, dynamicFullDomain.yDomain, ZOOM_OUT_FACTOR),
                    }))
                  }
                >
                  -
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-zinc-700 bg-zinc-950/50 px-2 py-1 text-xs text-white transition hover:border-zinc-500 hover:bg-zinc-900"
                  onClick={() =>
                    setDynamicZoom((current) => ({
                      xDomain: panDomain(current.xDomain ?? dynamicFullDomain.xDomain, dynamicFullDomain.xDomain, -0.2),
                      yDomain: current.yDomain ?? dynamicFullDomain.yDomain,
                    }))
                  }
                >
                  ←
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-zinc-700 bg-zinc-950/50 px-2 py-1 text-xs text-white transition hover:border-zinc-500 hover:bg-zinc-900"
                  onClick={() =>
                    setDynamicZoom((current) => ({
                      xDomain: panDomain(current.xDomain ?? dynamicFullDomain.xDomain, dynamicFullDomain.xDomain, 0.2),
                      yDomain: current.yDomain ?? dynamicFullDomain.yDomain,
                    }))
                  }
                >
                  →
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-zinc-700 bg-zinc-950/50 px-2 py-1 text-xs text-white transition hover:border-zinc-500 hover:bg-zinc-900"
                  onClick={() =>
                    setDynamicZoom((current) => ({
                      xDomain: current.xDomain ?? dynamicFullDomain.xDomain,
                      yDomain: panDomain(current.yDomain ?? dynamicFullDomain.yDomain, dynamicFullDomain.yDomain, -0.2),
                    }))
                  }
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-zinc-700 bg-zinc-950/50 px-2 py-1 text-xs text-white transition hover:border-zinc-500 hover:bg-zinc-900"
                  onClick={() =>
                    setDynamicZoom((current) => ({
                      xDomain: current.xDomain ?? dynamicFullDomain.xDomain,
                      yDomain: panDomain(current.yDomain ?? dynamicFullDomain.yDomain, dynamicFullDomain.yDomain, 0.2),
                    }))
                  }
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-zinc-700 bg-zinc-950/50 px-3 py-1 text-xs text-white transition hover:border-zinc-500 hover:bg-zinc-900"
                  onClick={() => {
                    setDynamicZoom({ xDomain: null, yDomain: null });
                    setDynamicDrag({ x1: null, y1: null, x2: null, y2: null });
                  }}
                >
                  Reset Zoom
                </button>
              </div>
            </div>
            <div
              ref={dynamicScatterRef}
              style={{
                width: "100%",
                height: isCompactCharts ? 260 : 320,
                touchAction: "none",
                overscrollBehavior: "contain",
              }}
              onPointerEnter={() => {
                activeWheelPlotRef.current = "dynamic";
              }}
              onPointerLeave={() => {
                if (activeWheelPlotRef.current === "dynamic") {
                  activeWheelPlotRef.current = null;
                }
              }}
              onWheelCapture={(event) =>
                applyWheelZoom(
                  event,
                  dynamicScatterRef.current,
                  dynamicZoom,
                  dynamicFullDomain,
                  setDynamicZoom,
                )
              }
            >
              <ResponsiveContainer>
                <ScatterChart
                  margin={{ left: 10, right: 10 }}
                  onMouseDown={beginScatterDrag(setDynamicDrag)}
                  onMouseMove={updateScatterDrag(setDynamicDrag)}
                  onMouseUp={() =>
                    applyScatterZoom(dynamicDrag, setDynamicDrag, setDynamicZoom)
                  }
                >
                  <CartesianGrid stroke={gridStroke} />
                  <XAxis
                    type="number"
                    dataKey="x"
                    name={dynamicScatterConfig.xLabel}
                    domain={dynamicZoom.xDomain ?? dynamicFullDomain.xDomain}
                    allowDataOverflow
                    tickFormatter={(value) =>
                      formatAxisTick(Number(value), dynamicScatterConfig.xKey)
                    }
                    tick={axisTickStyle}
                    tickCount={isCompactCharts ? 4 : 6}
                    stroke="rgba(125, 211, 252, 0.45)"
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name={dynamicScatterConfig.yLabel}
                    domain={dynamicZoom.yDomain ?? dynamicFullDomain.yDomain}
                    allowDataOverflow
                    tickFormatter={(value) =>
                      formatAxisTick(Number(value), dynamicScatterConfig.yKey)
                    }
                    tick={axisTickStyle}
                    tickCount={isCompactCharts ? 4 : 6}
                    stroke="rgba(34, 211, 238, 0.45)"
                  />
                  <ZAxis
                    type="number"
                    dataKey="gp"
                    range={isCompactCharts ? [28, 140] : [40, 240]}
                    name="GP"
                  />
                  <Tooltip
                    cursor={{ strokeDasharray: "4 4", stroke: "rgba(96, 165, 250, 0.55)" }}
                    content={<ChartTooltip showPointName />}
                  />
                  <Scatter
                    data={dynamicScatterData}
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
                  {dynamicDrag.x1 !== null &&
                  dynamicDrag.x2 !== null &&
                  dynamicDrag.y1 !== null &&
                  dynamicDrag.y2 !== null ? (
                    <ReferenceArea
                      x1={dynamicDrag.x1}
                      x2={dynamicDrag.x2}
                      y1={dynamicDrag.y1}
                      y2={dynamicDrag.y2}
                      strokeOpacity={0.7}
                      stroke="#67e8f9"
                      fill="rgba(103, 232, 249, 0.12)"
                    />
                  ) : null}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              {dynamicScatterConfig.description} Drag to zoom, use the mouse wheel to zoom in/out, or pan with the arrow controls. Plot sample capped to the top {MAX_CHART_POINTS}.
            </p>
          </div>
        </div>

        <div className="mb-6 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="grid gap-6">
            <div className="rounded-[28px] border border-violet-400/20 bg-slate-950/65 p-5 shadow-[0_20px_60px_rgba(8,15,29,0.45)] backdrop-blur">
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-semibold text-white">Relationship Explorer</h2>
                  <p className="text-sm text-slate-400">
                    Compare any three metrics with X, Y, and bubble size controls.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                  className="rounded-lg border border-zinc-700 bg-zinc-950/50 px-2 py-1 text-xs text-white transition hover:border-zinc-500 hover:bg-zinc-900"
                  onClick={() =>
                    setExplorerZoom((current) => ({
                        xDomain: zoomDomain(current.xDomain ?? explorerFullDomain.xDomain, explorerFullDomain.xDomain, ZOOM_IN_FACTOR),
                        yDomain: zoomDomain(current.yDomain ?? explorerFullDomain.yDomain, explorerFullDomain.yDomain, ZOOM_IN_FACTOR),
                      }))
                    }
                  >
                    +
                  </button>
                  <button
                    type="button"
                  className="rounded-lg border border-zinc-700 bg-zinc-950/50 px-2 py-1 text-xs text-white transition hover:border-zinc-500 hover:bg-zinc-900"
                  onClick={() =>
                    setExplorerZoom((current) => ({
                        xDomain: zoomDomain(current.xDomain ?? explorerFullDomain.xDomain, explorerFullDomain.xDomain, ZOOM_OUT_FACTOR),
                        yDomain: zoomDomain(current.yDomain ?? explorerFullDomain.yDomain, explorerFullDomain.yDomain, ZOOM_OUT_FACTOR),
                      }))
                    }
                  >
                    -
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-zinc-700 bg-zinc-950/50 px-2 py-1 text-xs text-white transition hover:border-zinc-500 hover:bg-zinc-900"
                    onClick={() =>
                      setExplorerZoom((current) => ({
                        xDomain: panDomain(current.xDomain ?? explorerFullDomain.xDomain, explorerFullDomain.xDomain, -0.2),
                        yDomain: current.yDomain ?? explorerFullDomain.yDomain,
                      }))
                    }
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-zinc-700 bg-zinc-950/50 px-2 py-1 text-xs text-white transition hover:border-zinc-500 hover:bg-zinc-900"
                    onClick={() =>
                      setExplorerZoom((current) => ({
                        xDomain: panDomain(current.xDomain ?? explorerFullDomain.xDomain, explorerFullDomain.xDomain, 0.2),
                        yDomain: current.yDomain ?? explorerFullDomain.yDomain,
                      }))
                    }
                  >
                    →
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-zinc-700 bg-zinc-950/50 px-2 py-1 text-xs text-white transition hover:border-zinc-500 hover:bg-zinc-900"
                    onClick={() =>
                      setExplorerZoom((current) => ({
                        xDomain: current.xDomain ?? explorerFullDomain.xDomain,
                        yDomain: panDomain(current.yDomain ?? explorerFullDomain.yDomain, explorerFullDomain.yDomain, -0.2),
                      }))
                    }
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-zinc-700 bg-zinc-950/50 px-2 py-1 text-xs text-white transition hover:border-zinc-500 hover:bg-zinc-900"
                    onClick={() =>
                      setExplorerZoom((current) => ({
                        xDomain: current.xDomain ?? explorerFullDomain.xDomain,
                        yDomain: panDomain(current.yDomain ?? explorerFullDomain.yDomain, explorerFullDomain.yDomain, 0.2),
                      }))
                    }
                  >
                    ↓
                  </button>
                <button
                  type="button"
                  className="rounded-lg border border-zinc-700 bg-zinc-950/50 px-3 py-1 text-xs text-white transition hover:border-zinc-500 hover:bg-zinc-900"
                  onClick={() => {
                    setExplorerZoom({ xDomain: null, yDomain: null });
                    setExplorerDrag({ x1: null, y1: null, x2: null, y2: null });
                  }}
                >
                  Reset Zoom
                </button>
                </div>
              </div>
              <div className="mb-4 grid gap-3 md:grid-cols-3">
                <select
                  className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-white"
                  value={xMetric}
                  onChange={(event) => {
                    setExplorerZoom({ xDomain: null, yDomain: null });
                    setExplorerDrag({ x1: null, y1: null, x2: null, y2: null });
                    setXMetric(event.target.value as ExplorerMetricKey);
                  }}
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
                  onChange={(event) => {
                    setExplorerZoom({ xDomain: null, yDomain: null });
                    setExplorerDrag({ x1: null, y1: null, x2: null, y2: null });
                    setYMetric(event.target.value as ExplorerMetricKey);
                  }}
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
                  onChange={(event) => {
                    setExplorerZoom({ xDomain: null, yDomain: null });
                    setExplorerDrag({ x1: null, y1: null, x2: null, y2: null });
                    setZMetric(event.target.value as ExplorerMetricKey | "none");
                  }}
                >
                  <option value="none">Bubble Size: Fixed</option>
                  {explorerMetricOptions.map((option) => (
                    <option key={`z-${option.key}`} value={option.key}>
                      Bubble Size: {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div
                ref={explorerScatterRef}
                style={{
                  width: "100%",
                  height: isCompactCharts ? 280 : 340,
                  touchAction: "none",
                  overscrollBehavior: "contain",
                }}
                onPointerEnter={() => {
                  activeWheelPlotRef.current = "explorer";
                }}
                onPointerLeave={() => {
                  if (activeWheelPlotRef.current === "explorer") {
                    activeWheelPlotRef.current = null;
                  }
                }}
                onWheelCapture={(event) =>
                  applyWheelZoom(
                    event,
                    explorerScatterRef.current,
                    explorerZoom,
                    explorerFullDomain,
                    setExplorerZoom,
                  )
                }
              >
                <ResponsiveContainer>
                  <ScatterChart
                    margin={{ left: 8, right: 16, top: 10, bottom: 8 }}
                    onMouseDown={beginScatterDrag(setExplorerDrag)}
                    onMouseMove={updateScatterDrag(setExplorerDrag)}
                    onMouseUp={() =>
                      applyScatterZoom(explorerDrag, setExplorerDrag, setExplorerZoom)
                    }
                  >
                    <CartesianGrid stroke={gridStroke} />
                    <XAxis
                      type="number"
                      dataKey="x"
                      name={explorerMetricLabel(xMetric)}
                      domain={explorerZoom.xDomain ?? explorerFullDomain.xDomain}
                      allowDataOverflow
                      tickFormatter={(value) =>
                        formatAxisTick(Number(value), xMetric)
                      }
                      tick={axisTickStyle}
                      tickCount={isCompactCharts ? 4 : 6}
                      stroke="rgba(139, 92, 246, 0.45)"
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name={explorerMetricLabel(yMetric)}
                      domain={explorerZoom.yDomain ?? explorerFullDomain.yDomain}
                      allowDataOverflow
                      tickFormatter={(value) =>
                        formatAxisTick(Number(value), yMetric)
                      }
                      tick={axisTickStyle}
                      tickCount={isCompactCharts ? 4 : 6}
                      stroke="rgba(56, 189, 248, 0.45)"
                    />
                    <ZAxis
                      type="number"
                      dataKey="z"
                      name={
                        zMetric === "none" ? "Bubble Size (Fixed)" : explorerMetricLabel(zMetric)
                      }
                      range={
                        zMetric === "none"
                          ? [isCompactCharts ? 100 : 140, isCompactCharts ? 100 : 140]
                          : isCompactCharts
                            ? [36, 160]
                            : [60, 260]
                      }
                    />
                    <Tooltip content={<ChartTooltip showPointName />} />
                    <Scatter
                      data={explorerData}
                      fill="#8b5cf6"
                      fillOpacity={0.45}
                      stroke="#67e8f9"
                      strokeWidth={1.2}
                    />
                    {explorerDrag.x1 !== null &&
                    explorerDrag.x2 !== null &&
                    explorerDrag.y1 !== null &&
                    explorerDrag.y2 !== null ? (
                      <ReferenceArea
                        x1={explorerDrag.x1}
                        x2={explorerDrag.x2}
                        y1={explorerDrag.y1}
                        y2={explorerDrag.y2}
                        strokeOpacity={0.7}
                        stroke="#c084fc"
                        fill="rgba(192, 132, 252, 0.12)"
                      />
                    ) : null}
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Current view: {explorerMetricLabel(xMetric)} vs {explorerMetricLabel(yMetric)}
                {zMetric === "none" ? " with fixed bubbles." : ` with bubble size by ${explorerMetricLabel(zMetric)}.`}{" "}
                Drag to zoom, use the mouse wheel to zoom in/out, or pan with the arrow controls. Plot sample capped to the top {MAX_CHART_POINTS}.
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
              <div style={{ width: "100%", height: isCompactCharts ? 220 : 260 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={shotMix}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={isCompactCharts ? 44 : 60}
                      outerRadius={isCompactCharts ? 74 : 94}
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
                    {columns.map((column, index) => (
                      <th
                        key={`sticky-header-${column.key}`}
                        className={`p-3 font-medium ${
                          column.align === "left" ? "text-left" : "text-right"
                        } ${
                          index === 0
                            ? "sticky left-0 z-20 bg-zinc-950/98 shadow-[6px_0_16px_rgba(2,6,23,0.45)]"
                            : ""
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
                {paginatedTableRows.map((row) => (
                  <tr
                    key={row.player_id}
                    className="border-t border-zinc-800 transition hover:bg-zinc-800/40"
                  >
                    <td className="sticky left-0 z-10 bg-slate-950/96 p-3 font-medium text-left shadow-[6px_0_16px_rgba(2,6,23,0.45)]">
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

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/8 bg-slate-950/45 px-4 py-3 text-sm text-zinc-300 backdrop-blur">
          <div>
            Page {tableRows.length ? displayPage : 0} of {totalPages} | {tableRows.length} total rows
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-40"
              disabled={displayPage <= 1}
              onClick={() => setCurrentPage(1)}
            >
              First
            </button>
            <button
              className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-40"
              disabled={displayPage <= 1}
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            >
              Prev
            </button>
            <button
              className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-40"
              disabled={displayPage >= totalPages}
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
            >
              Next
            </button>
            <button
              className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-40"
              disabled={displayPage >= totalPages}
              onClick={() => setCurrentPage(totalPages)}
            >
              Last
            </button>
          </div>
        </div>

        <div className="mt-6">
          <AnalyticsMethodology />
        </div>
      </div>
    </main>
  );
}
