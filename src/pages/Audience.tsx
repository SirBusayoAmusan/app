import { useEffect, useState } from 'react';
import { Info, Save, Sparkles, Users } from 'lucide-react';
import { Page, navigate } from '../components/shell';
import { Button, Callout, Card, Chip, Field, Input, SectionTitle, Select, Tag } from '../components/ui';
import { blankAudience, saveAudience } from '../core/db/database';
import { useStore } from '../store';
import type { AudienceProfile } from '../core/types';

const PLATFORMS = ['Instagram', 'TikTok', 'YouTube', 'X / Twitter', 'LinkedIn', 'Facebook', 'Pinterest', 'Reddit', 'WhatsApp', 'Newsletter', 'Google Search'];
const INCOME = ['Low income', 'Lower-middle income', 'Middle income', 'Upper-middle income', 'High income', 'Mixed / unknown'];
const EMPLOYMENT = ['Student', 'Employed full-time', 'Employed part-time', 'Self-employed / freelancer', 'Business owner', 'Between jobs', 'Retired', 'Aspiring digital product creator'];
const EXPERIENCE = ['Complete beginner', 'Beginner', 'Intermediate', 'Advanced', 'Professional'];
const LIFE_STAGE = ['Early career', 'Building a family', 'Mid-career', 'Career change', 'Post-graduation', 'Pre-retirement', 'Established business owner'];
const GENDER = ['All genders', 'Women', 'Men', 'Non-binary'];
const LOCATIONS = ['Global', 'Nigeria', 'Kenya', 'Ghana', 'South Africa', 'United States', 'United Kingdom', 'Canada', 'India', 'Philippines', 'Pakistan', 'Brazil', 'Germany', 'United Arab Emirates'];

export default function Audience() {
  const { audience, setAudience, toast, settings } = useStore();
  const [profile, setProfile] = useState<AudienceProfile | null>(audience);
  const [interestDraft, setInterestDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!audience && !profile) {
      blankAudience().then((p) => setProfile(p));
    }
  }, [audience, profile]);

  if (!profile) return <Page title="Target audience"><Card className="pad">Loading…</Card></Page>;

  const set = (patch: Partial<AudienceProfile>) => setProfile({ ...profile, ...patch });

  const tooBroad =
    (profile.interests.length === 0 && !profile.business_type) ||
    (profile.location === 'Global' && profile.interests.length < 2) ||
    (profile.age_max - profile.age_min) > 40;

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveAudience(profile);
      setAudience(saved);
      toast({ tone: 'success', title: 'Audience saved', body: 'Next runs will use these inputs to shape queries and scoring.' });
      navigate('/discover');
    } finally {
      setSaving(false);
    }
  };

  const addInterest = () => {
    const value = interestDraft.trim();
    if (!value || profile.interests.includes(value)) return;
    set({ interests: [...profile.interests, value] });
    setInterestDraft('');
  };

  return (
    <Page
      title="Who are you trying to sell to?"
      sub="Creators who narrow this down get sharper niches. These inputs drive the search queries, trend collection, problem ranking, product recommendations, messaging, pricing and ad targeting."
      badge={<Tag tone="lilac"><Users size={11} /> Audience engine</Tag>}
      actions={<Button onClick={save} loading={saving}><Save size={14} /> Save audience</Button>}
    >
      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-5 items-start">
        <div className="space-y-5">
          <Card className="pad">
            <SectionTitle title="Profile basics" sub="The demographic and economic frame for every downstream recommendation." />
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Profile name" hint="Internal label so you can keep several audiences.">
                <Input value={profile.name} onChange={(e: any) => set({ name: e.target.value })} />
              </Field>
              <Field label="Location" hint="Type anything — used for geo-targeted search and ad recommendations.">
                <>
                  <Input list="locations" value={profile.location} onChange={(e: any) => set({ location: e.target.value })} />
                  <datalist id="locations">{LOCATIONS.map((l) => <option key={l} value={l} />)}</datalist>
                </>
              </Field>
              <Field label={`Age range — ${profile.age_min} to ${profile.age_max}`}>
                <div className="space-y-2.5 pt-1.5">
                  <input type="range" min={13} max={100} value={profile.age_min} onChange={(e: any) => set({ age_min: Math.min(Number(e.target.value), profile.age_max) })} className="w-full" />
                  <input type="range" min={13} max={100} value={profile.age_max} onChange={(e: any) => set({ age_max: Math.max(Number(e.target.value), profile.age_min) })} className="w-full" />
                </div>
              </Field>
              <Field label="Gender">
                <Select value={profile.gender} onChange={(e: any) => set({ gender: e.target.value })}>
                  {GENDER.map((g) => <option key={g}>{g}</option>)}
                </Select>
              </Field>
              <Field label="Language"><Input value={profile.language} onChange={(e: any) => set({ language: e.target.value })} /></Field>
              <Field label="Income level" hint="Drives willingness-to-pay and pricing ceilings.">
                <Select value={profile.income_level} onChange={(e: any) => set({ income_level: e.target.value })}>
                  {INCOME.map((i) => <option key={i}>{i}</option>)}
                </Select>
              </Field>
              <Field label="Employment status">
                <Select value={profile.employment_status} onChange={(e: any) => set({ employment_status: e.target.value })}>
                  {EMPLOYMENT.map((i) => <option key={i}>{i}</option>)}
                </Select>
              </Field>
              <Field label="Experience level">
                <Select value={profile.experience_level} onChange={(e: any) => set({ experience_level: e.target.value })}>
                  {EXPERIENCE.map((i) => <option key={i}>{i}</option>)}
                </Select>
              </Field>
              <Field label="Business type / what they do">
                <Input value={profile.business_type} onChange={(e: any) => set({ business_type: e.target.value })} placeholder="e.g. freelance social media managers" />
              </Field>
              <Field label="Life stage">
                <Select value={profile.life_stage} onChange={(e: any) => set({ life_stage: e.target.value })}>
                  {LIFE_STAGE.map((i) => <option key={i}>{i}</option>)}
                </Select>
              </Field>
            </div>
          </Card>

          <Card className="pad">
            <SectionTitle title="Interests & platforms" sub="Interests decide what we search for. Platforms shape the content and ads you get." />
            <Field label="Interests / topics they care about" hint="Add 3-6 specific topics. “digital marketing”, “personal finance”, “freelancing”.">
              <div className="flex gap-2">
                <Input
                  value={interestDraft}
                  onChange={(e: any) => setInterestDraft(e.target.value)}
                  onKeyDown={(e: any) => { if (e.key === 'Enter') { e.preventDefault(); addInterest(); } }}
                  placeholder="Add an interest and press Enter"
                />
                <Button variant="quiet" onClick={addInterest} className="shrink-0">Add</Button>
              </div>
            </Field>
            {profile.interests.length ? (
              <div className="flex flex-wrap gap-2 mt-3">
                {profile.interests.map((i) => (
                  <Chip key={i} active onClick={() => set({ interests: profile.interests.filter((x) => x !== i) })}>{i}</Chip>
                ))}
              </div>
            ) : null}

            <div className="mt-5">
              <span className="label">Preferred platforms</span>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => (
                  <Chip
                    key={p}
                    active={profile.platforms.includes(p)}
                    onClick={() => set({ platforms: profile.platforms.includes(p) ? profile.platforms.filter((x) => x !== p) : [...profile.platforms, p] })}
                  >
                    {p}
                  </Chip>
                ))}
              </div>
            </div>
          </Card>

          {tooBroad ? (
            <Callout tone="warn" title="This audience is still fairly broad">
              CreatorTools works best when it can look for a narrow problem inside a narrow audience. Add specific interests, set a
              concrete location (or accept “Global” knowingly), and narrow the age band. Discovery will still run — but expect more
              mixed results and more cases where we have to tell you we could not find enough.
            </Callout>
          ) : null}

          {/* The flow bar below already provides Back/Next consistently. The
              old in-page "Back to discovery" actually pointed *forward* from
              step 1, which is worse than having no back button at all. */}
          <div className="flex flex-wrap gap-3">
            <Button size="lg" onClick={save} loading={saving}><Save size={15} /> Save & find opportunities</Button>
          </div>
        </div>

        <div className="space-y-5">
          <Card className="pad">
            <div className="flex items-center gap-2 mb-2.5"><Info size={15} /> <h3 className="h3">How these inputs are used</h3></div>
            <ul className="space-y-2 text-[12.5px] text-ink-mute leading-relaxed">
              <li>• <strong className="text-ink">Location + language</strong> set geo/language parameters on every search call, so evidence matches the market you can actually sell into.</li>
              <li>• <strong className="text-ink">Interests + business type</strong> become the topics we always search from nine different angles.</li>
              <li>• <strong className="text-ink">Experience level</strong> changes how problems are ranked — beginners have simpler, more painful problems worth smaller products.</li>
              <li>• <strong className="text-ink">Income level</strong> sets the price ceiling logic in the pricing engine.</li>
              <li>• <strong className="text-ink">Platforms</strong> decide which organic and paid channels the marketing and advertising engines prioritise.</li>
            </ul>
          </Card>

          <Card className="pad">
            <div className="flex items-center gap-2 mb-2.5"><Sparkles size={15} /> <h3 className="h3">Audience snapshot</h3></div>
            <p className="text-[13px] text-ink-soft leading-relaxed">
              {profile.gender === 'All genders' ? 'People' : profile.gender} aged {profile.age_min}–{profile.age_max}
              {profile.location ? ` in ${profile.location}` : ''}, {profile.employment_status.toLowerCase()}, {profile.income_level.toLowerCase()},
              interested in {profile.interests.length ? profile.interests.slice(0, 3).join(', ') : '—'}.
            </p>
            <p className="text-[11.5px] text-ink-faint mt-3">
              Defaults come from your settings ({settings?.default_location ?? 'Global'} · {settings?.default_currency ?? 'USD'}) and can be changed any time.
            </p>
          </Card>
        </div>
      </div>
    </Page>
  );
}
