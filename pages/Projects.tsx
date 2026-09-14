import { useEffect, useState } from 'react';
import { ArrowUpRight, Download, FolderOpen, Hammer, Layers, Trash2 } from 'lucide-react';
import { Page, navigate } from '../components/shell';
import { Button, Card, EmptyState, Modal, ScoreBadge, SectionTitle, Tag, cx } from '../components/ui';
import { db } from '../core/db/database';
import { exportProjectJSON } from '../core/product/engines';
import { exportCSV, exportJSON } from '../core/export/exporters';
import { useStore } from '../store';
import type { Niche, OpportunityScore, Product, Project, Problem } from '../core/types';
import { relTime, truncate } from '../core/lib/utils';

interface Row extends Project {
  niche?: Niche;
  problem?: Problem;
  score?: OpportunityScore;
  product?: Product;
}

export default function Projects() {
  const { toast, reload } = useStore();
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<'all' | 'idea' | 'building' | 'launched'>('all');
  const [confirmDelete, setConfirmDelete] = useState<Row | null>(null);

  const load = async () => {
    const [projects, niches, problems, scores, products] = await Promise.all([
      db.projects.orderBy('updated_at').reverse().toArray(),
      db.niches.toArray(),
      db.problems.toArray(),
      db.opportunity_scores.toArray(),
      db.products.toArray(),
    ]);
    const nicheById = new Map(niches.map((n) => [n.id, n]));
    const problemById = new Map(problems.map((p) => [p.id, p]));
    setRows(projects.map((p) => ({
      ...p,
      niche: nicheById.get(p.niche_id),
      problem: problemById.get(p.problem_id),
      score: scores.find((s) => s.problem_id === p.problem_id),
      product: products.find((x) => x.project_id === p.id),
    })));
  };

  useEffect(() => { void load(); }, []);

  const visible = rows.filter((r) => filter === 'all' || r.status === filter);
  const checklistProgress = (p?: Product) => {
    if (!p?.guide) return null;
    const ready = p.guide.chapters.filter((c) => c.status === 'ready').length;
    return { ready, total: p.guide.chapters.length };
  };

  return (
    <Page
      wide
      title="My products"
      sub="Every opportunity you decided to pursue, with the product built on top of it."
      badge={<Tag tone="lilac"><Layers size={11} /> {rows.length} project{rows.length === 1 ? '' : 's'}</Tag>}
      actions={
        <>
          <Button variant="quiet" disabled={!rows.length} onClick={() => exportCSV('projects', rows.map((r) => ({
            name: r.name, status: r.status, niche: r.niche?.specific_niche, problem: r.problem?.problem_statement,
            score: r.score?.final_score, confidence: r.score?.evidence_confidence, product: r.product?.name, format: r.product?.product_type,
          })))}>
            <Download size={14} /> Export CSV
          </Button>
          <Button onClick={() => navigate('/discover')}>Find another opportunity</Button>
        </>
      }
    >
      <div className="flex flex-wrap gap-2 mb-4">
        {(['all', 'idea', 'building', 'launched'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={cx('filterpill rounded-full px-3.5 py-1.5 text-[12.5px] border transition', filter === k ? 'bg-ink text-white border-ink' : 'bg-white border-line text-ink-mute hover:text-ink')}
          >
            {k === 'all' ? `All (${rows.length})` : `${k} (${rows.filter((r) => r.status === k).length})`}
          </button>
        ))}
      </div>

      {visible.length ? (
        <div className="space-y-4">
          {visible.map((r) => {
            const progress = checklistProgress(r.product);
            return (
              <Card key={r.id} className="pad">
                <div className="flex flex-wrap items-start justify-between gap-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <Tag tone={r.status === 'launched' ? 'moss' : r.status === 'building' ? 'lilac' : 'neutral'}>{r.status}</Tag>
                      <span className="text-[11.5px] text-ink-faint">created {relTime(r.created_at)} · {r.currency}</span>
                    </div>
                    <h3 className="text-[17px] font-semibold tracking-[-0.02em] leading-snug">{r.product?.name || truncate(r.name, 90)}</h3>
                    <p className="sub mt-1.5">{truncate(r.problem?.problem_statement ?? '', 200)}</p>
                    <div className="grid sm:grid-cols-3 gap-x-6 gap-y-2.5 mt-4">
                      <div>
                        <div className="micro">Audience</div>
                        <div className="text-[12.5px] text-ink mt-1">{truncate(r.niche?.target_audience ?? '—', 70)}</div>
                      </div>
                      <div>
                        <div className="micro">Product</div>
                        <div className="text-[12.5px] text-ink mt-1">
                          {r.product ? `${r.product.product_type}${progress ? ` · ${progress.ready}/${progress.total} chapters` : ''}` : 'Not created yet'}
                        </div>
                      </div>
                      <div>
                        <div className="micro">Outcome promise</div>
                        <div className="text-[12.5px] text-ink mt-1">{truncate(r.product?.promise ?? r.niche?.desired_outcome ?? '—', 70)}</div>
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right space-y-2">
                    {r.score ? <ScoreBadge score={r.score.final_score} insufficient={r.score.insufficient_evidence} /> : null}
                    <div className="text-[11.5px] text-ink-faint">{r.score ? `${r.score.evidence_confidence.toFixed(0)}% confidence` : ''}</div>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-line-soft flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => navigate(`/create/${r.id}`)}><Hammer size={13} /> Product workspace</Button>
                  <Button size="sm" variant="quiet" onClick={() => navigate(`/marketing/${r.id}`)}>Marketing</Button>
                  <Button size="sm" variant="quiet" onClick={() => navigate(`/pricing/${r.id}`)}>Pricing</Button>
                  <Button size="sm" variant="quiet" onClick={() => navigate(`/ads/${r.id}`)}>Ads</Button>
                  <Button size="sm" variant="quiet" onClick={() => navigate(`/launch/${r.id}`)}>Launch</Button>
                  <Button size="sm" variant="quiet" onClick={() => navigate(`/analytics/${r.id}`)}>Analytics</Button>
                  <div className="ml-auto flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={async () => { exportJSON('project', await exportProjectJSON(r.id)); }}>
                      <Download size={13} /> Export
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await db.projects.update(r.id, { status: r.status === 'launched' ? 'building' : 'launched', updated_at: new Date().toISOString() });
                        await load();
                        toast({ tone: 'success', title: r.status === 'launched' ? 'Marked as building' : 'Marked as launched' });
                      }}
                    >
                      {r.status === 'launched' ? 'Un-launch' : 'Mark launched'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(r)}><Trash2 size={13} /></Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<FolderOpen size={22} />}
          title="No projects yet"
          body="When you accept an opportunity and click “Create this product”, it becomes a project with its own product, pricing, marketing and analytics."
          action={<Button onClick={() => navigate('/discover')}>Find an opportunity <ArrowUpRight size={14} /></Button>}
        />
      )}

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete this project?"
        sub="The research evidence it came from is kept — only the project, its product, pricing, marketing assets and analytics are removed from this device."
        footer={
          <>
            <Button variant="quiet" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirmDelete) return;
                await db.transaction('rw', [db.projects, db.products, db.pricing, db.marketing, db.campaigns, db.launch, db.analytics], async () => {
                  await db.products.where('project_id').equals(confirmDelete.id).delete();
                  await db.pricing.where('project_id').equals(confirmDelete.id).delete();
                  await db.marketing.where('project_id').equals(confirmDelete.id).delete();
                  await db.campaigns.where('project_id').equals(confirmDelete.id).delete();
                  await db.launch.where('project_id').equals(confirmDelete.id).delete();
                  await db.analytics.where('project_id').equals(confirmDelete.id).delete();
                  await db.projects.delete(confirmDelete.id);
                });
                setConfirmDelete(null);
                await load();
                await reload();
                toast({ tone: 'info', title: 'Project deleted' });
              }}
            >
              <Trash2 size={14} /> Delete project
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] text-ink-soft">{confirmDelete?.product?.name ?? confirmDelete?.name}</p>
      </Modal>
    </Page>
  );
}
