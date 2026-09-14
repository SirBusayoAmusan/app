import { ArrowRight, BookOpen, Braces, Database, Github, HelpCircle, Layers, Lock, ShieldCheck, Sparkles, Target, TrendingUp } from 'lucide-react';
import { Page, navigate } from '../components/shell';
import { Button, Callout, Card, KeyValue, SectionTitle, Tag } from '../components/ui';
import { COMPONENT_LABELS, COMPONENT_ORDER, WEIGHTS } from '../core/intelligence/scoringEngine';
import { QUERY_LAYERS } from '../core/intelligence/queryEngine';
import { PROMPT_CATALOGUE } from '../core/prompts';

const RULES = [
  'The app never makes a “trending” claim without current, dated evidence.',
  'A broad category is never presented as a niche. A niche is audience + problem + outcome + context.',
  'Painful problems outrank interesting topics, always.',
  'Problems with a clear desired outcome rank above vague frustrations.',
  'The system looks for where people already try to solve the problem — those are the buyers.',
  'It looks for the gap between what people want and what existing solutions deliver.',
  'The recommendation is always the smallest viable product that solves the validated problem.',
  'Every score has an explainable methodology and visible arithmetic.',
  'Opportunity attractiveness and evidence confidence are always separate numbers.',
  'When evidence is insufficient, the app says “insufficient evidence” instead of guessing.',
  'If the audience is too broad for meaningful intelligence, the system asks for clarification.',
  'The engine keeps hunting for narrower, more specific opportunities — specificity is the advantage.',
];

export default function Learn() {
  return (
    <Page
      wide
      title="How CreatorTools thinks"
      sub="The difference between this and an “AI idea generator” is architectural: evidence is collected first, the model interprets it second, and this app owns the arithmetic."
      badge={<Tag tone="lilac"><BookOpen size={11} /> Methodology</Tag>}
      actions={<Button onClick={() => navigate('/discover')}>Start a run <ArrowRight size={14} /></Button>}
    >
      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-5 items-start">
        <div className="space-y-5">
          <Card className="pad">
            <SectionTitle title="The three-layer architecture" sub="Why the output is not a beautifully written guess." icon={<Layers size={17} />} />
            <div className="space-y-3">
              {[
                ['1', 'Search & trend APIs (yours)', 'Tavily, Serper or Exa fetch current, dateable evidence with URLs, titles and publication dates. This is the only source of market facts.', 'bg-lilac-100 text-lilac-600'],
                ['2', 'Your AI model (yours)', 'Reads evidence blocks in batches, extracts signals, proposes niches, mines problems and tries to disprove them. Every claim must cite an evidence id or it is discarded.', 'bg-ink text-white'],
                ['3', 'The intelligence engine (bundled)', 'Deduplicates, collapses syndicated copies into clusters, weights sources, applies evidence gates, and computes the opportunity score deterministically.', 'bg-moss-100 text-moss-600'],
              ].map(([n, title, body, tone]) => (
                <div key={n} className="flex gap-3.5">
                  <span className={`h-7 w-7 rounded-full flex items-center justify-center text-[12px] font-semibold shrink-0 ${tone}`}>{n}</span>
                  <div>
                    <div className="text-[14px] font-semibold text-ink">{title}</div>
                    <p className="text-[13px] text-ink-mute mt-1 leading-relaxed">{body}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-xl2 bg-canvas border border-line-soft p-4 font-mono text-[11.5px] text-ink-mute leading-relaxed overflow-x-auto">
              audience → hypotheses → layered queries → live search → normalise &amp; weight → evidence-bound signals → niche candidates
              → dedupe clusters → problem mining → adversarial validation → deterministic scoring → opportunity report
            </div>
          </Card>

          <Card className="pad">
            <SectionTitle title="Nine research layers, always covered" sub="Fifteen query templates per topic hypothesis, spread across every layer. The model may add queries — never remove coverage." icon={<Target size={17} />} />
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
              {QUERY_LAYERS.map((l) => (
                <div key={l.layer} className="flex gap-3">
                  <span className="text-[11px] tnum text-ink-faint mt-0.5">{String(l.layer).padStart(2, '0')}</span>
                  <div>
                    <div className="text-[13.5px] font-medium text-ink">{l.name.replace(/_/g, ' ')}</div>
                    <div className="text-[12.5px] text-ink-mute">{l.purpose}</div>
                  </div>
                </div>
              ))}
            </div>
            <Callout tone="lilac" title="Query shapes used">
              <span className="font-mono text-[11.5px]">
                “{'{audience}'} struggling with {'{problem}'}” · “{'{problem}'} alternatives” · “{'{problem}'} complaints” ·
                “{'{problem}'} not working” · “{'{desired outcome}'} course|template|service” · “{'{problem}'} reddit|forum|2026”
              </span>
            </Callout>
          </Card>

          <Card className="pad">
            <SectionTitle title="The score is arithmetic, not opinion" sub="Ten components, fixed weights, two penalties. The model supplies component assessments with reasons and citations; this app multiplies." icon={<Braces size={17} />} />
            <div className="space-y-2.5">
              {COMPONENT_ORDER.map((k) => (
                <div key={k} className="flex items-center gap-3">
                  <span className="text-[13px] text-ink-soft flex-1">{COMPONENT_LABELS[k]}</span>
                  <span className="w-28 h-1.5 rounded-full bg-line-soft overflow-hidden">
                    <span className="block h-full bg-ink rounded-full" style={{ width: `${WEIGHTS[k] * 500}%` }} />
                  </span>
                  <span className="text-[12.5px] tnum w-10 text-right text-ink">{(WEIGHTS[k] * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
            <div className="mt-5 grid sm:grid-cols-2 gap-4">
              <div className="rounded-xl2 border border-line-soft p-4">
                <div className="micro mb-2">Confidence adjustment</div>
                <code className="text-[12px] text-ink-soft">final = base × (0.60 + confidence/100 × 0.40) × (1 − contradiction_rate × 0.20)</code>
                <p className="text-[12.5px] text-ink-mute mt-2">
                  Weak evidence can never produce an apparently certain high score, and contradicting sources always reduce the number.
                </p>
              </div>
              <div className="rounded-xl2 border border-line-soft p-4">
                <div className="micro mb-2">Evidence weighting</div>
                <code className="text-[12px] text-ink-soft">weight = reliability × freshness × relevance × directness × independence</code>
                <p className="text-[12.5px] text-ink-mute mt-2">
                  Ten articles repeating one press release count as roughly one independent signal, not ten.
                </p>
              </div>
            </div>
          </Card>

          <Card className="pad">
            <SectionTitle title="Anti-hallucination controls" sub="Hard rules enforced in code, not just requested in a prompt." icon={<ShieldCheck size={17} />} />
            <ul className="space-y-2">
              {[
                'Every factual market claim must map to a retrieved evidence id.',
                'Unknown evidence ids are stripped; claims left with none are discarded and counted.',
                'The model cannot write the final score or alter confidence — the backend owns all arithmetic.',
                'A problem cannot be presented as validated if the evidence gate fails.',
                'No source, no claim. No recent evidence, no trend claim.',
                'Contradicting evidence is preserved and displayed, never hidden.',
                'Responses are schema-validated before rendering; malformed output is rejected and retried.',
              ].map((r) => (
                <li key={r} className="flex gap-2.5 text-[13.5px] text-ink-soft">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-moss-500 shrink-0" /> {r}
                </li>
              ))}
            </ul>
          </Card>

          <Card className="pad">
            <SectionTitle title="Twelve rules the product obeys" icon={<Sparkles size={17} />} />
            <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5">
              {RULES.map((r, i) => (
                <li key={r} className="flex gap-2.5 text-[13px] text-ink-soft">
                  <span className="text-[11px] tnum text-ink-faint mt-0.5">{String(i + 1).padStart(2, '0')}</span> {r}
                </li>
              ))}
            </ol>
          </Card>

          <Card className="pad">
            <SectionTitle title="Every prompt is inspectable" sub={`Prompt set ${PROMPT_CATALOGUE[0]?.version}. Read exactly what is sent.`} icon={<BookOpen size={17} />} />
            <div className="space-y-2">
              {PROMPT_CATALOGUE.map((p) => (
                <div key={p.key} className="flex items-start justify-between gap-4 rounded-xl2 border border-line-soft px-3.5 py-3">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-medium text-ink">{p.title}</div>
                    <div className="text-[12.5px] text-ink-mute">{p.applies}</div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => navigate('/settings')}>View</Button>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="pad">
            <h3 className="h3 mb-3">What this is not</h3>
            <div className="space-y-2.5 text-[13px]">
              {['An AI idea generator', 'A ChatGPT wrapper', 'A PDF generator', 'A random niche list', 'AI-generated trend guesses'].map((n) => (
                <div key={n} className="rounded-xl2 border border-line-soft px-3.5 py-2.5 text-ink-mute line-through decoration-ink-faint/50">{n}</div>
              ))}
            </div>
            <div className="mt-4 space-y-2.5 text-[13px]">
              {['Evidence-backed opportunity intelligence', 'Problem mining with adversarial validation', 'Transparent, auditable scoring', 'Product, pricing, marketing and ad execution', 'An optimization loop fed by real numbers'].map((y) => (
                <div key={y} className="rounded-xl2 border border-moss-500/25 bg-moss-50/60 px-3.5 py-2.5 text-ink-soft">{y}</div>
              ))}
            </div>
          </Card>

          <Card className="pad">
            <SectionTitle title="Your privacy model" icon={<Lock size={16} />} />
            <ul className="space-y-2 text-[12.5px] text-ink-mute leading-relaxed">
              <li>• No backend, no account, no telemetry. The app is static files.</li>
              <li>• Research, products and analytics live in this browser's IndexedDB.</li>
              <li>• API keys exist in memory for one session and are never persisted.</li>
              <li>• The provider you choose receives your prompts and evidence blocks — nothing else does.</li>
            </ul>
          </Card>

          <Card className="pad">
            <SectionTitle title="Where to look next" icon={<TrendingUp size={16} />} />
            <div className="space-y-2">
              <Button variant="quiet" className="w-full justify-start" onClick={() => navigate('/discover')}><Database size={14} /> Run discovery</Button>
              <Button variant="quiet" className="w-full justify-start" onClick={() => navigate('/trends')}><TrendingUp size={14} /> Inspect the evidence</Button>
              <Button variant="quiet" className="w-full justify-start" onClick={() => navigate('/settings')}><HelpCircle size={14} /> Tune thresholds &amp; prompts</Button>
            </div>
          </Card>

          <Card className="pad">
            <h3 className="h3 mb-3">Vocabulary</h3>
            <KeyValue
              cols={1}
              rows={[
                { label: 'Niche', value: 'Audience + specific problem + desired outcome + context — never a broad category.' },
                { label: 'Opportunity score', value: 'Weighted attractiveness (0-100) after confidence and contradiction adjustments.' },
                { label: 'Evidence confidence', value: 'How strong the sources are — reliability, diversity, recency, directness, agreement.' },
                { label: 'Evidence gate', value: 'Minimum sources, domains and recency for an opportunity to be presented as validated.' },
                { label: 'Independent cluster', value: 'A group of syndicated copies counted as a single signal.' },
              ]}
            />
          </Card>
        </div>
      </div>
    </Page>
  );
}
