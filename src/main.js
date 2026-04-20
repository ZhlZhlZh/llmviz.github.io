import { initThemeRiver } from './modules/theme-river/index.js';
import { initPaperForce } from './modules/paper-force/index.js';
import { initButterflyPath } from './modules/butterfly-path/index.js';
import { initInstitutionMap } from './modules/institution-map/index.js';
import { initAiHistoryPlaceholder } from './modules/ai-history/index.js';

export function bootstrapApp() {
  const themeRiverEl = document.getElementById('theme-river');
  const paperForceEl = document.getElementById('paper-force');
  const butterflyPathEl = document.getElementById('butterfly-path');
  const institutionMapEl = document.getElementById('institution-map');
  const aiHistoryEl = document.getElementById('ai-history');

  if (!themeRiverEl || !paperForceEl || !butterflyPathEl || !institutionMapEl || !aiHistoryEl) {
    throw new Error('Missing one or more module mount elements in index.html');
  }

  initThemeRiver(themeRiverEl);
  initPaperForce(paperForceEl);
  initButterflyPath(butterflyPathEl);
  initInstitutionMap(institutionMapEl);
  initAiHistoryPlaceholder(aiHistoryEl);
}

bootstrapApp();
