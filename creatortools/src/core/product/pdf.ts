/* ------------------------------------------------------------------
   Client-side PDF generation (jsPDF). No server, no upload — the
   deliverable is produced in the browser from the user's own content.
   ------------------------------------------------------------------ */
import { jsPDF } from 'jspdf';
import type { Product, ProductStrategy } from '../types';

const PAGE = { w: 210, h: 297 };
const M = { l: 22, r: 22, t: 26, b: 22 };

interface Ctx {
  doc: jsPDF;
  y: number;
}

function newDoc(): Ctx {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setFont('helvetica', 'normal');
  return { doc, y: M.t };
}

function ensureSpace(ctx: Ctx, needed: number) {
  if (ctx.y + needed > PAGE.h - M.b) {
    ctx.doc.addPage();
    ctx.y = M.t;
  }
}

function text(ctx: Ctx, body: string, opts: { size?: number; style?: 'normal' | 'bold' | 'italic'; color?: [number, number, number]; lead?: number; indent?: number; gap?: number } = {}) {
  const size = opts.size ?? 10.5;
  const lead = opts.lead ?? size * 0.52;
  const indent = opts.indent ?? 0;
  ctx.doc.setFontSize(size);
  ctx.doc.setFont('helvetica', opts.style ?? 'normal');
  ctx.doc.setTextColor(...(opts.color ?? [29, 29, 31] as [number, number, number]));
  const width = PAGE.w - M.l - M.r - indent;
  const lines = ctx.doc.splitTextToSize(body, width) as string[];
  lines.forEach((line) => {
    ensureSpace(ctx, lead + 2);
    ctx.doc.text(line, M.l + indent, ctx.y);
    ctx.y += lead;
  });
  ctx.y += opts.gap ?? 2.2;
}

function rule(ctx: Ctx) {
  ensureSpace(ctx, 6);
  ctx.doc.setDrawColor(228, 228, 232);
  ctx.doc.setLineWidth(0.3);
  ctx.doc.line(M.l, ctx.y, PAGE.w - M.r, ctx.y);
  ctx.y += 6;
}

function heading(ctx: Ctx, body: string, level: 1 | 2 | 3) {
  const size = level === 1 ? 17 : level === 2 ? 13.5 : 11.5;
  ensureSpace(ctx, size * 1.4);
  ctx.y += level === 1 ? 4 : 2.5;
  text(ctx, body, { size, style: 'bold', lead: size * 0.5, gap: level === 1 ? 4 : 2.5 });
}

function bullets(ctx: Ctx, items: string[]) {
  items.filter(Boolean).forEach((item) => {
    ensureSpace(ctx, 7);
    ctx.doc.setFontSize(10.5);
    ctx.doc.setFont('helvetica', 'normal');
    ctx.doc.setTextColor(29, 29, 31);
    ctx.doc.text('•', M.l + 1.5, ctx.y);
    text(ctx, item, { indent: 6, gap: 1.2 });
  });
}

function numbered(ctx: Ctx, items: string[]) {
  items.filter(Boolean).forEach((item, i) => {
    ensureSpace(ctx, 7);
    ctx.doc.setFontSize(10.5);
    ctx.doc.setFont('helvetica', 'bold');
    ctx.doc.setTextColor(110, 110, 115);
    ctx.doc.text(`${i + 1}.`, M.l + 1, ctx.y);
    text(ctx, item, { indent: 7, gap: 1.2 });
  });
}

function callout(ctx: Ctx, title: string, body: string) {
  ensureSpace(ctx, 26);
  const top = ctx.y - 4;
  const wrapped = ctx.doc.splitTextToSize(body, PAGE.w - M.l - M.r - 12) as string[];
  const height = 12 + wrapped.length * 5;
  ctx.doc.setFillColor(244, 242, 255);
  ctx.doc.roundedRect(M.l - 3, top, PAGE.w - M.l - M.r + 6, height, 3, 3, 'F');
  ctx.y = top + 8;
  text(ctx, title, { size: 10.5, style: 'bold', lead: 5, indent: 3, gap: 0.4 });
  text(ctx, body, { size: 10, indent: 3, gap: 0 });
  ctx.y = top + height + 6;
}

/** Minimal, dependency-free markdown renderer for the guide body. */
function renderMarkdown(ctx: Ctx, md: string) {
  const lines = (md || '').split('\n');
  let listBuffer: string[] = [];
  let orderedBuffer: string[] = [];
  let para: string[] = [];

  const flushList = () => {
    if (listBuffer.length) { bullets(ctx, listBuffer); listBuffer = []; }
    if (orderedBuffer.length) { numbered(ctx, orderedBuffer); orderedBuffer = []; }
  };
  const flushPara = () => {
    if (para.length) { text(ctx, para.join(' '), { gap: 3 }); para = []; }
  };

  lines.forEach((raw) => {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { flushPara(); flushList(); return; }
    if (/^#{1,2}\s+/.test(line)) { flushPara(); flushList(); heading(ctx, line.replace(/^#{1,3}\s+/, '').replace(/\*\*/g, ''), line.startsWith('## ') ? 2 : 1); return; }
    if (/^#{3,}\s+/.test(line)) { flushPara(); flushList(); heading(ctx, line.replace(/^#{3,}\s+/, '').replace(/\*\*/g, ''), 3); return; }
    if (/^[-*•]\s+/.test(line)) { flushPara(); listBuffer.push(inline(line.replace(/^[-*•]\s+/, ''))); return; }
    if (/^\d+[.)]\s+/.test(line)) { flushPara(); orderedBuffer.push(inline(line.replace(/^\d+[.)]\s+/, ''))); return; }
    if (/^>\s?/.test(line)) { flushPara(); flushList(); callout(ctx, 'Note', inline(line.replace(/^>\s?/, ''))); return; }
    if (/^---+$/.test(line)) { flushPara(); flushList(); rule(ctx); return; }
    para.push(inline(line));
  });
  flushPara();
  flushList();
}

const inline = (s: string) => s
  .replace(/\*\*(.+?)\*\*/g, '$1')
  .replace(/\*(.+?)\*/g, '$1')
  .replace(/`(.+?)`/g, '$1')
  .replace(/\[(.+?)\]\((.+?)\)/g, '$1');

/* ------------------------------- cover -------------------------------- */

function cover(ctx: Ctx, product: Product, strategy: ProductStrategy | null, author: string) {
  const { doc } = ctx;
  doc.setFillColor(29, 29, 31);
  doc.rect(0, 0, PAGE.w, PAGE.h, 'F');
  doc.setFillColor(124, 92, 255);
  doc.circle(PAGE.w - 30, 40, 26, 'F');
  doc.setFillColor(236, 232, 255);
  doc.circle(PAGE.w - 44, 62, 10, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('CREATORTOOLS', M.l, 30);

  doc.setFontSize(30);
  const title = doc.splitTextToSize(product.name, PAGE.w - M.l - M.r) as string[];
  let y = 120;
  title.slice(0, 5).forEach((line) => { doc.text(line, M.l, y); y += 13; });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12.5);
  doc.setTextColor(200, 198, 208);
  const promise = doc.splitTextToSize(product.promise || strategy?.product_promise || '', PAGE.w - M.l - M.r) as string[];
  y += 6;
  promise.slice(0, 5).forEach((line) => { doc.text(line, M.l, y); y += 6.4; });

  doc.setFontSize(10);
  doc.setTextColor(150, 148, 160);
  doc.text(`Prepared for: ${strategy?.contents?.length ? 'you' : 'your audience'}${author ? ` · ${author}` : ''}`, M.l, PAGE.h - 40);
  doc.text(new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long' }), M.l, PAGE.h - 33);
  doc.setFontSize(8.5);
  doc.text('Generated locally in CreatorTools. Review and edit before selling.', M.l, PAGE.h - 22);

  doc.addPage();
  ctx.y = M.t;
}

function seal(ctx: Ctx, footText: string) {
  const pages = ctx.doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    ctx.doc.setPage(i);
    if (i === 1) continue;
    ctx.doc.setFontSize(8.5);
    ctx.doc.setTextColor(150, 150, 156);
    ctx.doc.text(footText.slice(0, 70), M.l, PAGE.h - 12);
    ctx.doc.text(`${i}`, PAGE.w - M.r, PAGE.h - 12, { align: 'right' });
  }
}

/* ------------------------------- export ------------------------------- */

export interface PdfOptions { author?: string; includeWorksheets?: boolean; includeChecklists?: boolean }

export function exportProductPDF(product: Product, opts: PdfOptions = {}) {
  const ctx = newDoc();
  const strategy = product.strategy;
  cover(ctx, product, strategy, opts.author ?? '');

  heading(ctx, product.name, 1);
  if (product.promise) text(ctx, product.promise, { size: 11.5, style: 'italic', color: [110, 110, 115], gap: 4 });
  if (strategy?.transformation) {
    callout(ctx, 'The transformation', `From: ${strategy.transformation.from || '—'}\nTo: ${strategy.transformation.to || '—'}`);
  }
  rule(ctx);

  const guide = product.guide;
  if (guide?.chapters?.length) {
    heading(ctx, 'Contents', 2);
    numbered(ctx, guide.chapters.map((c) => c.title));
    ctx.y += 3;
    rule(ctx);

    guide.chapters.forEach((chapter, i) => {
      ctx.doc.addPage();
      ctx.y = M.t;
      text(ctx, `CHAPTER ${i + 1}`, { size: 9.5, style: 'bold', color: [124, 92, 255], gap: 1 });
      heading(ctx, chapter.title, 1);
      if (chapter.purpose) text(ctx, chapter.purpose, { size: 10.5, style: 'italic', color: [110, 110, 115], gap: 4 });
      rule(ctx);
      renderMarkdown(ctx, chapter.body || '_This chapter has not been generated yet._');
    });
  } else if (strategy) {
    heading(ctx, 'What is inside', 2);
    strategy.contents.forEach((c) => {
      heading(ctx, c.title, 3);
      text(ctx, c.purpose, { gap: 2 });
    });
  }

  if (opts.includeWorksheets !== false && (guide?.worksheets?.length || strategy?.worksheets?.length)) {
    ctx.doc.addPage();
    ctx.y = M.t;
    heading(ctx, 'Worksheets', 1);
    text(ctx, 'Print these pages or complete them digitally as you work through the guide.', { size: 10.5, color: [110, 110, 115], gap: 4 });
    rule(ctx);
    (guide?.worksheets ?? []).forEach((w) => {
      heading(ctx, w.title, 2);
      if (w.purpose) text(ctx, w.purpose, { size: 10.5, style: 'italic', color: [110, 110, 115], gap: 2 });
      renderMarkdown(ctx, w.body);
      for (let l = 0; l < 4; l++) {
        ensureSpace(ctx, 10);
        ctx.doc.setDrawColor(226, 226, 232);
        ctx.doc.setLineWidth(0.25);
        ctx.doc.line(M.l, ctx.y + 6, PAGE.w - M.r, ctx.y + 6);
        ctx.y += 12;
      }
    });
    (strategy?.worksheets ?? []).filter((s) => !(guide?.worksheets ?? []).some((g) => g.title === s.title)).forEach((w) => {
      heading(ctx, w.title, 2);
      text(ctx, w.purpose, { size: 10.5, gap: 3 });
    });
  }

  if (opts.includeChecklists !== false && (guide?.checklists?.length || strategy?.checklists?.length)) {
    ctx.doc.addPage();
    ctx.y = M.t;
    heading(ctx, 'Checklists', 1);
    rule(ctx);
    const lists = [
      ...(guide?.checklists ?? []),
      ...(strategy?.checklists ?? []).filter((s) => !(guide?.checklists ?? []).some((g) => g.title === s.title)),
    ];
    lists.forEach((list) => {
      heading(ctx, list.title, 2);
      list.items.filter(Boolean).forEach((item) => {
        ensureSpace(ctx, 7);
        ctx.doc.setDrawColor(180, 180, 188);
        ctx.doc.setLineWidth(0.3);
        ctx.doc.roundedRect(M.l, ctx.y - 3.1, 3.4, 3.4, 0.7, 0.7, 'S');
        text(ctx, item, { indent: 7, gap: 1 });
      });
      ctx.y += 3;
    });
  }

  if (strategy?.bonuses?.length) {
    heading(ctx, 'Bonuses', 2);
    bullets(ctx, strategy.bonuses);
  }

  seal(ctx, `${product.name} · Created with CreatorTools`);
  const slug = product.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) || 'creatortools-guide';
  ctx.doc.save(`${slug}.pdf`);
  return `${slug}.pdf`;
}

/** Sales page → readable PDF proof (useful while building the page). */
export function exportSalesPagePDF(productName: string, page: any) {
  const ctx = newDoc();
  heading(ctx, 'Sales page draft', 1);
  text(ctx, productName, { size: 12, style: 'bold', gap: 4 });
  rule(ctx);
  heading(ctx, page.hero_headline ?? '', 1);
  text(ctx, page.hero_subheadline ?? '', { size: 11.5, style: 'italic', color: [110, 110, 115], gap: 4 });
  if (page.problem_section) { heading(ctx, 'Problem', 2); renderMarkdown(ctx, page.problem_section); }
  if (page.solution_section) { heading(ctx, 'Solution', 2); renderMarkdown(ctx, page.solution_section); }
  if (page.whats_inside?.length) { heading(ctx, "What's inside", 2); bullets(ctx, page.whats_inside); }
  if (page.proof_section) { heading(ctx, 'Proof', 2); renderMarkdown(ctx, page.proof_section); }
  if (page.offer_section) { heading(ctx, 'Offer', 2); renderMarkdown(ctx, page.offer_section); }
  if (page.faq?.length) { heading(ctx, 'FAQ', 2); page.faq.forEach((f: any) => { text(ctx, f.q, { size: 10.5, style: 'bold', gap: 0.6 }); text(ctx, f.a, { gap: 2.5 }); }); }
  if (page.final_cta) { heading(ctx, 'Final CTA', 2); text(ctx, page.final_cta, { gap: 2 }); }
  seal(ctx, `${productName} · sales page draft`);
  ctx.doc.save(`${productName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-sales-page.pdf`);
}
