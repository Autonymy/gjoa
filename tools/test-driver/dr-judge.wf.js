export const meta = {
  name: 'dr-judge',
  description: 'Opus judges gjoa vs Firefox+DarkReader dark-mode screenshots pairwise; tallies where gjoa must improve',
  phases: [{ title: 'Discover' }, { title: 'Judge' }],
}

const OUT = (args && args.outdir) || '/tmp/dr-compare'

const PAIRS = {
  type: 'object', additionalProperties: false, required: ['pairs'],
  properties: { pairs: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    required: ['slug', 'gjoaTop', 'gjoaMid', 'drTop', 'drMid'],
    properties: { slug:{type:'string'}, gjoaTop:{type:'string'}, gjoaMid:{type:'string'}, drTop:{type:'string'}, drMid:{type:'string'} },
  } } },
}

const VERDICT = {
  type: 'object', additionalProperties: false,
  required: ['slug', 'verdict', 'gjoaOverall', 'drOverall', 'gjoaDefects', 'notes'],
  properties: {
    slug: { type: 'string' },
    verdict: { type: 'string', enum: ['gjoa_wins', 'tie', 'dr_wins'] },
    gjoaOverall: { type: 'number', description: '1-10 overall dark-mode quality of gjoa' },
    drOverall: { type: 'number', description: '1-10 overall dark-mode quality of Dark Reader' },
    gjoaDefects: { type: 'array', items: { type: 'string' }, description: 'specific concrete gjoa defects vs DR (empty if none)' },
    notes: { type: 'string' },
  },
}

phase('Discover')
const disc = await agent(
  `List ${OUT}/gjoa-*-1top.png. For each, derive the slug (the part between "gjoa-" and "-1top.png") and build the four paths: ${OUT}/gjoa-<slug>-1top.png, ${OUT}/gjoa-<slug>-2mid.png, ${OUT}/dr-<slug>-1top.png, ${OUT}/dr-<slug>-2mid.png. Include a pair ONLY if all four files exist (use Bash test -f). Return the pairs.`,
  { label: 'discover-pairs', phase: 'Discover', schema: PAIRS })

const pairs = (disc && disc.pairs) || []
log(`judging ${pairs.length} site pairs`)

phase('Judge')
const verdicts = (await parallel(pairs.map(p => () =>
  agent(
    `Compare two dark-mode renderings of the SAME website, top + scrolled views.\n` +
    `gjoa (the browser under test): Read ${p.gjoaTop} and ${p.gjoaMid}.\n` +
    `Dark Reader (the control to beat): Read ${p.drTop} and ${p.drMid}.\n\n` +
    `Judge as a demanding dark-mode connoisseur. gjoa must be AS GOOD OR BETTER than Dark Reader to pass. Weigh: ` +
    `(1) background truly dark, no glaring bright panels/headers; (2) text legible, correct neutral/brand colors, NO purple/washed tint; ` +
    `(3) brand & accent colors preserved (e.g. logos, orange/blue banners keep identity, not muddied to black); ` +
    `(4) images/photos untouched, dark logos still visible; (5) no transparent/see-through gaps; (6) overall polish.\n` +
    `Score gjoaOverall and drOverall 1-10. verdict = gjoa_wins only if gjoa >= DR on every axis; dr_wins if DR is clearly better anywhere; tie if equivalent. ` +
    `List gjoa's concrete defects vs DR (what to fix). Site: ${p.slug}.`,
    { label: `judge:${p.slug}`, phase: 'Judge', schema: VERDICT, effort: 'high' })
    .then(v => ({ ...v, slug: v.slug || p.slug }))
))).filter(Boolean)

const wins = verdicts.filter(v => v.verdict === 'gjoa_wins').length
const ties = verdicts.filter(v => v.verdict === 'tie').length
const losses = verdicts.filter(v => v.verdict === 'dr_wins').length
const allDefects = {}
for (const v of verdicts) for (const d of (v.gjoaDefects || [])) allDefects[d] = (allDefects[d] || 0) + 1
const defectRanking = Object.entries(allDefects).sort((a, b) => b[1] - a[1]).map(([d, n]) => `${n}x ${d}`)

return {
  total: verdicts.length, gjoa_wins: wins, ties, dr_wins: losses,
  passing: losses === 0 && ties === 0,
  losingSites: verdicts.filter(v => v.verdict !== 'gjoa_wins').map(v => ({ slug: v.slug, verdict: v.verdict, gjoa: v.gjoaOverall, dr: v.drOverall, defects: v.gjoaDefects })),
  defectRanking,
  verdicts,
}
