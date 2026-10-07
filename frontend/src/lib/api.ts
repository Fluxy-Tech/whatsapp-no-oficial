export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:6802";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // FormData (file upload) sets its own multipart Content-Type with boundary.
  const isFormData = init?.body instanceof FormData;

  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    ...init,
    headers: { ...(isFormData ? {} : { "Content-Type": "application/json" }), ...(init?.headers ?? {}) },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
