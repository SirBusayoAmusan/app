/* ------------------------------------------------------------------
   Downstream engines — everything that happens AFTER an opportunity is
   accepted. Each one is fed the validated opportunity object, the
   generated product context and (for optimization) real performance
   data. Outputs are schema-bound and persisted locally.
   ------------------------------------------------------------------ */
import { z } from 'zod';
import type {
  AnalyticsInputs, AudienceProfile, Evidence, ID, Niche, OpportunityScore, PricingPlan,
  Problem, Product, ProductStrategy, Project, Validation,
} from '../types';
import { db, nowISO, uid } from '../db/database';
import { runAI } from '../ai/providers';
import { err } from '../lib/utils';
import * as P from '../prompts';
import * as S from '../schemas/schemas';
import { getCredential } from '../ai/session';

const system = (specific: string) => `${P.GLOBAL_SYSTEM_PROMPT}\n\n${specific}`;

export interface EnginesCtx { config: any; onUsage?: (u: any) => void }

async function ai<T>(ctx: EnginesCtx, schemaName: string, schema: object, prompt: string, temperature = 0.2, maxTokens = 4000): Promise<T> {
  if (!getCredential('ai')) throw err('invalid_api_key', 'No API key in this session. Reconnect your provider.');
  const res = await runAI<T>(ctx.config, {
    schema_name: schemaName,
    schema,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: prompt.includes('GLOBAL') ? prompt : system(prompt) },
      { role: 'user', content: prompt },
    ],
  });
  ctx.onUsage?.({ calls: 1, tokens_in: res.tokens_in, tokens_out: res.tokens_out });
  if (!res.data) throw err('malformed_response', 'The model did not return valid JSON.', { retryable: true });
  return res.data;
}

/* ---------------------------- context block --------------------------- */

export async function opportunityContext(projectId: ID) {
  const project = await db.projects.get(projectId);
  if (!project) throw err('unknown', 'Project not found.');
  const [niche, problem, validation, score, evidence, run] = await Promise.all([
    db.niches.get(project.niche_id),
    db.problems.get(project.problem_id),
    db.validations.where('problem_id').equals(project.problem_id).first(),
    db.opportunity_scores.where('problem_id').equals(project.problem_id).first(),
    db.evidence.where('research_run_id').equals(project.run_id).toArray(),
    db.research_runs.get(project.run_id),
  ]);
  return { project, niche: niche!, problem: problem!, validation, score, evidence, run: run!, audience: run?.audience_snapshot as AudienceProfile };
}

function opportunityPromptBlock(ctx: Awaited<ReturnType<typeof opportunityContext>>, opts: { includeScores?: boolean } = {}) {
  const { niche, problem, validation, score, project, audience } = ctx;
  return [
    `PROJECT\n${JSON.stringify({ name: project.name, currency: project.currency }, null, 2)}`,
    `AUDIENCE\n${JSON.stringify({ age: `${audience?.age_min}-${audience?.age_max}`, location: audience?.location, language: audience?.language, income: audience?.income_level, employment: audience?.employment_status, experience: audience?.experience_level, interests: audience?.interests, platforms: audience?.platforms }, null, 2)}`,
    `NICHE\n${JSON.stringify({ niche: niche.specific_niche, audience: niche.target_audience, problem: niche.core_problem, desired_outcome: niche.desired_outcome, context: niche.context }, null, 2)}`,
    `VALIDATED PROBLEM\n${JSON.stringify({ statement: problem.problem_statement, underlying: problem.underlying_problem, why_it_hurts: problem.why_it_hurts, who: problem.who_experiences_it, workarounds: problem.current_workarounds, why_solutions_fail: problem.why_existing_solutions_fail, customer_language: problem.customer_language.slice(0, 12), searches: problem.what_people_search, conversation_signals: problem.conversation_signals, candidate_products: problem.potential_product_solutions, recommended: problem.recommended_product }, null, 2)}`,
    opts.includeScores === false ? '' : `OPPORTUNITY SCORE (computed by the deterministic engine — absolute, do not restate differently)\n${JSON.stringify({ opportunity_score: score?.final_score, evidence_confidence: score?.evidence_confidence, label: score?.score_label, contradiction_rate: score?.contradiction_rate, component_scores: Object.fromEntries(Object.entries(score?.components ?? {}).map(([k, v]: any) => [k, v.score])) }, null, 2)}`,
    `EVIDENCE CONFIDENCE NOTE\n${validation ? `${validation.status} — ${validation.reasoning_summary.slice(0, 900)}` : 'No validation record.'}`,
    `RULES\n- Use only the facts above plus general craft knowledge. Never invent statistics, testimonials, competitor prices or sales figures.\n- If something is unknown, say it is an assumption.`,
  ].filter(Boolean).join('\n\n');
}

/* ------------------------- 1. product strategy ------------------------ */

const ProductZ = z.object({
  recommended_format: z.string(),
  format_reasoning: z.string().default(''),
  product_promise: z.string().default(''),
  product_name_options: z.array(z.string()).default([]),
  transformation: z.object({ from: z.string().default(''), to: z.string().default('') }).default({ from: '', to: '' }),
  contents: z.array(z.object({ title: z.string(), purpose: z.string().default('') })).default([]),
  worksheets: z.array(z.object({ title: z.string(), purpose: z.string().default('') })).default([]),
  checklists: z.array(z.object({ title: z.string(), items: z.array(z.string()).default([]) })).default([]),
  bonuses: z.array(z.string()).default([]),
  positioning: z.string().default(''),
  sales_page: z.object({
    headline: z.string().default(''),
    subheadline: z.string().default(''),
    bullets: z.array(z.string()).default([]),
    offer_stack: z.array(z.string()).default([]),
    guarantee: z.string().default(''),
    faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
    cta: z.string().default(''),
  }).default({ headline: '', subheadline: '', bullets: [], offer_stack: [], guarantee: '', faq: [], cta: '' }),
});

export async function generateProductStrategy(ctx: EnginesCtx, projectId: ID): Promise<ProductStrategy> {
  const octx = await opportunityContext(projectId);
  const data = await ai<any>(ctx, 'product_strategy', S.PRODUCT_SCHEMA, `${opportunityPromptBlock(octx)}\n\nTASK\nRecommend the smallest viable product for this validated problem, with full contents, worksheets, checklists, bonuses, positioning and a sales page skeleton.`, 0.25, 6000);
  const parsed = ProductZ.safeParse(data);
  if (!parsed.success) throw err('malformed_response', 'Unexpected product strategy shape.', { detail: parsed.error.message });
  const strategy: ProductStrategy = { ...parsed.data, selected_name: parsed.data.product_name_options[0], generated_at: nowISO() } as ProductStrategy;

  const existing = await db.products.where('project_id').equals(projectId).first();
  const product: Product = {
    id: existing?.id ?? uid('prod'),
    project_id: projectId,
    product_type: strategy.recommended_format,
    name: strategy.selected_name ?? strategy.product_name_options[0] ?? 'Untitled product',
    promise: strategy.product_promise,
    strategy,
    guide: existing?.guide ?? null,
    status: 'draft',
    created_at: existing?.created_at ?? nowISO(),
    updated_at: nowISO(),
  };
  await db.products.put(product);
  await db.projects.update(projectId, { status: 'building', updated_at: nowISO() });
  return strategy;
}

/* ---------------------------- 2. guide writing ------------------------ */

const ChapterZ = z.object({
  title: z.string(),
  body_markdown: z.string(),
  key_takeaways: z.array(z.string()).default([]),
  worksheet: z.object({ title: z.string().default(''), prompt: z.string().default(''), rows: z.array(z.string()).default([]) }).default({ title: '', prompt: '', rows: [] }),
});

export async function generateChapter(ctx: EnginesCtx, projectId: ID, chapterIndex: number): Promise<void> {
  const product = await db.products.where('project_id').equals(projectId).first();
  if (!product?.guide) throw err('unknown', 'No guide outline exists yet. Generate the outline first.');
  const octx = await opportunityContext(projectId);
  const chapters = [...product.guide.chapters];
  const chapter = chapters[chapterIndex];
  if (!chapter) throw err('unknown', 'Chapter not found.');

  chapters[chapterIndex] = { ...chapter, status: 'generating', error: undefined };
  await db.products.update(product.id, { guide: { ...product.guide, chapters }, updated_at: nowISO() });

  try {
    const outline = chapters.map((c, i) => `${i + 1}. ${c.title} — ${c.purpose}`).join('\n');
    const data = await ai<any>(ctx, 'guide_chapter', S.GUIDED_CHAPTER_SCHEMA, [
      opportunityPromptBlock(octx, { includeScores: false }),
      `PRODUCT\n${JSON.stringify({ name: product.name, promise: product.promise, format: product.product_type }, null, 2)}`,
      `FULL OUTLINE\n${outline}`,
      `WRITE CHAPTER ${chapterIndex + 1}: "${chapter.title}"\nPurpose: ${chapter.purpose}\n\nWrite it completely (700-1100 words), ending with one specific action step, plus a worksheet with fill-in prompts.`,
    ].join('\n\n'), 0.35, 5000);

    const parsed = ChapterZ.safeParse(data);
    if (!parsed.success) throw err('malformed_response', parsed.error.message);
    chapters[chapterIndex] = {
      ...chapter,
      title: parsed.data.title || chapter.title,
      body: parsed.data.body_markdown,
      status: 'ready',
    };
    const guide = { ...product.guide, chapters };
    if (parsed.data.worksheet?.title) {
      guide.worksheets = [...(guide.worksheets ?? []).filter((w) => w.title !== parsed.data.worksheet.title), {
        title: parsed.data.worksheet.title,
        purpose: parsed.data.worksheet.prompt,
        body: (parsed.data.worksheet.rows ?? []).map((r) => `- ${r}`).join('\n'),
      }];
    }
    if (parsed.data.key_takeaways?.length) {
      chapters[chapterIndex].purpose = `${chapter.purpose} · Key takeaways: ${parsed.data.key_takeaways.join(' / ')}`;
    }
    await db.products.update(product.id, { guide, updated_at: nowISO() });
  } catch (e: any) {
    chapters[chapterIndex] = { ...chapter, status: 'error', error: e?.message ?? 'Generation failed.' };
    await db.products.update(product.id, { guide: { ...product.guide, chapters }, updated_at: nowISO() });
    throw e;
  }
}

export async function ensureGuide(projectId: ID, wordTarget = 6000) {
  const product = await db.products.where('project_id').equals(projectId).first();
  if (!product?.strategy) throw err('unknown', 'Generate the product strategy first.');
  if (product.guide) return product.guide;
  const octx = await opportunityContext(projectId);
  const guide = {
    title: product.name,
    subtitle: product.strategy.product_promise,
    audience: octx.niche.target_audience,
    promise: product.strategy.product_promise,
    chapters: product.strategy.contents.map((c) => ({ id: uid('ch'), title: c.title, purpose: c.purpose, body: '', status: 'empty' as const })),
    worksheets: product.strategy.worksheets.map((w) => ({ title: w.title, purpose: w.purpose, body: '' })),
    checklists: product.strategy.checklists.map((c) => ({ title: c.title, items: c.items })),
    bonus: product.strategy.bonuses[0] ?? '',
    word_target: wordTarget,
  };
  await db.products.update(product.id, { guide, updated_at: nowISO() });
  return guide;
}

export async function saveGuide(projectId: ID, guide: Product['guide']) {
  const product = await db.products.where('project_id').equals(projectId).first();
  if (!product) throw err('unknown', 'Product not found.');
  await db.products.update(product.id, { guide, updated_at: nowISO() });
}

/* ---------------------------- 3. sales page --------------------------- */

const SalesPageZ = z.object({
  hero_headline: z.string(),
  hero_subheadline: z.string().default(''),
  problem_section: z.string().default(''),
  solution_section: z.string().default(''),
  whats_inside: z.array(z.string()).default([]),
  proof_section: z.string().default(''),
  offer_section: z.string().default(''),
  faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
  final_cta: z.string().default(''),
});

export async function generateSalesPage(ctx: EnginesCtx, projectId: ID) {
  const octx = await opportunityContext(projectId);
  const product = await db.products.where('project_id').equals(projectId).first();
  const pricing = await db.pricing.where('project_id').equals(projectId).first();
  const data = await ai<any>(ctx, 'sales_page', S.SALES_PAGE_SCHEMA, [
    opportunityPromptBlock(octx),
    `PRODUCT\n${JSON.stringify({ name: product?.name, promise: product?.promise, format: product?.product_type, contents: product?.strategy?.contents?.map((c) => c.title) ?? [], bonuses: product?.strategy?.bonuses ?? [] }, null, 2)}`,
    `PRICE\n${JSON.stringify({ currency: pricing?.currency ?? octx.project.currency, launch: pricing?.launch_price, standard: pricing?.standard_price, premium: pricing?.premium_price }, null, 2)}`,
    `TASK\nWrite the complete sales page. Do not invent testimonials or sales numbers.`,
  ].join('\n\n'), 0.3, 5000);
  const parsed = SalesPageZ.safeParse(data);
  if (!parsed.success) throw err('malformed_response', parsed.error.message);
  await db.marketing.put({ id: uid('mkt'), project_id: projectId, module_key: 'sales_page', title: 'Sales page', payload: parsed.data, updated_at: nowISO() });
  return parsed.data;
}

/* ------------------------------ 4. pricing ---------------------------- */

const PricingZ = z.object({
  currency: z.string().default('USD'),
  recommended_price: z.number().default(0),
  launch_price: z.number().default(0),
  standard_price: z.number().default(0),
  premium_price: z.number().default(0),
  premium_bundle: z.array(z.string()).default([]),
  value_justification: z.string().default(''),
  pricing_reasoning: z.string().default(''),
  objections: z.array(z.object({ objection: z.string(), response: z.string() })).default([]),
  offer_stack: z.array(z.string()).default([]),
  discount_strategy: z.string().default(''),
  price_testing_plan: z.array(z.string()).default([]),
  payment_notes: z.string().default(''),
});

export async function generatePricing(ctx: EnginesCtx, projectId: ID): Promise<PricingPlan> {
  const octx = await opportunityContext(projectId);
  const product = await db.products.where('project_id').equals(projectId).first();
  const data = await ai<any>(ctx, 'pricing_plan', S.PRICING_SCHEMA, [
    opportunityPromptBlock(octx),
    `PRODUCT\n${JSON.stringify({ name: product?.name, format: product?.product_type, promise: product?.promise, sections: product?.strategy?.contents?.length ?? 0, bonuses: product?.strategy?.bonuses ?? [] }, null, 2)}`,
    `TASK\nRecommend pricing for this product and audience. Currency should fit the audience location (${octx.audience?.location}). If the evidence contains no competitor pricing, state that your numbers are value-based estimates and show the assumption.`,
  ].join('\n\n'), 0.1, 3500);
  const parsed = PricingZ.safeParse(data);
  if (!parsed.success) throw err('malformed_response', parsed.error.message);

  const plan: PricingPlan = {
    id: uid('price'),
    project_id: projectId,
    currency: parsed.data.currency || octx.project.currency,
    recommended_price: parsed.data.recommended_price,
    launch_price: parsed.data.launch_price || parsed.data.recommended_price,
    standard_price: parsed.data.standard_price || parsed.data.recommended_price,
    premium_price: parsed.data.premium_price || null,
    premium_bundle: parsed.data.premium_bundle,
    value_justification: parsed.data.value_justification,
    pricing_reasoning: parsed.data.pricing_reasoning,
    objections: parsed.data.objections as { objection: string; response: string }[],
    offer_stack: parsed.data.offer_stack,
    discount_strategy: parsed.data.discount_strategy,
    price_testing_plan: parsed.data.price_testing_plan,
    generated_at: nowISO(),
  };
  await db.pricing.put(plan);
  await db.projects.update(projectId, { currency: plan.currency, updated_at: nowISO() });
  return plan;
}

/* --------------------------- 5. marketing modules --------------------- */

export const MARKETING_MODULES = [
  { key: 'positioning', title: 'Positioning', brief: 'Positioning statement, category, enemy, unique mechanism, one-line pitch and proof strategy.' },
  { key: 'offer', title: 'Offer creation', brief: 'The full offer: components, bonuses, guarantee, urgency mechanics, risk reversal and pricing presentation.' },
  { key: 'lead_magnet', title: 'Lead magnet', brief: 'A 15-minute-to-consume lead magnet that attracts exactly the validated audience, plus delivery copy.' },
  { key: 'email_sequence', title: 'Email sequence', brief: '7-email welcome/sales sequence with subject lines, preview text and full bodies.' },
  { key: 'organic_content', title: 'Organic content', brief: '30-day content plan: pillars, formats, hooks, captions and posting cadence per platform.' },
  { key: 'short_form_video', title: 'Short-form video', brief: '12 short-form scripts with hook, beats, on-screen text and CTA.' },
  { key: 'seo', title: 'SEO strategy', brief: 'Keyword clusters, article titles and outlines that match real search demand found in the evidence.' },
  { key: 'community', title: 'Community strategy', brief: 'Which communities to join, the exact value-first approach and where to mention the product without being spammy.' },
  { key: 'influencer', title: 'Influencer strategy', brief: 'Micro-creator profile, outreach templates, deal structures and content briefs.' },
  { key: 'affiliate', title: 'Affiliate strategy', brief: 'Affiliate/partner program structure, commission math, recruitment DMs and tracking.' },
  { key: 'funnel', title: 'Sales funnel', brief: 'Funnel map from cold attention to purchase, with assets at each step and expected drop-off points.' },
  { key: 'launch_campaign', title: 'Launch campaign', brief: 'Launch narrative, phases, daily plan and the posts/emails for each phase.' },
] as const;

const MarketingZ = z.object({
  module_key: z.string().default(''),
  headline: z.string().default(''),
  summary: z.string().default(''),
  blocks: z.array(z.object({ title: z.string().default(''), detail: z.string().default(''), items: z.array(z.string()).default([]) })).default([]),
  assets: z.array(z.object({ label: z.string().default(''), content: z.string().default('') })).default([]),
  next_actions: z.array(z.string()).default([]),
});

export async function generateMarketingModule(ctx: EnginesCtx, projectId: ID, moduleKey: string) {
  const mod = MARKETING_MODULES.find((m) => m.key === moduleKey);
  if (!mod) throw err('unknown', `Unknown marketing module: ${moduleKey}`);
  const octx = await opportunityContext(projectId);
  const product = await db.products.where('project_id').equals(projectId).first();
  const pricing = await db.pricing.where('project_id').equals(projectId).first();
  const data = await ai<any>(ctx, `marketing_${moduleKey}`, S.MARKETING_SCHEMA, [
    opportunityPromptBlock(octx),
    `PRODUCT\n${JSON.stringify({ name: product?.name, format: product?.product_type, promise: product?.promise, contents: product?.strategy?.contents?.map((c) => c.title) ?? [], bonuses: product?.strategy?.bonuses ?? [] }, null, 2)}`,
    `PRICING\n${JSON.stringify({ currency: pricing?.currency, launch: pricing?.launch_price, standard: pricing?.standard_price, premium: pricing?.premium_price }, null, 2)}`,
    `MODULE: ${mod.title}\nBRIEF: ${mod.brief}`,
    `TASK\nProduce the module. Everything must be copy-paste ready for THIS problem and THIS audience. Put real copy in \`assets\` (label + full text). No generic advice.`,
  ].join('\n\n'), 0.35, 4500);
  const parsed = MarketingZ.safeParse(data);
  if (!parsed.success) throw err('malformed_response', parsed.error.message);
  const saved = { id: uid('mkt'), project_id: projectId, module_key: moduleKey, title: mod.title, payload: parsed.data, updated_at: nowISO() };
  await db.marketing.put(saved);
  return saved;
}

/* ------------------------------ 6. ads -------------------------------- */

const AdsZ = z.object({
  platform: z.string().default(''),
  strategy_summary: z.string().default(''),
  concepts: z.array(z.object({
    concept_id: z.string().default(''),
    audience: z.string().default(''),
    pain_angle: z.string().default(''),
    hook: z.string().default(''),
    creative_concept: z.string().default(''),
    primary_text: z.string().default(''),
    headline: z.string().default(''),
    description: z.string().default(''),
    cta: z.string().default(''),
    landing_page_angle: z.string().default(''),
    testing_hypothesis: z.string().default(''),
  })).default([]),
  testing_matrix: z.array(z.object({ variable: z.string(), variant_a: z.string(), variant_b: z.string(), success_metric: z.string() })).default([]),
  budget_scenarios: z.array(z.object({ level: z.string(), daily_budget: z.string(), objective: z.string(), expectation: z.string() })).default([]),
  retargeting: z.string().default(''),
  compliance_notes: z.array(z.string()).default([]),
});

export async function generateAds(ctx: EnginesCtx, projectId: ID, platform: string) {
  const octx = await opportunityContext(projectId);
  const product = await db.products.where('project_id').equals(projectId).first();
  const pricing = await db.pricing.where('project_id').equals(projectId).first();
  const data = await ai<any>(ctx, 'ad_campaign', S.ADS_SCHEMA, [
    opportunityPromptBlock(octx),
    `PRODUCT\n${JSON.stringify({ name: product?.name, promise: product?.promise, format: product?.product_type }, null, 2)}`,
    `PRICE\n${JSON.stringify({ currency: pricing?.currency, launch: pricing?.launch_price, standard: pricing?.standard_price }, null, 2)}`,
    `PLATFORM: ${platform}`,
    `TASK\nProduce ad concepts, a testing matrix, budget scenarios for a solo seller starting small, retargeting logic and platform compliance cautions. Never claim an ad will definitely work.`,
  ].join('\n\n'), 0.4, 5500);
  const parsed = AdsZ.safeParse(data);
  if (!parsed.success) throw err('malformed_response', parsed.error.message);
  const record = { id: uid('camp'), project_id: projectId, platform, concepts: parsed.data.concepts, testing_matrix: parsed.data.testing_matrix, budget_scenarios: parsed.data.budget_scenarios, retargeting: parsed.data.retargeting, strategy_summary: parsed.data.strategy_summary, compliance_notes: parsed.data.compliance_notes, generated_at: nowISO() };
  await db.campaigns.put(record as any);
  return record;
}

/* ---------------------------- 7. launch plan -------------------------- */

export const LAUNCH_TASKS = [
  { key: 'product_complete', label: 'Product complete', detail: 'Every chapter written, worksheets attached, PDF exported and proofread.' },
  { key: 'offer_finalized', label: 'Offer finalized', detail: 'Deliverables, bonuses, guarantee and delivery method decided.' },
  { key: 'price_finalized', label: 'Price finalized', detail: 'Launch price, standard price and premium tier locked.' },
  { key: 'landing_page', label: 'Landing page ready', detail: 'Sales page live with working checkout link and mobile check.' },
  { key: 'checkout', label: 'Checkout ready', detail: 'Payment processor live, digital delivery automated, receipt email tested.' },
  { key: 'lead_magnet', label: 'Lead magnet ready', detail: 'Free asset live and connected to an email capture form.' },
  { key: 'email_sequence', label: 'Email sequence ready', detail: 'Welcome and sales emails loaded and scheduled.' },
  { key: 'content_scheduled', label: 'Organic content scheduled', detail: 'Launch-week posts drafted and scheduled across chosen platforms.' },
  { key: 'paid_prepared', label: 'Paid campaigns prepared', detail: 'Creatives built, audiences defined, budget caps set.' },
  { key: 'analytics', label: 'Analytics installed', detail: 'Traffic source, conversion and revenue tracking verified end to end.' },
  { key: 'launch_active', label: 'Launch campaign active', detail: 'Launch sequence running; daily numbers reviewed.' },
];

const LaunchZ = z.object({
  sequence: z.array(z.object({ day: z.string(), action: z.string(), detail: z.string() })).default([]),
  headline: z.string().default(''),
  key_risks: z.array(z.string()).default([]),
});

export async function generateLaunchPlan(ctx: EnginesCtx, projectId: ID) {
  const octx = await opportunityContext(projectId);
  const product = await db.products.where('project_id').equals(projectId).first();
  const data = await ai<any>(ctx, 'launch_plan', S.LAUNCH_PLAN_SCHEMA, [
    opportunityPromptBlock(octx, { includeScores: false }),
    `PRODUCT\n${JSON.stringify({ name: product?.name, promise: product?.promise, format: product?.product_type }, null, 2)}`,
    `TASK\nProduce the launch sequence for a solo seller with little or no audience, 1-2 hours per day, small or zero budget.`,
  ].join('\n\n'), 0.3, 3000);
  const parsed = LaunchZ.safeParse(data);
  if (!parsed.success) throw err('malformed_response', parsed.error.message);
  const existing = await db.launch.where('project_id').equals(projectId).first();
  const tasks = (existing?.tasks?.length ? existing.tasks : LAUNCH_TASKS.map((t) => ({ ...t, done: false })));
  const plan = { id: existing?.id ?? uid('launch'), project_id: projectId, tasks, sequence: parsed.data.sequence, headline: parsed.data.headline, key_risks: parsed.data.key_risks, updated_at: nowISO() };
  await db.launch.put(plan as any);
  return plan;
}

export async function setLaunchTask(projectId: ID, key: string, done: boolean) {
  const plan = await db.launch.where('project_id').equals(projectId).first();
  const tasks = (plan?.tasks?.length ? plan.tasks : LAUNCH_TASKS.map((t) => ({ ...t, done: false })))
    .map((t) => (t.key === key ? { ...t, done, updated_at: nowISO() } : t));
  await db.launch.put({ id: plan?.id ?? uid('launch'), project_id: projectId, tasks, sequence: plan?.sequence ?? [], updated_at: nowISO() } as any);
  return tasks;
}

/* ------------------------- 8. optimization loop ----------------------- */

export function computeMetrics(inputs: AnalyticsInputs) {
  const { visitors, leads, sales, revenue, ad_spend, refunds, repeat_purchases, price } = inputs;
  const safe = (n: number, d: number) => (d > 0 ? n / d : null);
  const conversion_rate = safe(sales, visitors);
  const lead_rate = safe(leads, visitors);
  const cost_per_lead = safe(ad_spend, leads);
  const cac = safe(ad_spend, sales);
  const aov = safe(revenue, sales);
  const gross = revenue - ad_spend;
  const roas = safe(revenue, ad_spend);
  const refund_rate = safe(refunds, sales);
  const repeat_rate = safe(repeat_purchases, sales);
  const revenue_per_visitor = safe(revenue, visitors);
  const breakeven_cac = price > 0 ? price : aov;
  return {
    conversion_rate: pct(conversion_rate),
    lead_rate: pct(lead_rate),
    cost_per_lead: money(cost_per_lead),
    cac: money(cac),
    aov: money(aov),
    roas: roas === null ? null : round(roas, 2),
    refund_rate: pct(refund_rate),
    repeat_rate: pct(repeat_rate),
    revenue_per_visitor: money(revenue_per_visitor),
    gross_profit: money(gross),
    breakeven_cac: money(breakeven_cac),
    cac_vs_breakeven: cac === null || !breakeven_cac ? null : round((cac / breakeven_cac) * 100, 1),
    sample_warning: sampleWarning(visitors, sales),
  };
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const pct = (v: number | null) => (v === null ? null : round(v * 100, 2));
const money = (v: number | null) => (v === null ? null : round(v, 2));

function sampleWarning(visitors: number, sales: number) {
  const issues: string[] = [];
  if (visitors < 100) issues.push(`Only ${visitors} visitors — conversion numbers are not yet statistically meaningful.`);
  if (sales < 10) issues.push(`Only ${sales} sales — treat any percentage as a wide range, not a fact.`);
  if (!issues.length) return null;
  return issues.join(' ');
}

const OptimizationZ = z.object({
  read_of_the_numbers: z.string().default(''),
  biggest_bottleneck: z.string().default('insufficient_data'),
  bottleneck_reasoning: z.string().default(''),
  next_action: z.string().default(''),
  prioritized_actions: z.array(z.object({ action: z.string(), expected_effect: z.string(), effort: z.string(), measure: z.string() })).default([]),
  scale_or_fix: z.string().default('fix_conversion'),
  scale_reasoning: z.string().default(''),
  experiments: z.array(z.object({ experiment: z.string(), hypothesis: z.string(), success_metric: z.string(), duration: z.string() })).default([]),
});

export async function analyzePerformance(ctx: EnginesCtx, projectId: ID, inputs: AnalyticsInputs, label: string) {
  const octx = await opportunityContext(projectId);
  const product = await db.products.where('project_id').equals(projectId).first();
  const pricing = await db.pricing.where('project_id').equals(projectId).first();
  const metrics = computeMetrics(inputs);
  const data = await ai<any>(ctx, 'performance_analysis', S.OPTIMIZATION_SCHEMA, [
    opportunityPromptBlock(octx, { includeScores: false }),
    `PRODUCT\n${JSON.stringify({ name: product?.name, promise: product?.promise }, null, 2)}`,
    `PRICE / OFFER\n${JSON.stringify({ currency: pricing?.currency, launch: pricing?.launch_price, standard: pricing?.standard_price, premium: pricing?.premium_price }, null, 2)}`,
    `ACTUAL PERFORMANCE DATA (${label || 'snapshot'})\n${JSON.stringify({ inputs, computed: metrics }, null, 2)}`,
    `TASK\nRead these numbers honestly. Identify the single biggest bottleneck, choose whether to fix/reposition/reprice/expand/scale, and specify the next highest-leverage action with a concrete target. Call out small-sample noise explicitly.`,
  ].join('\n\n'), 0.2, 3500);
  const parsed = OptimizationZ.safeParse(data);
  if (!parsed.success) throw err('malformed_response', parsed.error.message);
  const snapshot = { id: uid('ana'), project_id: projectId, label: label || nowISO().slice(0, 10), captured_at: nowISO(), inputs, metrics, analysis: parsed.data };
  await db.analytics.put(snapshot as any);
  return snapshot;
}

/* ------------------------- 9. project lifecycle ----------------------- */

export async function createProjectFromOpportunity(nicheId: ID, problemId: ID) {
  const [niche, problem] = await Promise.all([db.niches.get(nicheId), db.problems.get(problemId)]);
  if (!niche || !problem) throw err('unknown', 'Niche or problem not found.');
  const existing = await db.projects.where('problem_id').equals(problemId).first();
  if (existing) return existing;
  const project: Project = {
    id: uid('prj'),
    run_id: niche.research_run_id,
    niche_id: nicheId,
    problem_id: problemId,
    name: niche.specific_niche,
    status: 'idea',
    currency: 'USD',
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  await db.projects.put(project);
  return project;
}

export async function exportProjectJSON(projectId: ID) {
  const octx = await opportunityContext(projectId);
  const [product, pricing, marketing, campaigns, launch, analytics] = await Promise.all([
    db.products.where('project_id').equals(projectId).first(),
    db.pricing.where('project_id').equals(projectId).first(),
    db.marketing.where('project_id').equals(projectId).toArray(),
    db.campaigns.where('project_id').equals(projectId).toArray(),
    db.launch.where('project_id').equals(projectId).first(),
    db.analytics.where('project_id').equals(projectId).toArray(),
  ]);
  return {
    exported_at: nowISO(),
    project: octx.project,
    audience: octx.audience,
    niche: octx.niche,
    problem: octx.problem,
    validation: octx.validation,
    score: octx.score,
    evidence: octx.evidence.filter((e) => octx.problem.evidence_ids.includes(e.id) || octx.validation?.validation_evidence_ids?.includes(e.id)),
    product,
    pricing,
    marketing,
    campaigns,
    launch,
    analytics,
  };
}
