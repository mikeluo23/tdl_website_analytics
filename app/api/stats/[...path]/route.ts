import { NextRequest, NextResponse } from "next/server";

const DEFAULT_BACKEND_API_BASE = "http://127.0.0.1:8000";
const DEFAULT_REVALIDATE_SECONDS = 30;
const METADATA_REVALIDATE_SECONDS = 300;

function getBackendBase(): string {
  const value =
    process.env.STATS_API_BASE ??
    process.env.NEXT_PUBLIC_API_BASE ??
    DEFAULT_BACKEND_API_BASE;

  return value.endsWith("/") ? value.slice(0, -1) : value;
}

type RouteContext = {
  params: Promise<{
    path: string[];
  }>;
};

function cacheWindowForPath(path: string[]) {
  if (path.length === 0) return DEFAULT_REVALIDATE_SECONDS;
  const joined = path.join("/");
  if (joined === "divisions" || joined === "season-options") {
    return METADATA_REVALIDATE_SECONDS;
  }
  return DEFAULT_REVALIDATE_SECONDS;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const upstreamUrl = new URL(`${getBackendBase()}/${path.join("/")}`);
  const revalidateSeconds = cacheWindowForPath(path);

  request.nextUrl.searchParams.forEach((value, key) => {
    upstreamUrl.searchParams.append(key, value);
  });

  const upstreamResponse = await fetch(upstreamUrl, {
    method: "GET",
    headers: {
      accept: request.headers.get("accept") ?? "application/json",
    },
    next: { revalidate: revalidateSeconds },
  });

  return new NextResponse(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: {
      "content-type":
        upstreamResponse.headers.get("content-type") ?? "application/json",
      "cache-control": `public, max-age=${revalidateSeconds}, stale-while-revalidate=${revalidateSeconds * 4}`,
    },
  });
}
