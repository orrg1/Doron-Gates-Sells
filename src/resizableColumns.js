// ─── Resizable columns for every table on the page ─────────────────────
// Drag the edge of a column header to make it wider or narrower; double-click the edge to go back
// to the automatic width. Widths are remembered per table (by its header texts) in localStorage,
// which the cloud layer saves to the server — so they follow you to another computer.
// Works on real <table>s, and on the CSS-grid lists that mark their header row with
// data-rz-grid="<name>" and use `grid-template-columns: var(--rz-cols, <default>)`.
// Tables with their own resizer (data-proctable) are left alone. Phones (no fine pointer) are skipped.
const STORE = 'tableColWidths';
const MIN = 48;
const read = () => { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; } };
const write = (all) => { try { localStorage.setItem(STORE, JSON.stringify(all)); } catch { /* not remembered */ } };
const clean = (t) => String(t || '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 40);

const headerCells = (table) => {
  const row = table.tHead?.rows?.[0];
  return row ? [...row.cells] : [];
};
const tableKey = (table) => 't:' + headerCells(table).map(c => clean(c.textContent)).join('|');

const applyTable = (table, widths) => {
  const cells = headerCells(table);
  if (!widths || widths.length !== cells.length) return false;
  table.style.tableLayout = 'fixed';
  table.style.width = widths.reduce((a, b) => a + b, 0) + 'px';
  table.style.minWidth = '0';
  cells.forEach((c, i) => { c.style.width = widths[i] + 'px'; });
  table.dataset.rzFixed = '1';
  return true;
};
const resetTable = (table) => {
  table.style.tableLayout = ''; table.style.width = ''; table.style.minWidth = '';
  headerCells(table).forEach(c => { c.style.width = ''; });
  delete table.dataset.rzFixed;
};

const gridKey = (header) => 'g:' + header.dataset.rzGrid;
const applyGrid = (header, widths) => {
  const box = header.parentElement; if (!box || !widths || widths.length !== header.children.length) return false;
  box.style.setProperty('--rz-cols', widths.map(w => w + 'px').join(' '));
  box.style.minWidth = (widths.reduce((a, b) => a + b, 0) + 120) + 'px';
  return true;
};
const resetGrid = (header) => { const box = header.parentElement; if (box) { box.style.removeProperty('--rz-cols'); box.style.minWidth = ''; } };

const addHandle = (cell, onDown, onReset) => {
  if (cell.querySelector(':scope > .rz-handle')) return;
  if (getComputedStyle(cell).position === 'static') cell.style.position = 'relative';
  const h = document.createElement('span');
  h.className = 'rz-handle';
  h.setAttribute('aria-hidden', 'true');
  h.title = 'גרור לשינוי רוחב · לחיצה כפולה לרוחב רגיל';
  h.addEventListener('pointerdown', onDown);
  h.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); onReset(); });
  h.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
  cell.appendChild(h);
};

// Shared drag: widths of all columns are measured at the start; the dragged one changes.
const startDrag = (e, cells, idx, apply, save) => {
  e.preventDefault(); e.stopPropagation();
  const widths = cells.map(c => Math.round(c.getBoundingClientRect().width));
  const x0 = e.clientX, w0 = widths[idx];
  const rtl = getComputedStyle(cells[idx]).direction === 'rtl';
  document.body.classList.add('rz-dragging');
  const move = (ev) => {
    const dx = ev.clientX - x0;
    widths[idx] = Math.max(MIN, Math.round(w0 + (rtl ? -dx : dx)));
    apply(widths);
  };
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    document.body.classList.remove('rz-dragging');
    save(widths);
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
};

const enhance = (root) => {
  const saved = read();
  root.querySelectorAll('table').forEach(table => {
    if (table.hasAttribute('data-proctable') || table.closest('[data-no-resize]')) return;
    const cells = headerCells(table); if (cells.length < 2) return;
    const key = tableKey(table);
    if (table.dataset.rzKey !== key) { table.dataset.rzKey = key; if (saved[key]) applyTable(table, saved[key]); else if (table.dataset.rzFixed) resetTable(table); }
    cells.forEach((cell, i) => addHandle(cell,
      (e) => startDrag(e, headerCells(table), i, (w) => applyTable(table, w), (w) => { const all = read(); all[key] = w; write(all); }),
      () => { const all = read(); delete all[key]; write(all); resetTable(table); }));
  });
  root.querySelectorAll('[data-rz-grid]').forEach(header => {
    const cells = [...header.children]; if (cells.length < 2) return;
    const key = gridKey(header);
    if (header.dataset.rzKey !== key) { header.dataset.rzKey = key; if (saved[key]) applyGrid(header, saved[key]); }
    cells.forEach((cell, i) => addHandle(cell,
      (e) => startDrag(e, [...header.children], i, (w) => applyGrid(header, w), (w) => { const all = read(); all[key] = w; write(all); }),
      () => { const all = read(); delete all[key]; write(all); resetGrid(header); }));
  });
};

export const installResizableColumns = () => {
  let fine = true; try { fine = window.matchMedia('(pointer: fine)').matches; } catch { /* assume desktop */ }
  if (!fine) return () => {};
  let queued = false;
  const run = () => { queued = false; try { enhance(document.body); } catch { /* never break the page */ } };
  const obs = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } });
  obs.observe(document.body, { childList: true, subtree: true });
  run();
  return () => obs.disconnect();
};
