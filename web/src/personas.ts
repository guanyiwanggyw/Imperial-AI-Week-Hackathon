import type { Panel, Persona } from './types'

// ElevenLabs premade voices. Swap ids here if your account uses different voices.
const VOICES = {
  george: 'JBFqnCBsd6RMkjVDRZzb',
  daniel: 'onwK4e9ZLuTAKqWW03F9',
  alice: 'Xb7hH8MSUJpSbSDYk0k2',
  sarah: 'EXAVITQu4vr4xnAQ4hCI',
  brian: 'nPczCjzI2devNBz1zQrb',
  lily: 'pFZP5JQG7iQjIQuC4Bku',
}

const PORTRAIT_STYLE =
  'Photorealistic head-and-shoulders portrait, looking straight at the camera, neutral attentive expression, soft natural light, plain softly blurred background, 50mm lens.'

function persona(p: Omit<Persona, 'look'> & { look: string }): Persona {
  return { ...p, look: `${p.look} ${PORTRAIT_STYLE}` }
}

export const PANELS: Panel[] = [
  {
    id: 'investors',
    name: 'Sceptical investors',
    description: 'Seed-stage investors who probe the market, the numbers and why you will win.',
    setting: 'Boardroom',
    backdropPrompt:
      'A calm modern boardroom seen from the presenter position, long wooden table, large windows with soft daylight, muted tones, no people, shallow depth of field, photorealistic.',
    personas: [
      persona({
        id: 'priya',
        name: 'Priya Shah',
        role: 'Partner at a seed fund',
        personality: 'Direct, numbers-first and polite but unimpressed by vision without evidence. Asks pointed questions about market size and traction.',
        focus: ['market', 'traction', 'evidence'],
        strictness: 5,
        expression: { nod: 0.15, smile: 0.05, frown: 0.6, glance: 0.2, sceptical: 0.8 },
        voiceId: VOICES.alice,
        look: 'A woman in her early forties with shoulder-length dark hair, wearing a navy blazer.',
        idleStyle: 'Listens with a composed, slightly reserved expression; still posture; occasional small sceptical tilt of the head.',
      }),
      persona({
        id: 'marcus',
        name: 'Marcus Webb',
        role: 'Former founder, now angel investor',
        personality: 'Warm but sharp. Cares about the team, the go-to-market plan and whether the founder understands their customer.',
        focus: ['customer', 'go-to-market', 'team'],
        strictness: 3,
        expression: { nod: 0.6, smile: 0.4, frown: 0.3, glance: 0.15, sceptical: 0.3 },
        voiceId: VOICES.george,
        look: 'A man in his fifties with short grey hair and a short beard, wearing an open-collar light blue shirt.',
        idleStyle: 'Listens attentively with a friendly, curious expression and occasional small nods.',
      }),
      persona({
        id: 'elena',
        name: 'Elena Kovac',
        role: 'Technical due-diligence lead',
        personality: 'Quiet and precise. Looks for technical feasibility, risks and what is actually built versus planned.',
        focus: ['feasibility', 'risks', 'technology'],
        strictness: 4,
        expression: { nod: 0.3, smile: 0.1, frown: 0.5, glance: 0.35, sceptical: 0.5 },
        voiceId: VOICES.lily,
        look: 'A woman in her thirties with short light brown hair and thin-framed glasses, wearing a grey sweater.',
        idleStyle: 'Listens with a focused, analytical expression; minimal movement; occasionally narrows the eyes slightly.',
      }),
    ],
  },
  {
    id: 'peers',
    name: 'Friendly peers',
    description: 'Fellow students and builders who want you to do well and ask about clarity and next steps.',
    setting: 'Lecture hall',
    backdropPrompt:
      'A bright, modern university lecture hall seen from the front, rows of empty seats, warm natural light, calm muted colours, no people, photorealistic.',
    personas: [
      persona({
        id: 'sam',
        name: 'Sam Okafor',
        role: 'Fellow hackathon builder',
        personality: 'Encouraging and curious. Wants to understand how it works and what the demo shows.',
        focus: ['clarity', 'how it works', 'demo'],
        strictness: 2,
        expression: { nod: 0.7, smile: 0.7, frown: 0.15, glance: 0.1, sceptical: 0.1 },
        voiceId: VOICES.brian,
        look: 'A young man in his early twenties with short black hair, wearing a dark green hoodie.',
        idleStyle: 'Listens with a warm, encouraging expression, smiling lightly and nodding often.',
      }),
      persona({
        id: 'maya',
        name: 'Maya Lindqvist',
        role: 'Design student',
        personality: 'Thoughtful and kind. Asks about the user, the problem and why this solution fits them.',
        focus: ['user', 'problem', 'clarity'],
        strictness: 2,
        expression: { nod: 0.6, smile: 0.6, frown: 0.2, glance: 0.15, sceptical: 0.1 },
        voiceId: VOICES.sarah,
        look: 'A young woman in her early twenties with long blonde hair tied back, wearing a cream knit sweater.',
        idleStyle: 'Listens thoughtfully with a soft, friendly expression and occasional gentle nods.',
      }),
    ],
  },
  {
    id: 'interview',
    name: 'Interview panel',
    description: 'A hiring panel that tests structure, judgement and how you handle follow-ups.',
    setting: 'Interview room',
    backdropPrompt:
      'A quiet, minimal interview room with a small table, a plant and soft daylight through frosted glass, muted neutral palette, no people, photorealistic.',
    personas: [
      persona({
        id: 'james',
        name: 'James Holloway',
        role: 'Engineering manager',
        personality: 'Structured and fair. Probes trade-offs, decisions you made and what you would do differently.',
        focus: ['trade-offs', 'decisions', 'impact'],
        strictness: 4,
        expression: { nod: 0.4, smile: 0.2, frown: 0.4, glance: 0.2, sceptical: 0.45 },
        voiceId: VOICES.daniel,
        look: 'A man in his forties with neat dark hair, wearing a charcoal crew-neck sweater over a white shirt.',
        idleStyle: 'Listens with a neutral, professional expression; steady eye contact; occasional slight nod.',
      }),
      persona({
        id: 'aisha',
        name: 'Aisha Rahman',
        role: 'Head of people',
        personality: 'Warm and observant. Interested in communication, collaboration and how you respond under pressure.',
        focus: ['communication', 'collaboration', 'composure'],
        strictness: 3,
        expression: { nod: 0.55, smile: 0.45, frown: 0.25, glance: 0.1, sceptical: 0.2 },
        voiceId: VOICES.sarah,
        look: 'A woman in her late thirties with dark hair in a low bun, wearing a mustard cardigan.',
        idleStyle: 'Listens warmly and attentively with a gentle expression and occasional small smiles.',
      }),
      persona({
        id: 'tom',
        name: 'Tom Becker',
        role: 'Senior engineer',
        personality: 'Blunt and detail-oriented. Pushes on technical depth and on claims that sound too good.',
        focus: ['technical depth', 'evidence', 'feasibility'],
        strictness: 5,
        expression: { nod: 0.2, smile: 0.05, frown: 0.55, glance: 0.3, sceptical: 0.7 },
        voiceId: VOICES.brian,
        look: 'A man in his early thirties with messy brown hair and stubble, wearing a black t-shirt.',
        idleStyle: 'Listens with a flat, slightly sceptical expression and arms-crossed stillness.',
      }),
    ],
  },
]

export const DEFAULT_PITCH_SECONDS = 180
export const DEFAULT_QUESTION_COUNT = 3

/** A blank persona for the custom panel builder. */
export function blankPersona(n: number): Persona {
  return persona({
    id: `custom${n}`,
    name: `Panelist ${n}`,
    role: 'Panel member',
    personality: 'Fair and curious. Asks clear, specific questions.',
    focus: ['clarity', 'evidence'],
    strictness: 3,
    expression: { nod: 0.4, smile: 0.3, frown: 0.35, glance: 0.2, sceptical: 0.35 },
    voiceId: [VOICES.george, VOICES.alice, VOICES.brian][n % 3],
    look: 'A professional adult in smart casual clothes.',
    idleStyle: 'Listens attentively with a neutral, interested expression.',
  })
}
