// ─── Phones: wide tables become a list of cards ─────────────────────────
// On a narrow screen a table that doesn't fit its box is shown as one card per row:
// the first cell is the card's title and every other cell gets its column name as a
// small label beside it (CSS in index.css, under .m-cards). Nothing changes on a computer.
// Also works on the CSS-grid lists marked data-rz-grid (header row + sibling rows).
// Tables with their own phone view (data-proctable) or marked data-no-mcards are left alone.
const NARROW = '(max-width: 639px)';
const clean = (t) => String(t || '').replace(/[↑↓↕⇅]/g, '').replace(/\s+/g, ' ').trim();

const headerLabels = (table) => {
  const rows = table.tHead?.rows;
  if (!rows?.length) return null;
  const row = rows[rows.length - 1];
  const out = [];
  [...row.cells].forEach(c => { const span = c.colSpan || 1; for (let i = 0; i < span; i++) out.push(c.dataset.mlabelText ?? clean(c.textContent)); });
  return out;
};

const labelRows = (table, labels) => {
  [...table.tBodies, table.tFoot].filter(Boolean).forEach(body => {
    [...body.rows].forEach(tr => {
      let col = 0;
      [...tr.cells].forEach(td => {
        const span = td.colSpan || 1;
        const lbl = span > 1 ? '' : (labels[col] || '');
        if (td.dataset.mlabel !== lbl) td.dataset.mlabel = lbl;
        col += span;
      });
    });
  });
};

const tooWide = (el) => {
  const box = el.closest('.overflow-x-auto') || el.parentElement;
  const avail = box ? box.clientWidth : window.innerWidth;
  return el.scrollWidth > avail + 8 || el.scrollWidth > window.innerWidth;
};

const processTable = (table) => {
  if (table.closest('[data-proctable],[data-no-mcards]')) return;
  const labels = headerLabels(table);
  if (!labels || labels.length < 3) return;
  if (!table.classList.contains('m-cards')) {
    if (!tooWide(table)) return;
    table.classList.add('m-cards');
  }
  labelRows(table, labels);
};

const processGrid = (header) => {
  if (header.closest('[data-proctable],[data-no-mcards]')) return;
  const box = header.parentElement; if (!box) return;
  if (!box.classList.contains('m-grid-cards')) {
    if (!tooWide(box)) return;
    box.classList.add('m-grid-cards');
  }
  const heads = [...header.children];
  const labels = heads.map(c => c.dataset.mlabelText ?? clean(c.textContent));
  [...box.children].forEach(row => {
    if (row === header) return;
    [...row.children].forEach((cell, i) => {
      const l = labels[i] || ''; if (cell.dataset.mlabel !== l) cell.dataset.mlabel = l;
      if (heads[i]?.dataset.mfull && !cell.dataset.mfull) cell.dataset.mfull = '1';
    });
  });
};

const unconvert = () => {
  document.querySelectorAll('table.m-cards').forEach(t => t.classList.remove('m-cards'));
  document.querySelectorAll('.m-grid-cards').forEach(g => g.classList.remove('m-grid-cards'));
};

export function installMobileTables() {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(NARROW);
  let queued = false;
  const run = () => {
    queued = false;
    if (!mq.matches) return;
    document.querySelectorAll('main table').forEach(processTable);
    document.querySelectorAll('main [data-rz-grid]').forEach(processGrid);
  };
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(run); } };
  const obs = new MutationObserver(schedule);
  obs.observe(document.body, { childList: true, subtree: true });
  const onChange = () => { if (mq.matches) schedule(); else unconvert(); };
  mq.addEventListener?.('change', onChange);
  schedule();
  return () => { obs.disconnect(); mq.removeEventListener?.('change', onChange); };
}
