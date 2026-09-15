/* ------------------------------------------------------------------
   Flow navigation.

   The app is a sequence, not a set of tabs: find an audience, gather
   evidence, pick a problem, build the thing, sell it. Anyone landing on
   step 6 cold has no way to know what came before or what is next, so
   every step in the sequence carries an explicit Back and Next.

   The order below is the only source of truth for that sequence.
   ------------------------------------------------------------------ */
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Mascot, type MascotMood } from './Mascot';
import { navigate, useRoute } from './shell';
import { Button, cx } from './ui';

export interface FlowStep {
  path: string;
  /** Short name shown in "Step 3 of 9" and as the button label. */
  label: string;
  /** One line telling the user what this step is for. */
  hint: string;
}

/** The journey, in order. Screens absent from this list get no flow bar
 *  (How it works, Settings) because they are reference, not steps. */
export const FLOW: FlowStep[] = [
  { path: '/audience', label: 'Your audience', hint: 'Say who you want to help.' },
  { path: '/discover', label: 'Find an opportunity', hint: 'Read real sources and rank the problems.' },
  { path: '/trends', label: 'Check the evidence', hint: 'Look at the pages behind the result.' },
  { path: '/projects', label: 'Choose your product', hint: 'Turn one opportunity into a product.' },
  { path: '/create', label: 'Build it', hint: 'Write the thing you are going to sell.' },
  { path: '/marketing', label: 'Get the message out', hint: 'Positioning, content and email.' },
  { path: '/pricing', label: 'Set your price', hint: 'What to charge and why.' },
  { path: '/ads', label: 'Run ads', hint: 'Paid traffic once the message works.' },
  { path: '/launch', label: 'Launch', hint: 'Work through the launch checklist.' },
  { path: '/analytics', label: 'Measure and improve', hint: 'Read your numbers and decide what is next.' },
];

/** Screens that are part of the journey but live outside the numbered list. */
const ANNEX: Record<string, { back?: string; next?: string }> = {
  /* /setup is a wizard with its own Back/Next per step, so it is excluded
     rather than given a second, competing navigation row. */
  '/niche': { back: '/discover', next: '/discover' },
  '/problem': { back: '/discover', next: '/create' },
};

export function flowStepIndex(path: string): number {
  return FLOW.findIndex((s) => path === s.path || path.startsWith(`${s.path}/`));
}

/** What sits before and after a given path, or null when off the journey. */
export function flowNeighbours(path: string): { back: FlowStep | null; next: FlowStep | null; index: number } | null {
  const i = flowStepIndex(path);
  if (i >= 0) {
    return { back: i > 0 ? FLOW[i - 1] : null, next: i < FLOW.length - 1 ? FLOW[i + 1] : null, index: i };
  }
  const annex = ANNEX[path.split('/').slice(0, 2).join('/')];
  if (annex) {
    return {
      back: annex.back ? FLOW.find((s) => s.path === annex.back) ?? null : null,
      next: annex.next ? FLOW.find((s) => s.path === annex.next) ?? null : null,
      index: -1,
    };
  }
  return null;
}

export function FlowBar({ className }: { className?: string }) {
  const route = useRoute();
  const nav = flowNeighbours(route.path);
  if (!nav) return null;
  const { back, next, index } = nav;
  const current = index >= 0 ? FLOW[index] : null;
  const mood: MascotMood = index < 0 ? 'idle' : next ? 'idle' : 'happy';

  return (
    <div className={cx('mt-8 pt-5 border-t border-line', className)}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Back is always present, even at the first step, so nobody is stranded. */}
        <Button
          variant="quiet"
          onClick={() => navigate(back ? back.path : '/home')}
        >
          <ArrowLeft size={15} /> {back ? `Back to ${back.label.toLowerCase()}` : 'Back to home'}
        </Button>

        {next ? (
          <Button size="lg" onClick={() => navigate(next.path)}>
            Next: {next.label} <ArrowRight size={15} />
          </Button>
        ) : (
          <Button size="lg" variant="quiet" onClick={() => navigate('/home')}>
            Back to home <ArrowRight size={15} />
          </Button>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Mascot mood={mood} size={44} />
        <div className="min-w-0">
          {current ? (
            <div className="text-[11.5px] font-medium tracking-[0.06em] uppercase text-ink-faint">
              Step {index + 1} of {FLOW.length}
            </div>
          ) : null}
          <div className="text-[12.5px] text-ink-mute">
            {next ? <><span className="text-ink-soft">{next.hint}</span> Comes next.</> : current?.hint ?? 'That is the whole journey. Nice work.'}
          </div>
        </div>
      </div>
    </div>
  );
}
