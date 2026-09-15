/* ------------------------------------------------------------------
   Pip — the guide.

   She is the logo brought to life: two overlapping circles, the same
   lavender/violet pair as the mark, given a face. She exists to answer
   "what is happening and what do I do next?" without a paragraph of
   explanation, which is why every state is a mood rather than a spinner.

   States are deliberately few and always meaningful:
     idle      breathing, waiting for you
     thinking  working — dots orbit, eyes glance up
     happy     something landed
     alert     something needs you
     sleepy    nothing to do yet (empty states)
   ------------------------------------------------------------------ */
import { cx } from './ui';

export type MascotMood = 'idle' | 'thinking' | 'happy' | 'alert' | 'sleepy';

/* Written out in full rather than built with a template literal: the CSS guard
   rejects interpolated class names because a misspelt mood would silently
   produce a class that does not exist, and the character would just stop
   animating with no error anywhere. */
const MOOD_CLASS: Record<MascotMood, string> = {
  idle: 'mascot--idle',
  thinking: 'mascot--thinking',
  happy: 'mascot--happy',
  alert: 'mascot--alert',
  sleepy: 'mascot--sleepy',
};

const FACE: Record<MascotMood, { mouth: string; eyes: 'open' | 'arc' | 'up' | 'down' }> = {
  idle: { mouth: 'M62 76 Q70 82 78 76', eyes: 'open' },
  thinking: { mouth: 'M64 78 Q70 80 76 78', eyes: 'up' },
  happy: { mouth: 'M60 74 Q70 84 80 74', eyes: 'arc' },
  alert: { mouth: 'M63 79 Q70 75 77 79', eyes: 'open' },
  sleepy: { mouth: 'M64 78 Q70 80 76 78', eyes: 'down' },
};

export function Mascot({
  mood = 'idle',
  size = 96,
  className,
  title,
}: {
  mood?: MascotMood;
  size?: number;
  className?: string;
  title?: string;
}) {
  const face = FACE[mood] ?? FACE.idle;
  return (
    <div
      className={cx('mascot', MOOD_CLASS[mood] ?? MOOD_CLASS.idle, className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={title ?? 'Pip, your guide'}
    >
      {/* the glow that pulses behind her */}
      <span className="mascot__glow" aria-hidden />
      <svg viewBox="0 0 140 140" width={size} height={size} className="mascot__body" aria-hidden>
        <defs>
          <radialGradient id="pipGlow" cx="50%" cy="45%" r="55%">
            <stop offset="0%" stopColor="#c9b8ff" stopOpacity="0.85" />
            <stop offset="70%" stopColor="#c9b8ff" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#c9b8ff" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* soft halo ring, always turning slowly */}
        <circle className="mascot__ring" cx="70" cy="70" r="52" fill="none" stroke="url(#pipGlow)" strokeWidth="10" />

        {/* the body: exactly the two logo circles */}
        <g className="mascot__inner">
          <circle cx="58" cy="72" r="34" fill="#ecdcff" />
          <circle cx="84" cy="72" r="34" fill="#7c5cff" />

          {/* face sits on the front circle */}
          <g className="mascot__face">
            {face.eyes === 'arc' ? (
              <>
                <path d="M74 62 Q79 56 84 62" stroke="#ffffff" strokeWidth="3.4" strokeLinecap="round" fill="none" />
                <path d="M90 62 Q95 56 100 62" stroke="#ffffff" strokeWidth="3.4" strokeLinecap="round" fill="none" />
              </>
            ) : (
              <>
                <g className="mascot__eye">
                  <ellipse cx="79" cy="64" rx="4.6" ry="5.4" fill="#ffffff" />
                  <circle cx="79" cy={face.eyes === 'up' ? 61.5 : face.eyes === 'down' ? 66 : 64.5} r="2.1" fill="#2a2140" />
                </g>
                <g className="mascot__eye">
                  <ellipse cx="95" cy="64" rx="4.6" ry="5.4" fill="#ffffff" />
                  <circle cx="95" cy={face.eyes === 'up' ? 61.5 : face.eyes === 'down' ? 66 : 64.5} r="2.1" fill="#2a2140" />
                </g>
              </>
            )}
            <path
              className="mascot__mouth"
              d={face.mouth}
              stroke="#ffffff"
              strokeWidth="3"
              strokeLinecap="round"
              fill="none"
            />
            {/* blush, because she is friendly */}
            <ellipse cx="71" cy="74" rx="5" ry="3" fill="#ffffff" opacity="0.22" />
          </g>
        </g>

        {/* thinking dots — only rendered in that mood */}
        {mood === 'thinking' ? (
          <g className="mascot__orbit">
            <circle cx="70" cy="16" r="3.4" fill="#7c5cff" />
            <circle cx="124" cy="70" r="2.6" fill="#c9b8ff" />
            <circle cx="16" cy="70" r="2" fill="#ecdcff" />
          </g>
        ) : null}
      </svg>
    </div>
  );
}

/** Pip with something to say. Used where a state needs explaining. */
export function MascotNote({
  mood = 'idle',
  title,
  children,
  size = 74,
  className,
}: {
  mood?: MascotMood;
  title: string;
  children?: React.ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <div className={cx('flex items-start gap-3.5', className)}>
      <Mascot mood={mood} size={size} />
      <div className="min-w-0 pt-1">
        <div className="text-[13.5px] font-semibold text-ink">{title}</div>
        {children ? <div className="text-[12.5px] text-ink-mute mt-1 leading-relaxed">{children}</div> : null}
      </div>
    </div>
  );
}

const CHIP_TONE: Record<string, string> = {
  lilac: 'mascot-chip--lilac',
  moss: 'mascot-chip--moss',
  sun: 'mascot-chip--sun',
};

/** The hero arrangement: Pip beside the three steps, joined by a line.
 *
 *  An earlier version floated the chips around her at absolute positions. In a
 *  380px column the chips and the mascot overlap — measured, not guessed — and
 *  no arithmetic of percentages fixes it, because two 170px chips plus a
 *  centred mascot need ~490px. A column cannot overlap itself, and it stacks
 *  cleanly on a phone, so the journey reads the same at every width. */
export function MascotJourney({ className }: { className?: string }) {
  const steps = [
    { n: '01', label: 'Find', sub: 'Real market signals', tone: 'lilac' as const },
    { n: '02', label: 'Create', sub: 'Digital products', tone: 'moss' as const },
    { n: '03', label: 'Sell', sub: 'Reach your audience', tone: 'sun' as const },
  ];
  return (
    <div className={cx('mascot-journey', className)}>
      <Mascot mood="happy" size={132} className="mascot-journey__pip" />
      <ol className="mascot-steps">
        {steps.map((s, i) => (
          <li key={s.label} className={cx('mascot-chip', CHIP_TONE[s.tone])} style={{ animationDelay: `${0.08 + i * 0.22}s, ${i * 1.2}s` }}>
            <span className="mascot-chip__n">{s.n}</span>
            <span className="min-w-0">
              <span className="mascot-chip__label">{s.label}</span>
              <span className="mascot-chip__sub">{s.sub}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
