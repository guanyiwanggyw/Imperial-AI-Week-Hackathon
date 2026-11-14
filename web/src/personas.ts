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

export const PORTRAIT_STYLE =
  'Photorealistic head-and-shoulders portrait, looking straight at the camera, neutral attentive expression, soft natural light, plain softly blurred background, 50mm lens.'

function persona(p: Omit<Persona, 'look'> & { look: string }): Persona {
  return { ...p, look: `${p.look} ${PORTRAIT_STYLE}` }
}


const INVESTOR_EXTRAS: Persona[] = [
  persona({
    id: 'daniel',
    name: 'Daniel Osei',
    role: 'Growth investor, ex-CFO',
    personality: 'Calm and exacting. Wants unit economics, payback period and a clear path to profit. Interrupts vague financial claims.',
    focus: ['unit economics', 'numbers', 'pricing'],
    strictness: 5,
    expression: { nod: 0.15, smile: 0.05, frown: 0.55, glance: 0.15, sceptical: 0.75 },
    voiceId: VOICES.daniel,
    look: 'A man in his late forties with close-cropped hair and rimless glasses, wearing a dark suit jacket without a tie.',
    idleStyle: 'Listens very still with a level, appraising gaze; occasionally makes a small note-taking motion.',
  }),
  persona({
    id: 'hannah',
    name: 'Hannah Brooks',
    role: 'Operating partner, time-poor',
    personality: 'Brisk and impatient with rambling. Wants the bottom line in the first minute and rewards a strong opening line.',
    focus: ['bottom line', 'clarity', 'ask'],
    strictness: 4,
    expression: { nod: 0.3, smile: 0.15, frown: 0.45, glance: 0.5, sceptical: 0.4 },
    voiceId: VOICES.sarah,
    look: 'A woman in her forties with a sleek dark bob, wearing a black turtleneck.',
    idleStyle: 'Listens alertly but glances away now and then, as if checking the time; brief nods when a point lands.',
  }),
  persona({
    id: 'ravi',
    name: 'Ravi Menon',
    role: 'Corporate venture lead',
    personality: 'Friendly but loyal to incumbents. Asks why customers would switch from what they already use and how hard switching is.',
    focus: ['competition', 'switching cost', 'customer'],
    strictness: 3,
    expression: { nod: 0.45, smile: 0.35, frown: 0.3, glance: 0.15, sceptical: 0.45 },
    voiceId: VOICES.brian,
    look: 'A man in his late thirties with short black hair and a neat beard, wearing a light grey blazer over a white t-shirt.',
    idleStyle: 'Listens with an easy, interested expression; tilts the head when comparing ideas.',
  }),
  persona({
    id: 'catherine',
    name: 'Catherine Dubois',
    role: 'Impact fund principal',
    personality: 'Thoughtful and values-driven. Asks who benefits, what could go wrong for users, and how you will measure impact alongside revenue.',
    focus: ['impact', 'risks', 'customer'],
    strictness: 3,
    expression: { nod: 0.45, smile: 0.3, frown: 0.3, glance: 0.15, sceptical: 0.35 },
    voiceId: VOICES.alice,
    look: 'A woman in her fifties with silver-streaked hair in a short pixie cut, wearing a teal scarf over a cream blouse.',
    idleStyle: 'Listens with a calm, considered expression; slow nods; occasionally rests chin on hand.',
  }),
  persona({
    id: 'jonah',
    name: 'Jonah Feld',
    role: 'Pre-seed scout, ex-founder',
    personality: 'Enthusiastic champion who wants you to win. Asks how he could sell this to his partners and what the one killer metric is.',
    focus: ['story', 'traction', 'ask'],
    strictness: 2,
    expression: { nod: 0.7, smile: 0.6, frown: 0.15, glance: 0.1, sceptical: 0.15 },
    voiceId: VOICES.brian,
    look: 'A man in his early thirties with tousled sandy hair, wearing a dark green bomber jacket over a grey t-shirt.',
    idleStyle: 'Listens with visible energy, leaning forward, smiling and nodding often.',
  }),
  persona({
    id: 'mei',
    name: 'Mei Tanaka',
    role: 'Deep-tech investor, PhD',
    personality: 'Precise and technical. Probes defensibility, IP and whether the science works outside the lab. Interrupts hand-waving.',
    focus: ['technology', 'defensibility', 'evidence'],
    strictness: 5,
    expression: { nod: 0.2, smile: 0.05, frown: 0.5, glance: 0.25, sceptical: 0.7 },
    voiceId: VOICES.lily,
    look: 'A woman in her late thirties with straight black hair in a low ponytail and black-framed glasses, wearing a charcoal blazer.',
    idleStyle: 'Listens intently with a neutral, analytical expression; very little movement.',
  }),
  persona({
    id: 'tunde',
    name: 'Tunde Adeyemi',
    role: 'Fintech angel and operator',
    personality: 'Commercially sharp and friendly. Asks about distribution, regulation and how you reach customers cheaply.',
    focus: ['go-to-market', 'regulation', 'pricing'],
    strictness: 4,
    expression: { nod: 0.35, smile: 0.25, frown: 0.4, glance: 0.15, sceptical: 0.5 },
    voiceId: VOICES.george,
    look: 'A man in his mid forties with a shaved head and a short greying beard, wearing a navy blazer over a white shirt.',
    idleStyle: 'Listens with a measured, attentive expression and an occasional raised eyebrow.',
  }),
]

const PEER_EXTRAS: Persona[] = [
  persona({
    id: 'leo',
    name: 'Leo Martins',
    role: 'Computer science student',
    personality: 'Curious and a little sceptical about the tech. Asks what is really built and what would break first.',
    focus: ['how it works', 'feasibility', 'demo'],
    strictness: 3,
    expression: { nod: 0.5, smile: 0.4, frown: 0.25, glance: 0.2, sceptical: 0.3 },
    voiceId: VOICES.george,
    look: 'A young man in his early twenties with curly dark hair, wearing a navy crew-neck sweatshirt.',
    idleStyle: 'Listens with a curious half-smile and occasional thoughtful frowns.',
  }),
  persona({
    id: 'zara',
    name: 'Zara Ahmed',
    role: 'Business student',
    personality: 'Upbeat and practical. Asks who pays, how much, and what the first ten customers look like.',
    focus: ['customer', 'pricing', 'next steps'],
    strictness: 2,
    expression: { nod: 0.65, smile: 0.6, frown: 0.15, glance: 0.1, sceptical: 0.15 },
    voiceId: VOICES.lily,
    look: 'A young woman in her early twenties with long dark hair, wearing a denim jacket over a white top.',
    idleStyle: 'Listens with bright, engaged energy, smiling and nodding along.',
  }),
  persona({
    id: 'kenji',
    name: 'Kenji Watanabe',
    role: 'Product manager friend',
    personality: 'Supportive coach. Asks what the one-sentence pitch is and what you would cut to make it clearer.',
    focus: ['clarity', 'problem', 'structure'],
    strictness: 3,
    expression: { nod: 0.55, smile: 0.45, frown: 0.2, glance: 0.15, sceptical: 0.25 },
    voiceId: VOICES.daniel,
    look: 'A man in his late twenties with short neat black hair, wearing a grey zip-up jacket.',
    idleStyle: 'Listens calmly with a supportive, attentive expression and slow nods.',
  }),
  persona({
    id: 'priyanka',
    name: 'Priyanka Rao',
    role: 'Medical student',
    personality: 'Kind and detail-minded. Asks whether real users were involved and what happens if the product gets it wrong.',
    focus: ['users', 'risks', 'evidence'],
    strictness: 3,
    expression: { nod: 0.55, smile: 0.45, frown: 0.25, glance: 0.15, sceptical: 0.3 },
    voiceId: VOICES.sarah,
    look: 'A young woman in her early twenties with long black hair in a braid, wearing a lavender cardigan.',
    idleStyle: 'Listens carefully with a gentle, focused expression and small nods.',
  }),
  persona({
    id: 'ben',
    name: 'Ben Carter',
    role: 'Hackathon organiser',
    personality: 'Cheerful and fast-paced. Wants to see the demo early and asks what you built in the last 24 hours.',
    focus: ['demo', 'clarity', 'next steps'],
    strictness: 2,
    expression: { nod: 0.65, smile: 0.65, frown: 0.1, glance: 0.2, sceptical: 0.1 },
    voiceId: VOICES.daniel,
    look: 'A man in his mid twenties with short ginger hair and freckles, wearing a black event t-shirt and a lanyard.',
    idleStyle: 'Listens with an upbeat, encouraging grin; occasionally gives a thumbs-up gesture.',
  }),
  persona({
    id: 'amara',
    name: 'Amara Nwosu',
    role: 'Startup society president',
    personality: 'Supportive but honest. Asks what makes this different from what already exists and who would pay first.',
    focus: ['competition', 'customer', 'problem'],
    strictness: 3,
    expression: { nod: 0.5, smile: 0.45, frown: 0.25, glance: 0.15, sceptical: 0.3 },
    voiceId: VOICES.alice,
    look: 'A young woman in her early twenties with natural curly hair tied up, wearing a mustard yellow jumper.',
    idleStyle: 'Listens with a warm, engaged expression; tilts head when thinking.',
  }),
  persona({
    id: 'felix',
    name: 'Felix Schmidt',
    role: 'Masters student in AI',
    personality: 'Friendly nerd. Asks which model or method you used, how you tested it and what the failure cases are.',
    focus: ['how it works', 'testing', 'feasibility'],
    strictness: 3,
    expression: { nod: 0.45, smile: 0.35, frown: 0.3, glance: 0.2, sceptical: 0.35 },
    voiceId: VOICES.george,
    look: 'A young man in his mid twenties with short blond hair and round glasses, wearing a dark blue flannel shirt.',
    idleStyle: 'Listens with curious concentration, sometimes squinting slightly when thinking.',
  }),
]

const INTERVIEW_EXTRAS: Persona[] = [
  persona({
    id: 'grace',
    name: 'Grace Liu',
    role: 'Product director',
    personality: 'Sharp and user-focused. Asks how you measured impact and what the users actually did differently.',
    focus: ['impact', 'users', 'evidence'],
    strictness: 4,
    expression: { nod: 0.35, smile: 0.2, frown: 0.4, glance: 0.15, sceptical: 0.5 },
    voiceId: VOICES.alice,
    look: 'A woman in her forties with straight black hair to the shoulders, wearing a white blouse and a dark blazer.',
    idleStyle: 'Listens with a composed, evaluating expression; steady eye contact.',
  }),
  persona({
    id: 'omar',
    name: 'Omar Haddad',
    role: 'Startup hiring manager',
    personality: 'Energetic and direct. Cares about ownership, speed and what you personally did versus the team.',
    focus: ['ownership', 'decisions', 'trade-offs'],
    strictness: 3,
    expression: { nod: 0.5, smile: 0.35, frown: 0.3, glance: 0.2, sceptical: 0.35 },
    voiceId: VOICES.george,
    look: 'A man in his mid thirties with short dark hair and a trimmed beard, wearing a navy polo shirt.',
    idleStyle: 'Listens leaning in slightly with an engaged, energetic expression.',
  }),
  persona({
    id: 'sofia',
    name: 'Sofia Rossi',
    role: 'Senior recruiter',
    personality: 'Friendly but watches for rambling. Values brief, structured answers and checks whether you answered the question asked.',
    focus: ['communication', 'structure', 'composure'],
    strictness: 2,
    expression: { nod: 0.6, smile: 0.55, frown: 0.2, glance: 0.15, sceptical: 0.15 },
    voiceId: VOICES.lily,
    look: 'A woman in her early thirties with wavy auburn hair, wearing a soft green blouse.',
    idleStyle: 'Listens warmly with an open expression and encouraging nods.',
  }),
  persona({
    id: 'david',
    name: 'David Kim',
    role: 'VP of Engineering',
    personality: 'Calm and very senior. Asks about scale, reliability and how you would lead others through a hard technical decision.',
    focus: ['scale', 'leadership', 'trade-offs'],
    strictness: 5,
    expression: { nod: 0.25, smile: 0.1, frown: 0.45, glance: 0.15, sceptical: 0.6 },
    voiceId: VOICES.daniel,
    look: 'A man in his early fifties with short salt-and-pepper hair, wearing a dark navy quarter-zip sweater.',
    idleStyle: 'Listens with a still, unreadable expression and steady eye contact.',
  }),
  persona({
    id: 'nadia',
    name: 'Nadia Petrova',
    role: 'Data science lead',
    personality: 'Analytical and fair. Asks how you know it worked: the metric, the baseline and the sample size.',
    focus: ['evidence', 'metrics', 'impact'],
    strictness: 4,
    expression: { nod: 0.3, smile: 0.15, frown: 0.45, glance: 0.2, sceptical: 0.55 },
    voiceId: VOICES.lily,
    look: 'A woman in her mid thirties with long light brown hair worn straight, wearing a black knit top.',
    idleStyle: 'Listens with a sharp, measured expression; occasionally narrows eyes when weighing a claim.',
  }),
  persona({
    id: 'marcos',
    name: 'Marcos Silva',
    role: 'Team lead, future peer',
    personality: 'Easy-going and practical. Asks what you would be like to work with, how you handle disagreement and feedback.',
    focus: ['collaboration', 'communication', 'ownership'],
    strictness: 2,
    expression: { nod: 0.6, smile: 0.55, frown: 0.15, glance: 0.15, sceptical: 0.15 },
    voiceId: VOICES.brian,
    look: 'A man in his early thirties with wavy dark hair and light stubble, wearing a casual olive overshirt.',
    idleStyle: 'Listens with a relaxed, friendly expression and easy nods.',
  }),
  persona({
    id: 'eleanor',
    name: 'Eleanor Wright',
    role: 'Chief of staff',
    personality: 'Polished and brisk. Checks whether answers are structured, concise and land the point in the first sentence.',
    focus: ['structure', 'clarity', 'composure'],
    strictness: 4,
    expression: { nod: 0.35, smile: 0.25, frown: 0.35, glance: 0.3, sceptical: 0.4 },
    voiceId: VOICES.sarah,
    look: 'A woman in her mid forties with a neat blonde bob, wearing a tailored burgundy blazer.',
    idleStyle: 'Listens with a poised, attentive expression; occasionally glances at notes.',
  }),
]

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
        anamAvatarId: '42675ef1-2342-45d8-9603-9bd92ed45699', // Anam: Kiara (realistic)
        anamVoiceId: '14d8d146-4d2d-4c52-a398-9513083d45eb', // Anam: Ashleigh
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
        anamAvatarId: '917ff800-24e8-41a0-9621-4adea170d9f5', // Anam: Gabriel (realistic)
        anamVoiceId: 'd92bcfe7-13a1-4502-8812-de745b0b5c0f', // Anam: Conrad
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
        anamAvatarId: '5e96a4a4-4a1d-4ead-a5c9-122627d91655', // Anam: Elena (realistic)
        anamVoiceId: '4d45f36a-8b00-4a7e-8786-9c9814cc55ec', // Anam: Anika
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
        anamAvatarId: 'ccf00c0e-7302-455b-ace2-057e0cf58127', // Anam: Kevin (realistic)
        anamVoiceId: '372effd0-24d4-4882-9753-d79f8814d15d', // Anam: Aryaveer
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
        anamAvatarId: 'bdaaedfa-00f2-417a-8239-8bb89adec682', // Anam: Astrid (realistic)
        anamVoiceId: '8fc06972-4fc0-11f1-84b0-52bacf74fa75', // Anam: Skylar
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
        anamAvatarId: 'c8601ae3-9686-4f1f-8e32-7499b470f6b5', // Anam: Marcus (realistic)
        anamVoiceId: '9bc24780-f5d0-4fbe-a618-3d5fb9617d0e', // Anam: Eastend Steve
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
        anamAvatarId: 'a7eb25e8-8c31-460d-a397-8cd8010c76d1', // Anam: Antonia (realistic)
        anamVoiceId: 'd384dc7e-c012-454c-8ebb-a5c030127052', // Anam: Elise
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
        anamAvatarId: 'd73415e3-d624-45a6-a461-0df1580e73d6', // Anam: Leo (realistic)
        anamVoiceId: '4c60ebfd-4ea1-5f7d-a6d6-9ffbe7af644f', // Anam: Darian
        look: 'A man in his early thirties with messy brown hair and stubble, wearing a black t-shirt.',
        idleStyle: 'Listens with a flat, slightly sceptical expression and arms-crossed stillness.',
      }),
    ],
  },
]

// Each built-in panel draws its lineup from a larger pool, so practice sessions don't always face the same people.
// The lineup size stays the panel's original size; the original members are part of the pool.
const EXTRAS: Record<string, Persona[]> = { investors: INVESTOR_EXTRAS, peers: PEER_EXTRAS, interview: INTERVIEW_EXTRAS }
for (const panel of PANELS) {
  panel.pool = [...panel.personas, ...(EXTRAS[panel.id] ?? [])]
  panel.size = panel.personas.length
}

/**
 * A random lineup for one session: `size` people from the panel's pool. If the pool has a strict member (4+), at
 * least one is included so the panel is never all soft, and the strictest sits first (the first persona leads).
 */
export function drawPanel(panel: Panel, rand: () => number = Math.random): Panel {
  const pool = panel.pool ?? panel.personas
  const size = Math.min(panel.size ?? panel.personas.length, pool.length)
  const shuffled = [...pool].map((p) => ({ p, k: rand() })).sort((a, b) => a.k - b.k).map((x) => x.p)
  const lineup = shuffled.slice(0, size)
  const strict = shuffled.filter((p) => p.strictness >= 4)
  if (strict.length && !lineup.some((p) => p.strictness >= 4)) lineup[lineup.length - 1] = strict[0]
  lineup.sort((a, b) => b.strictness - a.strictness)
  return { ...panel, personas: lineup }
}

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
