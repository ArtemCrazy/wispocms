export function parseApiBody<T>(body: string): T {
  return body ? (JSON.parse(body) as T) : (undefined as T);
}
