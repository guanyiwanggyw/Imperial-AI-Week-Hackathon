// Thin client for our server. Every call has a timeout so the UI can always fall back.

export interface Status {
  anthropic: boolean
  elevenlabs: boolean
  elevenlabsAgent: boolean
  anam: boolean
  fal: boolean
}

const OFFLINE: Status = { anthropic: false, elevenlabs: false, elevenlabsAgent: false, anam: false, fal: false }

async function request<T>(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`)
    return body as T
  } catch (err) {
    if (controller.signal.aborted) throw new Error('The request timed out')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export const postJson = <T>(url: string, body: unknown, timeoutMs?: number) =>
  request<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, timeoutMs)

export const getJson = <T>(url: string, timeoutMs?: number) => request<T>(url, {}, timeoutMs)

export async function getStatus(): Promise<Status> {
  try {
    return await getJson<Status>('/api/status', 4000)
  } catch {
    return OFFLINE
  }
}

export async function postForm<T>(url: string, form: FormData, timeoutMs: number): Promise<T> {
  return request<T>(url, { method: 'POST', body: form }, timeoutMs)
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
