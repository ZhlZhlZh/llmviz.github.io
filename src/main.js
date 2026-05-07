import { initThemeRiver } from './modules/theme-river/index.js';
import { initPaperForce } from './modules/paper-force/index.js';
import { initButterflyPath } from './modules/butterfly-path/index.js';
import { initInstitutionMap } from './modules/institution-map/index.js';
import { getAppState, onAppStateChange, phaseLabelByYear } from './shared/app-state.js';
import { loadJson } from './shared/data-loader.js';

function shorten(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text || '';
  }
  return `${text.slice(0, maxLength - 1)}...`;
}

async function initFocusPanel() {
  const yearEl = document.getElementById('focus-year');
  const phaseEl = document.getElementById('focus-phase');
  const paperEl = document.getElementById('focus-paper');

  if (!yearEl || !phaseEl || !paperEl) {
    return;
  }

  const nodes = await loadJson('./data/processed/nodes.json');
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  function render(state) {
    const node = nodeById.get(state.selectedPaperId);
    const rangeStart = Number.isFinite(state.yearRangeStart) ? state.yearRangeStart : state.year;
    const rangeEnd = Number.isFinite(state.yearRangeEnd) ? state.yearRangeEnd : state.year;
    yearEl.textContent = rangeStart !== rangeEnd ? `${rangeStart}-${rangeEnd}` : String(rangeEnd);
    phaseEl.textContent = phaseLabelByYear(rangeEnd);
    paperEl.textContent = node ? shorten(node.title, 56) : '未选择论文';
  }

  render(getAppState());
  onAppStateChange(({ state }) => render(state));
}

export function bootstrapApp() {
  const themeRiverEl = document.getElementById('theme-river');
  const paperForceEl = document.getElementById('paper-force');
  const butterflyPathEl = document.getElementById('butterfly-path');
  const institutionMapEl = document.getElementById('institution-map');

  if (!themeRiverEl || !paperForceEl || !butterflyPathEl || !institutionMapEl) {
    throw new Error('Missing one or more module mount elements in index.html');
  }

  initThemeRiver(themeRiverEl);
  initPaperForce(paperForceEl);
  initButterflyPath(butterflyPathEl);
  initInstitutionMap(institutionMapEl);
  initFocusPanel().catch(() => {
    // The charts remain usable even if the summary panel cannot load its copy.
  });
}

bootstrapApp();
