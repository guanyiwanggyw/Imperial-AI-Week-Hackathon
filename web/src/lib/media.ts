// fal-generated media: backdrops, persona portraits and reaction clips. Cached on the server.
import { getJson, postJson } from '../api'
import type { Panel, Persona, Reaction } from '../types'

export type Assets = Record<string, string>

export const REACTIONS: Reaction[] = ['nod', 'smile', 'frown', 'glance', 'sceptical']

function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** Custom personas get a key that changes when their description changes. */
export const personaKey = (p: Persona) => (p.id.startsWith('custom') ? `${p.id}-${hash(p.look)}` : p.id)
export const portraitKey = (p: Persona) => `portrait-${personaKey(p)}`
export const backdropKey = (panel: Panel) => `backdrop-${panel.id}-${hash(panel.backdropPrompt)}`
export const reactionKey = (p: Persona, r: Reaction) => `reaction-${personaKey(p)}-${r}`

export async function loadAssets(): Promise<Assets> {
  try {
    return await getJson<Assets>('/api/media/assets', 5000)
  } catch {
    return {}
  }
}

export async function generateImage(key: string, prompt: string, kind: 'backdrop' | 'portrait', force = false) {
  const { url } = await postJson<{ url: string }>('/api/media/image', { key, prompt, kind, force }, 70000)
  return url
}

export async function startReactionClips(p: Persona, portraitUrl: string) {
  return postJson<{ status: string; done: number }>('/api/media/reactions', { personaKey: personaKey(p), portraitUrl }, 10000)
}

export async function reactionStatus(p: Persona) {
  return getJson<{ status: 'idle' | 'running' | 'done' | 'failed'; done: number; errors: string[] }>(`/api/media/reactions/${personaKey(p)}`, 5000)
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}
