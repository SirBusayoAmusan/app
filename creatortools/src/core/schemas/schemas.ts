/* ------------------------------------------------------------------
   Strict JSON schemas handed to the model as `response_format`.
   Kept intentionally flat and OpenAI-structured-output-friendly
   (additionalProperties: false, everything in `required`).
   ------------------------------------------------------------------ */

const str = (description?: string) => (description ? { type: 'string', description } : { type: 'string' });
const num = (description?: string) => (description ? { type: 'number', description } : { type: 'number' });
const arr = (items: any, description?: string) => (description ? { type: 'array', items, description } : { type: 'array', items });
const obj = (properties: Record<string, any>, required: string[], description?: string) => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
  ...(description ? { description } : {}),
});

export const HYPOTHESIS_SCHEMA = obj(
  {
    market_summary: str('One neutral sentence describing the market space being researched. No claims about demand.'),
    audience_descriptors: arr(str(), 'Search phrasing variants for the audience (3-6).'),
    topics: arr(
      obj(
        {
          topic: str('A problem area phrased as something the audience experiences or wants. No statistics, no popularity claims.'),
          why_researchable: str('Why this is worth searching for evidence.'),
          context: str('The specific situation or constraint for this audience.'),
        },
        ['topic', 'why_researchable', 'context'],
      ),
      '8-16 candidate problem areas to research. Specific, not broad categories.',
    ),
  },
  ['market_summary', 'audience_descriptors', 'topics'],
);

export const SIGNALS_SCHEMA = obj(
  {
    signals: arr(
      obj(
        {
          signal_id: str('Short stable id like sig_001'),
          signal_type: {
            type: 'string',
            enum: ['problem', 'desire', 'pain', 'urgency', 'purchase_intent', 'trend', 'growth', 'complaint', 'solution_failure', 'market_gap', 'competitor', 'content_demand', 'emotional_intensity', 'question'],
          },
          statement: str('A single factual statement supported by the cited evidence. No invented numbers.'),
          evidence_ids: arr(str(), 'IDs copied verbatim from the supplied evidence blocks.'),
          strength: num('How strongly the supplied evidence supports this statement, 0-100.'),
          confidence: num('How certain you are given the evidence quality, 0-100.'),
          direct_or_inferred: { type: 'string', enum: ['direct', 'inferred'] },
          customer_language: arr(str(), 'Verbatim or near-verbatim phrases from the evidence that show how people describe this.'),
        },
        ['signal_id', 'signal_type', 'statement', 'evidence_ids', 'strength', 'confidence', 'direct_or_inferred', 'customer_language'],
      ),
      'Only signals supported by the supplied evidence. Return an empty array when evidence is insufficient.',
    ),
  },
  ['signals'],
);

export const NICHES_SCHEMA = obj(
  {
    niches: arr(
      obj(
        {
          niche_id: str('Short stable id like nch_001'),
          broad_category: str('The broad category this sits inside (for navigation only).'),
          specific_niche: str('Audience + situation + problem, specific enough to name 10 real people who fit it.'),
          audience: str('Who exactly — role, situation, stage. Not a demographic alone.'),
          problem: str('The recurring problem in plain language.'),
          desired_outcome: str('The measurable outcome they want.'),
          context: str('Constraints and circumstances that shape the problem.'),
          why_specific: str('Why this is a niche and not a category.'),
          product_formats: arr(str(), 'Plausible digital product formats for this problem (2-5).'),
          evidence_ids: arr(str(), 'Evidence IDs from the supplied set supporting this niche (minimum 3).'),
        },
        ['niche_id', 'broad_category', 'specific_niche', 'audience', 'problem', 'desired_outcome', 'context', 'why_specific', 'product_formats', 'evidence_ids'],
      ),
      '10-24 narrowly defined niches. Return fewer (or none) rather than pad with generic categories.',
    ),
  },
  ['niches'],
);

export const CLUSTER_SCHEMA = obj(
  {
    clusters: arr(
      obj(
        {
          cluster_id: str(),
          canonical_niche_id: str('The niche_id to keep as the representative of this cluster.'),
          merged_niche_ids: arr(str(), 'All niche_ids in the cluster, including the canonical one.'),
          reason: str('Why these are the same underlying opportunity.'),
        },
        ['cluster_id', 'canonical_niche_id', 'merged_niche_ids', 'reason'],
      ),
    ),
    distinct_count: num('How many genuinely distinct opportunities remain after clustering.'),
  },
  ['clusters', 'distinct_count'],
);

export const PROBLEMS_SCHEMA = obj(
  {
    problems: arr(
      obj(
        {
          problem_id: str('Short stable id like prb_001'),
          problem_statement: str('The problem as the customer would say it.'),
          underlying_problem: str('The deeper cause behind the surface symptom.'),
          rank: num('1 = most commercially significant given the evidence.'),
          customer_language: arr(str(), 'Quotes/phrases from the evidence.'),
          who_experiences_it: str('Who experiences this, as specifically as the evidence allows.'),
          why_it_hurts: str('Emotional, financial and time cost described using only the evidence.'),
          current_workarounds: arr(str(), 'What they currently do about it, per the evidence.'),
          why_existing_solutions_fail: str('Where current solutions fall short, per the evidence.'),
          what_people_search: arr(str(), 'Search phrasings visible in the evidence.'),
          conversation_signals: arr(str(), 'Where this is being discussed right now (community, platform, type of thread).'),
          potential_product_solutions: arr(str(), '2-4 candidate digital products, smallest viable first.'),
          recommended_product: str('The single smallest product that solves this well.'),
          evidence_ids: arr(str(), 'Evidence IDs supporting this problem.'),
        },
        ['problem_id', 'problem_statement', 'underlying_problem', 'rank', 'customer_language', 'who_experiences_it', 'why_it_hurts', 'current_workarounds', 'why_existing_solutions_fail', 'what_people_search', 'conversation_signals', 'potential_product_solutions', 'recommended_product', 'evidence_ids'],
      ),
      'Problems that the supplied evidence actually shows. Fewer strong problems beat many weak ones.',
    ),
  },
  ['problems'],
);

export const VALIDATION_SCHEMA = obj(
  {
    supporting_evidence_ids: arr(str(), 'Evidence IDs that support the demand claim.'),
    contradicting_evidence_ids: arr(str(), 'Evidence IDs that weaken or contradict it. Use real IDs only.'),
    validation_status: { type: 'string', enum: ['validated', 'promising', 'mixed', 'weak', 'insufficient_evidence'] },
    confidence: num('0-100, evidence quality only — never the attractiveness of the opportunity.'),
    demand_vs_saturation: str('Honest read of how crowded this space is based on the evidence.'),
    monetization_signals: str('What the evidence shows about willingness to pay. Say so plainly if nothing shows it.'),
    reasoning_summary: str('Why this status was chosen, in 2-4 sentences.'),
    disproof_notes: arr(str(), 'The strongest arguments against this opportunity, even if you still consider it valid.'),
  },
  ['supporting_evidence_ids', 'contradicting_evidence_ids', 'validation_status', 'confidence', 'demand_vs_saturation', 'monetization_signals', 'reasoning_summary', 'disproof_notes'],
);

export const SCORE_COMPONENTS_SCHEMA = obj(
  {
    components: obj(
      {
        current_demand: scoreComponentSchema('Active, current expression of this need in the evidence.'),
        trend_momentum: scoreComponentSchema('Direction of travel in the last 30-90 days. Use 20 or lower when there is no dated recent evidence.'),
        pain_severity: scoreComponentSchema('How painful the problem is per the evidence.'),
        willingness_to_pay: scoreComponentSchema('Evidence of spending money to solve this. Use a low score when no purchase signals exist.'),
        problem_frequency: scoreComponentSchema('How often the problem recurs for the audience.'),
        market_gap: scoreComponentSchema('Distance between what people want and what existing solutions deliver.'),
        emotional_intensity: scoreComponentSchema('Emotional charge in the language used.'),
        product_feasibility: scoreComponentSchema('How easily a small digital product could solve this.'),
        viral_content_potential: scoreComponentSchema('How naturally this topic travels on social platforms.'),
        competition_opportunity: scoreComponentSchema('High when competition is present but weak/beatable, low when strong or absent because the market is empty.'),
      },
      ['current_demand', 'trend_momentum', 'pain_severity', 'willingness_to_pay', 'problem_frequency', 'market_gap', 'emotional_intensity', 'product_feasibility', 'viral_content_potential', 'competition_opportunity'],
    ),
  },
  ['components'],
);

function scoreComponentSchema(description: string) {
  return obj(
    {
      score: num('0-100. Evidence-driven. Score low when evidence is thin, not when the topic is merely unexciting.'),
      reason: str('One or two sentences citing what in the evidence drove this number.'),
      evidence_ids: arr(str(), 'Evidence IDs that justify this score.'),
      assessment: { type: 'string', enum: ['direct', 'inferred', 'insufficient'] },
    },
    ['score', 'reason', 'evidence_ids', 'assessment'],
    description,
  );
}

export const REPORT_SCHEMA = obj(
  {
    opportunity_summary: str('What the opportunity is, in plain language, naming audience + problem + outcome.'),
    why_now: str('What the dated evidence shows about timing. If nothing is recent, say that no current signal exists.'),
    customer_problem: str('The problem in the customer\u2019s own words, using their phrases.'),
    commercial_reason: str('Why this is commercially plausible, grounded in the evidence and the computed scores.'),
    risks: arr(str(), '3-6 concrete ways this could fail: saturation, weak monetization, timing, undifferentiated, evidence gaps.'),
    recommended_action: str('The single next action a beginner should take this week.'),
    positioning_angle: str('The sharpest angle to sell into this problem.'),
    first_content_ideas: arr(str(), '5-8 content ideas that would test interest before building.'),
  },
  ['opportunity_summary', 'why_now', 'customer_problem', 'commercial_reason', 'risks', 'recommended_action', 'positioning_angle', 'first_content_ideas'],
);

export const PRODUCT_SCHEMA = obj(
  {
    recommended_format: str('Smallest viable format: pdf guide, ebook, checklist, template pack, spreadsheet, calculator, mini-course, toolkit, prompt pack, swipe file, community, coaching, software-assisted.'),
    format_reasoning: str('Why this format and explicitly why a bigger product is unnecessary.'),
    product_promise: str('One sentence: after using this, the buyer can [outcome].'),
    product_name_options: arr(str(), '5-8 specific, benefit-led names (no colon-stuffed jargon).'),
    transformation: obj({ from: str(), to: str() }, ['from', 'to']),
    contents: arr(obj({ title: str(), purpose: str() }, ['title', 'purpose']), '6-12 sections of the product.'),
    worksheets: arr(obj({ title: str(), purpose: str() }, ['title', 'purpose']), '1-4 practical worksheets.'),
    checklists: arr(obj({ title: str(), items: arr(str()) }, ['title', 'items']), '1-3 checklists with concrete items.'),
    bonuses: arr(str(), '0-4 low-effort bonuses that raise perceived value.'),
    positioning: str('How the product is positioned in the market, one paragraph.'),
    sales_page: obj(
      {
        headline: str(),
        subheadline: str(),
        bullets: arr(str(), '5-8 outcome bullets.'),
        offer_stack: arr(str(), 'Everything included, itemized with a value line each.'),
        guarantee: str(),
        faq: arr(obj({ q: str(), a: str() }, ['q', 'a']), '4-6 objections handled.'),
        cta: str(),
      },
      ['headline', 'subheadline', 'bullets', 'offer_stack', 'guarantee', 'faq', 'cta'],
    ),
  },
  ['recommended_format', 'format_reasoning', 'product_promise', 'product_name_options', 'transformation', 'contents', 'worksheets', 'checklists', 'bonuses', 'positioning', 'sales_page'],
);

export const GUIDED_CHAPTER_SCHEMA = obj(
  {
    title: str(),
    body_markdown: str('Full chapter in markdown: headings, short paragraphs, numbered steps, examples, one action step at the end. 700-1100 words. No fluff, no repeated disclaimers.'),
    key_takeaways: arr(str(), '3-5 takeaways.'),
    worksheet: obj({ title: str(), prompt: str(), rows: arr(str(), 'Fill-in prompts the reader completes.') }, ['title', 'prompt', 'rows']),
  },
  ['title', 'body_markdown', 'key_takeaways', 'worksheet'],
);

export const PRICING_SCHEMA = obj(
  {
    currency: str('ISO currency code, e.g. USD'),
    recommended_price: num(),
    launch_price: num(),
    standard_price: num(),
    premium_price: num('0 when no premium tier is appropriate.'),
    premium_bundle: arr(str(), 'What goes in the premium tier.'),
    value_justification: str('The value math that justifies price, using evidence where available and clearly-labelled assumptions otherwise.'),
    pricing_reasoning: str('Why this range for this audience and problem.'),
    objections: arr(obj({ objection: str(), response: str() }, ['objection', 'response']), '5-8 price objections with responses.'),
    offer_stack: arr(str(), 'Itemized stack with value lines.'),
    discount_strategy: str(),
    price_testing_plan: arr(str(), '3-5 concrete price tests.'),
    payment_notes: str('Checkout/payment realities for this audience and region.'),
  },
  ['currency', 'recommended_price', 'launch_price', 'standard_price', 'premium_price', 'premium_bundle', 'value_justification', 'pricing_reasoning', 'objections', 'offer_stack', 'discount_strategy', 'price_testing_plan', 'payment_notes'],
);

export const MARKETING_SCHEMA = obj(
  {
    module_key: str(),
    headline: str(),
    summary: str('Two sentences a beginner can act on immediately.'),
    blocks: arr(
      obj({ title: str(), detail: str(), items: arr(str()) }, ['title', 'detail', 'items']),
      '3-6 blocks. The shape of the blocks depends on the module (e.g. pillars, funnel steps, email send plan).',
    ),
    assets: arr(obj({ label: str(), content: str() }, ['label', 'content']), 'Copy-paste-ready assets: hooks, subject lines, captions, scripts, page copy.'),
    next_actions: arr(str(), '2-4 actions to do within 24 hours.'),
  },
  ['module_key', 'headline', 'summary', 'blocks', 'assets', 'next_actions'],
);

export const ADS_SCHEMA = obj(
  {
    platform: str(),
    strategy_summary: str(),
    concepts: arr(
      obj(
        {
          concept_id: str(),
          audience: str('Who is targeted, with the specific problem they have.'),
          pain_angle: str(),
          hook: str('First 3 seconds / first line.'),
          creative_concept: str('What the creative literally shows, shot by shot or frame by frame.'),
          primary_text: str('Full ad primary text.'),
          headline: str(),
          description: str(),
          cta: str(),
          landing_page_angle: str('What the landing page must repeat to match intent.'),
          testing_hypothesis: str('What this test proves or disproves.'),
        },
        ['concept_id', 'audience', 'pain_angle', 'hook', 'creative_concept', 'primary_text', 'headline', 'description', 'cta', 'landing_page_angle', 'testing_hypothesis'],
      ),
      '6-10 varied concepts.',
    ),
    testing_matrix: arr(obj({ variable: str(), variant_a: str(), variant_b: str(), success_metric: str() }, ['variable', 'variant_a', 'variant_b', 'success_metric']), '4-8 tests.'),
    budget_scenarios: arr(obj({ level: str(), daily_budget: str(), objective: str(), expectation: str() }, ['level', 'daily_budget', 'objective', 'expectation']), '3 scenarios (test, validate, scale).'),
    retargeting: str('Retargeting logic: who, when, which message.'),
    compliance_notes: arr(str(), 'Platform-specific cautions (claims, targeting limits, disclosure).'),
  },
  ['platform', 'strategy_summary', 'concepts', 'testing_matrix', 'budget_scenarios', 'retargeting', 'compliance_notes'],
);

export const OPTIMIZATION_SCHEMA = obj(
  {
    read_of_the_numbers: str('What the supplied metrics actually show. Be blunt about weak signals and small samples.'),
    biggest_bottleneck: { type: 'string', enum: ['traffic', 'offer', 'message_match', 'price', 'trust', 'conversion_flow', 'product_fit', 'retention', 'insufficient_data'] },
    bottleneck_reasoning: str(),
    next_action: str('The single highest-leverage action, with a concrete target.'),
    prioritized_actions: arr(obj({ action: str(), expected_effect: str(), effort: str(), measure: str() }, ['action', 'expected_effect', 'effort', 'measure']), '3-6 ranked actions.'),
    scale_or_fix: { type: 'string', enum: ['fix_conversion', 'improve_product', 'reposition', 'reprice', 'expand_audience', 'scale_spend', 'pause'] },
    scale_reasoning: str(),
    experiments: arr(obj({ experiment: str(), hypothesis: str(), success_metric: str(), duration: str() }, ['experiment', 'hypothesis', 'success_metric', 'duration']), '3-5 experiments.'),
  },
  ['read_of_the_numbers', 'biggest_bottleneck', 'bottleneck_reasoning', 'next_action', 'prioritized_actions', 'scale_or_fix', 'scale_reasoning', 'experiments'],
);

export const LAUNCH_PLAN_SCHEMA = obj(
  {
    sequence: arr(
      obj({ day: str(), action: str(), detail: str() }, ['day', 'action', 'detail']),
      '10-14 day launch sequence, one row per day.',
    ),
    headline: str(),
    key_risks: arr(str(), '3-4 launch risks and mitigations.'),
  },
  ['sequence', 'headline', 'key_risks'],
);

export const SALES_PAGE_SCHEMA = obj(
  {
    hero_headline: str(),
    hero_subheadline: str(),
    problem_section: str('Markdown. Agitate the validated problem using customer language.'),
    solution_section: str('Markdown. Introduce the product as the path.'),
    whats_inside: arr(str(), 'Section-by-section inclusions.'),
    proof_section: str('Markdown. Honest proof options for a first-time seller.'),
    offer_section: str('Markdown. Stack, price, guarantee.'),
    faq: arr(obj({ q: str(), a: str() }, ['q', 'a']), '6-8 questions.'),
    final_cta: str(),
  },
  ['hero_headline', 'hero_subheadline', 'problem_section', 'solution_section', 'whats_inside', 'proof_section', 'offer_section', 'faq', 'final_cta'],
);

export const SALES_PAGE_SCHEMA_NAME = 'sales_page';
