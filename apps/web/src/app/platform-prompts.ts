export type PlatformPrompt = {
  id: string;
  title: string;
  content: string;
  revision: number;
  updatedAt: string;
};

export async function promptRequest<T>(method = "GET", body?: unknown, id = ""): Promise<T> {
  const response = await fetch(`/api/platform/prompts${id ? `/${encodeURIComponent(id)}` : ""}`, {
    method, credentials: "include", cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(Array.isArray(payload?.message) ? payload.message.join(". ") : payload?.message ?? "Не удалось загрузить общую библиотеку промптов");
  return payload as T;
}
