import "server-only";

const apiBase = process.env.API_PROXY_URL ?? "http://localhost:4000";

export type PublicDataResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number };

export async function loadPublicData<T>(
  path: string,
  cookie?: string,
): Promise<PublicDataResult<T>> {
  const response = await fetch(new URL(path, apiBase), {
    cache: "no-store",
    headers: cookie ? { cookie } : undefined,
  });

  if (!response.ok) return { ok: false, status: response.status };
  return { ok: true, data: (await response.json()) as T };
}

export function queryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function absolutePublicUrl(path: string) {
  return new URL(
    path,
    process.env.PUBLIC_APP_URL ?? "http://localhost:3000",
  ).toString();
}
