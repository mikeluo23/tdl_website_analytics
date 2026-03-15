const DEFAULT_BACKEND_API_BASE = "http://127.0.0.1:8000";
const CLIENT_PROXY_BASE = "/api/stats";
const SERVER_REVALIDATE_SECONDS = 30;

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function getApiBase(): string {
  if (typeof window !== "undefined") {
    return CLIENT_PROXY_BASE;
  }

  return trimTrailingSlash(
    process.env.STATS_API_BASE ??
      process.env.NEXT_PUBLIC_API_BASE ??
      DEFAULT_BACKEND_API_BASE,
  );
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${getApiBase()}${normalizePath(path)}`, {
    ...(typeof window !== "undefined"
      ? {}
      : { next: { revalidate: SERVER_REVALIDATE_SECONDS } }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error: ${res.status} ${text}`);
  }

  return res.json();
}
