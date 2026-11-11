export function apiRequest(path: string, init: { method?: string; apiKey?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = {};
  if (init.apiKey) headers.Authorization = `Bearer ${init.apiKey}`;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  return new Request(`http://localhost:3000${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });
}

export function params<T extends Record<string, string>>(value: T): { params: Promise<T> } {
  return { params: Promise.resolve(value) };
}
