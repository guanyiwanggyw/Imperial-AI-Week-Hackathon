// Generated media, cached on the server: fal backdrops, portraits and reaction clips, and Synthesia faces with intro clips.
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
export const introKey = (p: Persona) => `intro-${personaKey(p)}`

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

// Synthesia stock avatars. Built-in personas get a fixed avatar; custom ones are matched by voice gender.
const SYNTHESIA_AVATARS: Record<string, string> = {
  priya: 'sonia_costume2_cameraA',
  marcus: 'marcus_costume1_cameraA',
  elena: 'laura_costume1_cameraA',
  sam: 'jack_costume1_cameraA',
  maya: 'mia_costume1_cameraA',
  james: 'james_costume1_cameraA',
  aisha: 'isabella_costume1_cameraA',
  tom: 'jonathan_costume1_cameraA',
}
const FEMALE_AVATARS = ['anna_costume1_cameraA', 'bridget_costume1_cameraA', 'ruby_costume1_cameraA']
const MALE_AVATARS = ['vincent_costume1_cameraA', 'jack_costume1_cameraA', 'jonathan_costume1_cameraA']
// ElevenLabs premade voices from personas.ts that are female.
const FEMALE_VOICES = new Set(['Xb7hH8MSUJpSbSDYk0k2', 'EXAVITQu4vr4xnAQ4hCI', 'pFZP5JQG7iQjIQuC4Bku'])

const SYNTHESIA_BACKGROUNDS: Record<string, string> = {
  investors: 'white_meeting_room',
  peers: 'white_cafe',
  interview: 'open_office',
}

/** From the appearance text, else the voice. Used to match stock avatars and voices. */
export function personaGender(p: Persona): 'female' | 'male' {
  if (/\b(woman|female|she|her|girl|lady)\b/i.test(p.look)) return 'female'
  if (/\b(man|male|he|his|guy)\b/i.test(p.look)) return 'male'
  return FEMALE_VOICES.has(p.voiceId) ? 'female' : 'male'
}

export function synthesiaAvatar(p: Persona, seat: number): string {
  if (SYNTHESIA_AVATARS[p.id]) return SYNTHESIA_AVATARS[p.id]
  const pool = personaGender(p) === 'female' ? FEMALE_AVATARS : MALE_AVATARS
  return pool[seat % pool.length]
}

function introScript(p: Persona) {
  const first = p.name.split(/\s+/)[0]
  const close =
    p.strictness >= 4
      ? 'I will be listening closely, so make every claim count. Whenever you are ready.'
      : 'Looking forward to hearing what you have built. Take your time, and start whenever you are ready.'
  return `Hi, I'm ${first}, ${p.role.charAt(0).toLowerCase()}${p.role.slice(1)}. ${close}`
}

export type SynthesiaJob = { status: 'idle' | 'running' | 'done' | 'failed'; stage: string; error?: string }

export function startSynthesiaFace(panel: Panel, p: Persona, seat: number, force = false) {
  return postJson<SynthesiaJob>(
    '/api/media/synthesia',
    {
      personaKey: personaKey(p),
      script: introScript(p),
      avatar: synthesiaAvatar(p, seat),
      background: SYNTHESIA_BACKGROUNDS[panel.id] ?? 'white_studio',
      title: `${panel.name}: ${p.name}`,
      force,
    },
    15000,
  )
}

export function synthesiaStatus(p: Persona) {
  return getJson<SynthesiaJob>(`/api/media/synthesia/${personaKey(p)}`, 5000)
}

/** True once the portrait is a still from the Synthesia intro rather than a fal image. */
export const hasSynthesiaPortrait = (p: Persona, assets: Assets) => assets[portraitKey(p)]?.startsWith('/generated/synthesia-') ?? false

/**
 * Grabs a still from the intro clip and saves it as the portrait. Synthesia's own thumbnail has a
 * play button on it, and the server has no ffmpeg, so the browser does the frame grab.
 */
export async function saveSynthesiaPortrait(p: Persona, introUrl: string): Promise<string> {
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.src = introUrl
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve()
    video.onerror = () => reject(new Error('Could not load the intro clip'))
  })
  // Just before the avatar starts speaking: a calm, closed-mouth frame.
  video.currentTime = 0.1
  await new Promise<void>((resolve) => (video.onseeked = () => resolve()))
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  canvas.getContext('2d')!.drawImage(video, 0, 0)
  const image = canvas.toDataURL('image/jpeg', 0.9)
  video.removeAttribute('src')
  const { url } = await postJson<{ url: string }>(`/api/media/synthesia/${personaKey(p)}/portrait`, { image }, 15000)
  return url
}
