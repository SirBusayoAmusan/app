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
  'Every score can be traced back to the pages behind it, line by line.',
  'Opportunity attractiveness and evidence confidence are always separate numbers.',
  'When there is not enough proof, the app says so plainly instead of guessing.',
  'If the audience is too broad for meaningful intelligence, the system asks for clarification.',
  'It keeps pushing toward narrower, more specific opportunities — being specific is the whole advantage.',
];

export default function Learn() {
  return (
    <Page
      wide
      title="How CreatorTools thinks"
      sub="How this differs from an “AI idea generator”: we read real pages first, the AI explains them second, and the numbers are worked out by the app."
      badge={<Tag tone="lilac"><BookOpen size={11} /> Plain English</Tag>}
      actions={<Button onClick={() => navigate('/discover')}>Start a run <ArrowRight size={14} /></Button>}
    >
      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-5 items-start">
        <div className="space-y-5">
          <Card className="pad">
            <SectionTitle title="Why this is not a well-written guess" sub="Three parts, each doing one job." icon={<Layers size={17} />} />
            <div className="space-y-3">
              {[
                ['1', 'Real sources', 'Live public posts and pages — Hacker News, Stack Overflow, GitHub and DEV — plus a Google results key if you add one. Every fact keeps the link and the date it was published.', 'bg-lilac-100 text-lilac-600'],
                ['2', 'Your AI model (yours)', 'Reads evidence blocks in batches, extracts signals, proposes niches, mines problems and tries to disprove them. Every claim must cite an evidence id or it is discarded.', 'bg-ink text-white'],
                ['3', 'The part that does the maths', 'Removes repeats, decides how much each source should count, groups similar problems together and works out the score. The AI never writes the final number.', 'bg-moss-100 text-moss-600'],
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
              your audience → what to look for → reading real pages → removing repeats → what people say → groups of people
              → the problems they have → trying to prove it wrong → scoring → your report
            </div>
          </Card>

          <Card className="pad">
            <SectionTitle title="Nine angles, always covered" sub="Every topic gets searched from fifteen different angles. The AI can add more searches — it can never skip one." icon={<Target size={17} />} />
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
            <SectionTitle title="The score is maths, not opinion" sub="Ten things are scored, each with a fixed importance. The AI gives its reasons and links for each; the app does the multiplying." icon={<Braces size={17} />} />
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
                <div className="micro mb-2">Thin proof lowers the score</div>
                <p className="text-[13px] text-ink-soft leading-relaxed">
                  A high score built on thin evidence gets pulled down automatically. Sources that disagree with each other pull it down further, every time.
                </p>
              </div>
              <div className="rounded-xl2 border border-line-soft p-4">
                <div className="micro mb-2">The same story only counts once</div>
                <p className="text-[13px] text-ink-soft leading-relaxed">
                  Ten articles repeating one press release count as roughly one voice, not ten. Recent, original and specific sources count for more.
                </p>
              </div>
            </div>
          </Card>

          <Card className="pad">
            <SectionTitle title="How we stop the AI making things up" sub="These are enforced by the app itself, not merely asked for politely." icon={<ShieldCheck size={17} />} />
            <ul className="space-y-2">
              {[
                'Every statement about the market must point at a real page we actually read.',
                'If we cannot match a statement to a source, we delete it and tell you how many we removed.',
                'The AI is never allowed to write the final score or change how confident we are.',
                'A problem cannot be shown as validated if there is not enough proof behind it.',
                'No source, no claim. Nothing recent, no trend.',
                'Sources that disagree with each other are kept and shown, never quietly dropped.',
                'Answers that come back in the wrong shape are rejected and asked for again.',
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
            <SectionTitle title="See exactly what we ask the AI" sub="Nothing is hidden. Read the wording sent for each step." icon={<BookOpen size={17} />} />
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
              {['An AI idea generator', 'A ChatGPT wrapper', 'A PDF generator', 'A random niche list', 'Trend guesses invented by AI'].map((n) => (
                <div key={n} className="rounded-xl2 border border-line-soft px-3.5 py-2.5 text-ink-mute line-through decoration-ink-faint/50">{n}</div>
              ))}
            </div>
            <div className="mt-4 space-y-2.5 text-[13px]">
              {['Opportunities backed by real, current sources', 'Problems checked by trying to disprove them', 'Scores you can trace line by line', 'Product, pricing, marketing and ads, done for you', 'A loop that improves as real numbers come in'].map((y) => (
                <div key={y} className="rounded-xl2 border border-moss-500/25 bg-moss-50/60 px-3.5 py-2.5 text-ink-soft">{y}</div>
              ))}
            </div>
          </Card>

          <Card className="pad">
            <SectionTitle title="What happens to your data" icon={<Lock size={16} />} />
            <ul className="space-y-2 text-[12.5px] text-ink-mute leading-relaxed">
              <li>• No account, no sign-up, and nothing about you is tracked or sent anywhere.</li>
              <li>• Your research, products and numbers stay saved in this browser.</li>
              <li>• Your key is held for the current session only and is never saved.</li>
              <li>• Only the AI service you chose sees your requests. Nobody else does.</li>
            </ul>
          </Card>

          <Card className="pad">
            <SectionTitle title="Where to look next" icon={<TrendingUp size={16} />} />
            <div className="space-y-2">
              <Button variant="quiet" className="w-full justify-start" onClick={() => navigate('/discover')}><Database size={14} /> Run discovery</Button>
              <Button variant="quiet" className="w-full justify-start" onClick={() => navigate('/trends')}><TrendingUp size={14} /> Inspect the evidence</Button>
              <Button variant="quiet" className="w-full justify-start" onClick={() => navigate('/settings')}><HelpCircle size={14} /> Adjust how strict it is</Button>
            </div>
          </Card>

          <Card className="pad">
            <h3 className="h3 mb-3">Words we use</h3>
            <KeyValue
              cols={1}
              rows={[
                { label: 'Niche', value: 'Audience + specific problem + desired outcome + context — never a broad category.' },
                { label: 'Opportunity score', value: 'How good the opportunity looks out of 100, adjusted for how well the sources back it up.' },
                { label: 'How well supported', value: 'Shown separately from the score: how many separate, recent, on-topic sources agree.' },
                { label: 'Proof threshold', value: 'The minimum number of sources, sites and recency before we will call anything validated.' },
                { label: 'Counted once', value: 'When the same story appears on many sites it still only counts as one voice.' },
              ]}
            />
          </Card>
        </div>
      </div>
    </Page>
  );
}
