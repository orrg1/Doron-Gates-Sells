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

// A table/grid that fitted is measured again only when the screen width or its number of rows changes —
// measuring (scrollWidth) forces the browser to lay the page out, and this runs after every change on the page.
const fitted = new WeakMap(); // el → 'width|rows' when it was last found to fit
const sig = (el, rows) => `${window.innerWidth}|${rows}`;

const tableCandidate = (table) => {
  if (table.closest('[data-proctable],[data-no-mcards]')) return null;
  const labels = headerLabels(table);
  if (!labels || labels.length < 3) return null;
  return { el: table, labels, rows: table.rows.length };
};
const gridCandidate = (header) => {
  if (header.closest('[data-proctable],[data-no-mcards]')) return null;
  const box = header.parentElement; if (!box) return null;
  return { el: box, header, rows: box.children.length };
};

const labelGrid = (box, header) => {
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
    const tables = [...document.querySelectorAll('main table')].map(tableCandidate).filter(Boolean);
    const grids = [...document.querySelectorAll('main [data-rz-grid]')].map(gridCandidate).filter(Boolean);
    const all = [...tables.map(c => ({ ...c, cls: 'm-cards' })), ...grids.map(c => ({ ...c, cls: 'm-grid-cards' }))];
    // 1) reads only (one layout for the whole batch): which unconverted, visible ones are too wide
    const toCheck = all.filter(c => !c.el.classList.contains(c.cls) && fitted.get(c.el) !== sig(c.el, c.rows));
    const wide = new Set(), fits = [];
    toCheck.forEach(c => { if (c.el.offsetParent === null) return; (tooWide(c.el) ? wide.add(c.el) : fits.push(c)); });
    // 2) writes
    fits.forEach(c => fitted.set(c.el, sig(c.el, c.rows)));
    all.forEach(c => {
      if (wide.has(c.el)) c.el.classList.add(c.cls);
      if (!c.el.classList.contains(c.cls)) return;
      if (c.cls === 'm-cards') labelRows(c.el, c.labels); else labelGrid(c.el, c.header);
    });
  };
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(run); } };
  const obs = new MutationObserver(schedule);
  obs.observe(document.body, { childList: true, subtree: true });
  const onChange = () => { if (mq.matches) schedule(); else unconvert(); };
  mq.addEventListener?.('change', onChange);
  schedule();
  return () => { obs.disconnect(); mq.removeEventListener?.('change', onChange); };
}
