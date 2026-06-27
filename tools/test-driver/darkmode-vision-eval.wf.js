export const meta = {
  name: 'darkmode-vision-eval',
  description: 'Opus-grade vision eval of gjoa dark mode vs Firefox+DarkReader across real sites',
  phases: [
    { title: 'Evaluate', detail: 'per-site vision scoring of gjoa vs the DarkReader control' },
    { title: 'Synthesize', detail: 'rank defects across sites + root causes + fix plan' },
  ],
}

const DIR = '/tmp/dmeval'
const SITES = [
  { name: 'YouTube (logged-out home)', slug: 'youtube_com_' },
  { name: 'Wikipedia article (Photosynthesis)', slug: 'en_wikipedia_org_wiki_Photosynth' },
  { name: 'Reddit home', slug: 'reddit_com_' },
  { name: 'Hacker News (a light site, must be force-darkened)', slug: 'news_ycombinator_com_' },
  { name: 'Amazon home', slug: 'amazon_com_' },
]

const EVAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['site','gjoa_scores','gjoa_overall','control_overall','verdict','defects'],
  properties: {
    site: { type: 'string' },
    render_ok: { type: 'boolean', description: 'false if the gjoa screenshot looks blank/broken' },
    gjoa_scores: {
      type: 'object', additionalProperties: false,
      required: ['bg_darkness','text_contrast','no_light_blowouts','image_handling','usability'],
      properties: {
        bg_darkness: { type: 'integer' },
        text_contrast: { type: 'integer' },
        no_light_blowouts: { type: 'integer' },
        image_handling: { type: 'integer' },
        usability: { type: 'integer' },
      },
    },
    gjoa_overall: { type: 'integer' },
    control_overall: { type: 'integer' },
    verdict: { type: 'string', enum: ['gjoa_better','similar','control_better'] },
    defects: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['severity','where','issue'],
        properties: {
          severity: { type: 'string', enum: ['critical','major','minor'] },
          where: { type: 'string' },
          issue: { type: 'string' },
        },
      },
    },
    notes: { type: 'string' },
  },
}

phase('Evaluate')
const evals = (await parallel(SITES.map(s => () =>
  agent(
    `You are a meticulous dark-mode QA evaluator for the gjoa browser (a Firefox fork). Score gjoa's dark-mode rendering of ${s.name} against the gold-standard control (Firefox + Dark Reader).

Read ALL FOUR screenshots with the Read tool (they render as images):
  gjoa, top of page:      ${DIR}/gjoa-${s.slug}-1top.png
  gjoa, scrolled down:    ${DIR}/gjoa-${s.slug}-2mid.png
  CONTROL (FF+DarkReader) top:      ${DIR}/ctrl-${s.slug}-1top.png
  CONTROL (FF+DarkReader) scrolled: ${DIR}/ctrl-${s.slug}-2mid.png

IMPORTANT: gjoa's screenshots include gjoa's OWN browser chrome on the LEFT (a vertical sidebar) and top — that chrome is always dark and is NOT under test. Judge only the WEB PAGE CONTENT (the large area to the right / below the address bar). The control's chrome is Firefox's — also ignore it. Login state may differ between the two (gjoa is logged-out); judge the dark-mode TREATMENT quality (colors, contrast, blowouts), not the exact content.

Score gjoa's web content 0-10 on each, harshly and specifically:
- bg_darkness: deep near-black = 10; gray/washed = mid; any light/white page background = low.
- text_contrast: crisp readable body+secondary text = 10; washed-out/low-contrast/muddy text = low.
- no_light_blowouts: 10 = nothing jarringly light; subtract for each white/bright card, banner, input field, button, or image box that should be dark.
- image_handling: logos/photos/thumbnails look natural = 10; inverted-to-negative or muddy = low.
- usability: would this be genuinely comfortable to use in the dark? 
Then gjoa_overall and control_overall (same rubric, judging the whole content area), and verdict (is gjoa better / similar / worse than Dark Reader?).
List EVERY concrete defect in gjoa with severity (critical/major/minor) and WHERE (e.g. "search bar", "right sidebar cards", "comment timestamps", "product price boxes").
Set render_ok=false if gjoa's screenshot is blank/broken. Be specific — this drives real fixes.`,
    { label: `eval:${s.slug}`, phase: 'Evaluate', schema: EVAL_SCHEMA }
  )
))).filter(Boolean)

phase('Synthesize')
const synthesis = await agent(
  `You are the lead engineer triaging a dark-mode quality push for gjoa (a Firefox 152 fork). Below are per-site vision evaluations of gjoa's dark mode vs a Firefox+DarkReader control.

${JSON.stringify(evals, null, 2)}

gjoa's dark-mode engine today: it forces prefers-color-scheme:dark globally, then per-site decides one of accept-native-dark ("inactive") / force-invert ("active") / do-nothing ("none"), driven by a Dark-Reader-derived per-site dataset (darkmode-fixes.json). It has dimming for large bright media. A backdrop-aware contrast NORMALIZER exists but is pref-gated OFF by default. For YouTube specifically the engine chose "none" (accepted YouTube's own native dark, which is a mid-gray, not deep black).

Produce an engineering-actionable report:
1. SCORE GAP: average gjoa_overall vs control_overall, and where gjoa loses worst.
2. TOP DEFECT PATTERNS (5-8), ranked by cross-site impact (e.g. "accepts mediocre native dark instead of deepening it", "light input fields/search bars survive", "washed-out secondary text", "blown-out white cards", "inverted logos look negative").
3. For each pattern: the likely ROOT in gjoa's engine (decision logic returning the wrong override / normalizer being off / missing per-site CSS / media handling) and a concrete fix direction.
4. The SINGLE highest-leverage change to ship first to close the most gap.
Be concrete; name the mechanism (override decision, normalizer pref, per-site CSS) for each fix.`,
  { label: 'synthesize', phase: 'Synthesize', effort: 'high' }
)

return { site_evals: evals, synthesis }
