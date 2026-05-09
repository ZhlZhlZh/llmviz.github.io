import { loadJson } from '../../shared/data-loader.js';
import { getAppState, onAppStateChange, setAppState } from '../../shared/app-state.js';
import { createInteractiveTooltip, escapeHtml, institutionLink } from '../../shared/interactive-tooltip.js';
import { themePapers } from '../../shared/theme-filter.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const MAP_SCENARIOS = {
  leader: {
    label: '谁在主导',
    question: '哪些机构在 LLM 论文主线中最有影响力？',
    description: '按综合影响力展示头部机构，适合回答研究力量是否集中在少数公司、实验室和大学。',
    rankTitle: '影响力排行',
    metric: 'influence_score'
  },
  paper: {
    label: '论文背后是谁',
    question: '当前选中的论文由哪些机构推动？',
    description: '保留头部机构，同时把选中论文对应机构拉入视野，用描边和排行高亮说明论文背后的组织来源。',
    rankTitle: '当前论文相关机构',
    metric: 'papers_count'
  },
  bridge: {
    label: '谁连接主线',
    question: '哪些机构通过引用关系把不同论文主线连接起来？',
    description: '优先展示机构之间的共同引用联系，帮助观察哪些机构在不同阶段和不同流派之间承担桥梁角色。',
    rankTitle: '联系强度排行',
    metric: 'link_count'
  }
};

function createSvgElement(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
  return el;
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value) return [value];
  return [];
}

function projectLonLat(lon, lat, width, height, padding) {
  return {
    x: padding + ((lon + 180) / 360) * (width - padding * 2),
    y: padding + ((90 - lat) / 180) * (height - padding * 2)
  };
}

function polygonToPath(rings, width, height, padding) {
  return rings
    .map((ring) => {
      if (!ring.length) return '';
      const head = projectLonLat(ring[0][0], ring[0][1], width, height, padding);
      const body = ring.slice(1).map(([lon, lat]) => {
        const p = projectLonLat(lon, lat, width, height, padding);
        return `L ${p.x} ${p.y}`;
      }).join(' ');
      return `M ${head.x} ${head.y} ${body} Z`;
    })
    .join(' ');
}

function geometryToPath(geometry, width, height, padding) {
  if (!geometry) return '';
  if (geometry.type === 'Polygon') return polygonToPath(geometry.coordinates, width, height, padding);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((polygon) => polygonToPath(polygon, width, height, padding)).join(' ');
  return '';
}

function mapRange(value, domainMin, domainMax, rangeMin, rangeMax) {
  if (domainMin === domainMax) return (rangeMin + rangeMax) / 2;
  return rangeMin + ((value - domainMin) / (domainMax - domainMin)) * (rangeMax - rangeMin);
}

function clampTranslate(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampTransform(transform, bounds, viewportWidth, viewportHeight) {
  const next = { ...transform };
  const scaledWidth = (bounds.maxX - bounds.minX) * next.k;
  const scaledHeight = (bounds.maxY - bounds.minY) * next.k;

  if (scaledWidth <= viewportWidth) {
    next.x = viewportWidth / 2 - ((bounds.minX + bounds.maxX) / 2) * next.k;
  } else {
    next.x = clampTranslate(next.x, viewportWidth - bounds.maxX * next.k, -bounds.minX * next.k);
  }

  if (scaledHeight <= viewportHeight) {
    next.y = viewportHeight / 2 - ((bounds.minY + bounds.maxY) / 2) * next.k;
  } else {
    next.y = clampTranslate(next.y, viewportHeight - bounds.maxY * next.k, -bounds.minY * next.k);
  }

  return next;
}

function colorByMode(item, mode) {
  if (mode === 'org_type') {
    if (item.org_type === 'university') return '#16a34a';
    if (item.org_type === 'company') return '#d97706';
    return '#7c3aed';
  }
  return item.community === 'chinese' ? '#dc2626' : '#2563eb';
}

function createSymbol(item, radius, color) {
  if (item.org_type === 'university') {
    return createSvgElement('rect', { x: -radius, y: -radius, width: radius * 2, height: radius * 2, fill: color, class: 'map-point' });
  }
  if (item.org_type === 'research_lab') {
    return createSvgElement('path', { d: `M 0 ${-radius} L ${radius} ${radius} L ${-radius} ${radius} Z`, fill: color, class: 'map-point' });
  }
  return createSvgElement('circle', { cx: 0, cy: 0, r: radius, fill: color, class: 'map-point' });
}

function normalizeName(name, aliasLookup) {
  return aliasLookup.get(String(name || '').trim()) || String(name || '').trim();
}

function buildAliasLookup(aliasRows) {
  const lookup = new Map();
  aliasRows.forEach((row) => {
    lookup.set(row.canonical, row.canonical);
    (row.aliases || []).forEach((alias) => lookup.set(alias, row.canonical));
  });
  return lookup;
}

function normalizeNodeInstitutions(node, aliasLookup, institutionNames) {
  return Array.from(new Set(asArray(node.institution)
    .map((name) => normalizeName(name, aliasLookup))
    .filter((name) => institutionNames.has(name))));
}

function institutionId(name) {
  return `inst_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
}

function mergeInstitutions(rawInstitutions, aliasLookup) {
  const merged = new Map();
  rawInstitutions.forEach((item) => {
    const institution = normalizeName(item.institution, aliasLookup);
    const current = merged.get(institution);
    if (!current) {
      merged.set(institution, { ...item, id: institutionId(institution), institution });
      return;
    }
    current.papers_count += Number(item.papers_count) || 0;
    current.citations_count += Number(item.citations_count) || 0;
    current.influence_score = Math.max(current.influence_score, Number(item.influence_score) || 0);
  });
  return Array.from(merged.values());
}

function createLinkStrength(links) {
  const strength = new Map();
  links.forEach((link) => {
    strength.set(link.source, (strength.get(link.source) || 0) + link.count);
    strength.set(link.target, (strength.get(link.target) || 0) + link.count);
  });
  return strength;
}

function scenarioValue(item, scenario, linkStrength) {
  if (scenario.metric === 'link_count') return linkStrength.get(item.institution) || 0;
  return Number(item[scenario.metric]) || 0;
}

function regionOfInstitution(item) {
  if (item.lng < -30 && item.lat > 15) return 'North America';
  if (item.lng >= -30 && item.lng <= 45 && item.lat > 35) return 'Europe';
  if (item.lng >= 95 && item.lat > 15) return 'East Asia';
  if (item.lng >= 90 && item.lng <= 130) return 'Southeast Asia';
  return 'Other regions';
}

function pickBalancedInstitutions(items, scoreFn, limit = 22) {
  const sorted = items.slice().sort((a, b) => scoreFn(b) - scoreFn(a) || b.influence_score - a.influence_score);
  const regions = ['North America', 'Europe', 'East Asia', 'Southeast Asia', 'Other regions'];
  const selected = [];
  const selectedIds = new Set();

  regions.forEach((region) => {
    sorted
      .filter((item) => regionOfInstitution(item) === region)
      .slice(0, region === 'North America' ? 7 : 4)
      .forEach((item) => {
        if (selected.length < limit && !selectedIds.has(item.id)) {
          selected.push(item);
          selectedIds.add(item.id);
        }
      });
  });

  sorted.forEach((item) => {
    if (selected.length < limit && !selectedIds.has(item.id)) {
      selected.push(item);
      selectedIds.add(item.id);
    }
  });

  return selected;
}

function buildInstitutionLinks(nodes, edges, aliasLookup, institutionNames) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const linkMap = new Map();
  edges.forEach((edge) => {
    const sourceNames = normalizeNodeInstitutions(nodeById.get(edge.source) || {}, aliasLookup, institutionNames);
    const targetNames = normalizeNodeInstitutions(nodeById.get(edge.target) || {}, aliasLookup, institutionNames);
    sourceNames.forEach((source) => {
      targetNames.forEach((target) => {
        if (source === target) return;
        const [a, b] = source < target ? [source, target] : [target, source];
        const key = `${a}__${b}`;
        if (!linkMap.has(key)) linkMap.set(key, { source: a, target: b, count: 0 });
        linkMap.get(key).count += 1;
      });
    });
  });
  return Array.from(linkMap.values()).sort((a, b) => b.count - a.count);
}

function summarizePapers(papers) {
  return papers
    .slice()
    .sort((a, b) => (b.citations_count || 0) - (a.citations_count || 0))
    .slice(0, 5)
    .map((paper) => `${paper.year}《${paper.title.length > 36 ? `${paper.title.slice(0, 35)}...` : paper.title}》`);
}

export async function initInstitutionMap(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="module-shell">
      <p class="module-tag">Module 04</p>
      <h3 class="module-title">机构影响力地理图</h3>
      <p class="module-subtitle">把机构地图从“哪里有点”改成“谁在推动这条研究主线”：比较主导机构、当前论文来源和跨主线连接者。</p>
      <div class="scenario-panel institution-scenario-panel">
        <div>
          <p class="scenario-kicker">问题场景</p>
          <h4 class="scenario-title map-question-title"></h4>
          <p class="scenario-copy map-question-copy"></p>
        </div>
        <div class="scenario-switch map-scenario-switch" role="tablist" aria-label="机构地图问题场景">
          ${Object.entries(MAP_SCENARIOS).map(([id, scenario]) => `<button class="scenario-button map-scenario" type="button" data-scenario="${id}">${scenario.label}</button>`).join('')}
        </div>
      </div>
      <div class="chart-toolbar chart-toolbar-wrap">
        <label class="chart-control">
          颜色维度
          <select class="chart-select map-color-mode">
            <option value="community">研究社区</option>
            <option value="org_type">机构类型</option>
          </select>
        </label>
        <label class="chart-control year-control">
          年份
          <div class="year-controls">
            <div class="map-year-dual" role="group" aria-label="年份范围选择">
              <div class="dual-track"><div class="dual-range"></div></div>
              <button type="button" class="dual-thumb start" aria-label="起始年份"></button>
              <button type="button" class="dual-thumb end" aria-label="结束年份"></button>
            </div>
            <span class="map-year-display">全部</span>
            <label class="small"><input type="checkbox" class="map-year-cumulative" /> 累计</label>
            <label class="small"><input type="checkbox" class="map-year-compare" /> 对比</label>
            <button type="button" class="map-year-play">▶</button>
          </div>
        </label>
        <label class="chart-control">
          大小维度
          <select class="chart-select map-size-mode">
            <option value="influence_score">影响力</option>
            <option value="citations_count">引用数</option>
            <option value="papers_count">论文数</option>
          </select>
        </label>
        <label class="chart-control">
          <input class="map-link-toggle" type="checkbox" checked />
          显示机构联系
        </label>
        <div class="chart-stat" aria-live="polite">加载中...</div>
      </div>
      <div class="institution-layout">
        <div class="module-canvas chart-canvas map-canvas">
          <svg class="chart-svg" viewBox="0 0 900 440" role="img" aria-label="Institution world map scatter chart"></svg>
        </div>
        <aside class="institution-side-panel">
          <h4 class="institution-ranking-title">机构排行榜</h4>
          <p class="institution-scenario-evidence"></p>
          <div class="institution-ranking"></div>
        </aside>
      </div>
      <div class="chart-detail map-detail"></div>
      <div class="legend-row map-legend"></div>
    </div>
  `;

  const colorModeEl = container.querySelector('.map-color-mode');
  const sizeModeEl = container.querySelector('.map-size-mode');
  const yearDualEl = container.querySelector('.map-year-dual');
  const dualTrackEl = yearDualEl?.querySelector('.dual-track');
  const dualRangeEl = yearDualEl?.querySelector('.dual-range');
  const thumbStartEl = yearDualEl?.querySelector('.dual-thumb.start');
  const thumbEndEl = yearDualEl?.querySelector('.dual-thumb.end');
  const yearDisplayEl = container.querySelector('.map-year-display');
  const cumulativeCheckboxEl = container.querySelector('.map-year-cumulative');
  const compareCheckboxEl = container.querySelector('.map-year-compare');
  const playButtonEl = container.querySelector('.map-year-play');
  const linkToggle = container.querySelector('.map-link-toggle');
  const statEl = container.querySelector('.chart-stat');
  const svg = container.querySelector('.chart-svg');
  const canvas = container.querySelector('.map-canvas');
  const detailEl = container.querySelector('.map-detail');
  const legendEl = container.querySelector('.map-legend');
  const rankingEl = container.querySelector('.institution-ranking');
  const scenarioButtons = Array.from(container.querySelectorAll('.map-scenario'));
  const questionTitleEl = container.querySelector('.map-question-title');
  const questionCopyEl = container.querySelector('.map-question-copy');
  const evidenceEl = container.querySelector('.institution-scenario-evidence');
  const rankingTitleEl = container.querySelector('.institution-ranking-title');

  if (!colorModeEl || !sizeModeEl || !linkToggle || !statEl || !svg || !canvas || !detailEl || !legendEl || !rankingEl || !questionTitleEl || !questionCopyEl || !evidenceEl || !rankingTitleEl) return;

  try {
    const [world, rawInstitutions, nodes, edges, aliasRows] = await Promise.all([
      loadJson('./public/world.geojson'),
      loadJson('./data/processed/institutions_geo.json'),
      loadJson('./data/processed/nodes.json'),
      loadJson('./data/processed/edges.json'),
      loadJson('./data/processed/institution_aliases.json').catch(() => [])
    ]);

    const width = 900;
    const height = 440;
    const padding = 18;
    const aliasLookup = buildAliasLookup(aliasRows);
    const tooltip = createInteractiveTooltip(canvas);
    const institutions = mergeInstitutions(rawInstitutions, aliasLookup);
    const institutionNames = new Set(institutions.map((item) => item.institution));
    const byName = new Map(institutions.map((item) => [item.institution, item]));
    let instLinks = buildInstitutionLinks(nodes, edges, aliasLookup, institutionNames).slice(0, 55);
    let linkStrength = createLinkStrength(instLinks);
    let papersByInstitution = new Map(institutions.map((item) => [item.institution, []]));
    let compareInstLinks = [];
    let compareLinkStrength = new Map();
    let comparePapersByInstitution = new Map();
    let currentYear = 'all';

    function populatePapersByInstitution(filteredNodes) {
      papersByInstitution = new Map(institutions.map((item) => [item.institution, []]));
      (filteredNodes || []).forEach((node) => {
        normalizeNodeInstitutions(node, aliasLookup, institutionNames).forEach((name) => {
          papersByInstitution.get(name)?.push(node);
        });
      });
    }

    function getFilteredNodes() {
      if (!currentYear || currentYear === 'all' || currentYear === '全部') return nodes;
      // range expression like "start-end"
      if (String(currentYear).includes('-')) {
        const [s, e] = String(currentYear).split('-').map((v) => Number(v));
        if (cumulativeCheckboxEl && cumulativeCheckboxEl.checked) {
          return nodes.filter((n) => Number(n.year) <= e && Number(n.year) >= s);
        }
        return nodes.filter((n) => Number(n.year) >= s && Number(n.year) <= e);
      }
      const numericYear = Number(currentYear);
      if (cumulativeCheckboxEl && cumulativeCheckboxEl.checked) {
        return nodes.filter((n) => Number(n.year) <= numericYear);
      }
      return nodes.filter((n) => Number(n.year) === numericYear);
    }

    function getFilteredEdges(filteredNodeSet) {
      const nodeIds = new Set((filteredNodeSet || getFilteredNodes()).map((n) => n.id));
      return edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
    }

    function recomputeForYear() {
      const filteredNodes = getFilteredNodes();
      const filteredEdges = getFilteredEdges(filteredNodes);
      instLinks = buildInstitutionLinks(filteredNodes, filteredEdges, aliasLookup, institutionNames).slice(0, 55);
      linkStrength = createLinkStrength(instLinks);
      populatePapersByInstitution(filteredNodes);
      // prepare comparison dataset: single end-year (non-cumulative) for quick compare
      if (compareCheckboxEl && compareCheckboxEl.checked) {
        let endYear = null;
        if (String(currentYear).includes('-')) {
          endYear = Number(String(currentYear).split('-')[1]);
        } else if (currentYear && currentYear !== 'all' && currentYear !== '全部') {
          endYear = Number(currentYear);
        }
        const compareNodes = endYear ? nodes.filter((n) => Number(n.year) === endYear) : nodes;
        const compareEdges = getFilteredEdges(compareNodes);
        compareInstLinks = buildInstitutionLinks(compareNodes, compareEdges, aliasLookup, institutionNames).slice(0, 55);
        compareLinkStrength = createLinkStrength(compareInstLinks);
        comparePapersByInstitution = new Map(institutions.map((item) => [item.institution, []]));
        compareNodes.forEach((node) => {
          normalizeNodeInstitutions(node, aliasLookup, institutionNames).forEach((name) => {
            comparePapersByInstitution.get(name)?.push(node);
          });
        });
      } else {
        compareInstLinks = [];
        compareLinkStrength = new Map();
        comparePapersByInstitution = new Map();
      }
    }

    // setup dual-thumb year slider, cumulative and autoplay controls
    let playInterval = null;
    const years = Array.from(new Set(nodes.map((n) => Number(n.year)).filter(Boolean))).sort((a, b) => a - b);
    const minYear = years.length ? years[0] : 2000;
    const maxYear = years.length ? years[years.length - 1] : new Date().getFullYear();
    if (dualTrackEl && thumbStartEl && thumbEndEl && dualRangeEl) {
      function valueToPercent(v) {
        return ((v - minYear) / (maxYear - minYear)) * 100;
      }
      function percentToValue(p) {
        const val = minYear + (p / 100) * (maxYear - minYear);
        return Math.round(val);
      }

      let userInteracted = false;

      function setThumbs(startVal, endVal, skipDisplayUpdate) {
        let s = Math.max(minYear, Math.min(maxYear, Number(startVal)));
        let e = Math.max(minYear, Math.min(maxYear, Number(endVal)));
        if (s > e) [s, e] = [e, s];
        const sp = valueToPercent(s);
        const ep = valueToPercent(e);
        thumbStartEl.style.left = `${sp}%`;
        thumbEndEl.style.left = `${ep}%`;
        dualRangeEl.style.left = `${sp}%`;
        dualRangeEl.style.width = `${Math.max(0, ep - sp)}%`;
        if (!skipDisplayUpdate) {
          if (!userInteracted) {
            yearDisplayEl.textContent = '全部';
            currentYear = 'all';
          } else {
            currentYear = s === e ? String(s) : `${s}-${e}`;
            yearDisplayEl.textContent = s === e ? String(s) : `${s}—${e}`;
          }
        }
      }

      // initialize
      setThumbs(minYear, maxYear, true);

      function updateYearRangeFromDual() {
        userInteracted = true;
        const trackRect = dualTrackEl.getBoundingClientRect();
        const sPct = parseFloat(thumbStartEl.style.left) || 0;
        const ePct = parseFloat(thumbEndEl.style.left) || 100;
        const sVal = percentToValue(sPct);
        const eVal = percentToValue(ePct);
        currentYear = sVal === eVal ? String(sVal) : `${sVal}-${eVal}`;
        yearDisplayEl.textContent = sVal === eVal ? String(sVal) : `${sVal}—${eVal}`;
        recomputeForYear();
        renderPoints();
      }

      function onThumbPointerDown(e, thumb) {
        e.preventDefault();
        const p = e.pointerId;
        thumb.setPointerCapture(p);
        function onMove(ev) {
          const rect = dualTrackEl.getBoundingClientRect();
          const pct = ((ev.clientX - rect.left) / rect.width) * 100;
          const clamped = Math.max(0, Math.min(100, pct));
          if (thumb === thumbStartEl) {
            const endPct = parseFloat(thumbEndEl.style.left) || 100;
            const newPct = Math.min(clamped, endPct);
            thumbStartEl.style.left = `${newPct}%`;
          } else {
            const startPct = parseFloat(thumbStartEl.style.left) || 0;
            const newPct = Math.max(clamped, startPct);
            thumbEndEl.style.left = `${newPct}%`;
          }
          const sp = parseFloat(thumbStartEl.style.left) || 0;
          const ep = parseFloat(thumbEndEl.style.left) || 0;
          dualRangeEl.style.left = `${sp}%`;
          dualRangeEl.style.width = `${Math.max(0, ep - sp)}%`;
        }
        function onUp(ev) {
          try { thumb.releasePointerCapture(p); } catch (err) {}
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          updateYearRangeFromDual();
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      }

      thumbStartEl.addEventListener('pointerdown', (e) => onThumbPointerDown(e, thumbStartEl));
      thumbEndEl.addEventListener('pointerdown', (e) => onThumbPointerDown(e, thumbEndEl));

      // play button behavior: advance end thumb
      if (playButtonEl) {
        playButtonEl.addEventListener('click', () => {
          if (playInterval) {
            clearInterval(playInterval);
            playInterval = null;
            playButtonEl.textContent = '▶';
            return;
          }
          playButtonEl.textContent = '❚❚';
          playInterval = setInterval(() => {
            const ep = parseFloat(thumbEndEl.style.left) || 100;
            const curVal = percentToValue(ep);
            if (curVal >= maxYear) {
              clearInterval(playInterval);
              playInterval = null;
              playButtonEl.textContent = '▶';
              return;
            }
            const next = Math.min(maxYear, curVal + 1);
            const nextPct = valueToPercent(next);
            thumbEndEl.style.left = `${nextPct}%`;
            const sp = parseFloat(thumbStartEl.style.left) || 0;
            const epNew = parseFloat(thumbEndEl.style.left) || 0;
            dualRangeEl.style.left = `${sp}%`;
            dualRangeEl.style.width = `${Math.max(0, epNew - sp)}%`;
            updateYearRangeFromDual();
          }, 900);
        });
      }

    }

    if (cumulativeCheckboxEl) {
      cumulativeCheckboxEl.addEventListener('change', () => {
        recomputeForYear();
        renderPoints();
      });
    }

    if (compareCheckboxEl) {
      compareCheckboxEl.addEventListener('change', () => {
        // recompute comparison data when toggled
        recomputeForYear();
        renderPoints();
      });
    }

    // initial population uses all years (保持与之前一致)
    currentYear = 'all';
    recomputeForYear();

    const viewport = createSvgElement('g', { class: 'map-viewport' });
    const mapLayer = createSvgElement('g');
    const anchorLayer = createSvgElement('g');
    const linkLayer = createSvgElement('g');
    const pointLayer = createSvgElement('g');
    const labelLayer = createSvgElement('g');
    viewport.append(mapLayer);
    svg.append(viewport, anchorLayer, linkLayer, pointLayer, labelLayer);

    (world.features || []).forEach((feature) => {
      const pathData = geometryToPath(feature.geometry, width, height, padding);
      if (pathData) mapLayer.appendChild(createSvgElement('path', { d: pathData, class: 'world-land' }));
    });

    let transform = { x: 0, y: 0, k: 1 };
    let panning = null;
    let positionById = new Map();
    let anchorById = new Map();
    let visibleIds = new Set();
    let activeScenarioId = 'leader';

    function activeScenario() {
      return MAP_SCENARIOS[activeScenarioId] || MAP_SCENARIOS.leader;
    }

    function selectedPaperInstitutions() {
      const theme = getAppState().selectedTheme;
      if (theme) {
        return new Set(themePapers(nodes, theme).flatMap((node) => normalizeNodeInstitutions(node, aliasLookup, institutionNames)));
      }
      const paper = nodes.find((node) => node.id === getAppState().selectedPaperId);
      return new Set(normalizeNodeInstitutions(paper || {}, aliasLookup, institutionNames));
    }

    function selectedInstitution() {
      const selectedId = getAppState().selectedInstitutionId;
      return institutions.find((item) => item.id === selectedId) || institutions[0];
    }

    function toScreen(position) {
      return { x: transform.x + position.x * transform.k, y: transform.y + position.y * transform.k };
    }

    function computePositions(items, radiusById) {
      const positions = new Map();
      anchorById = new Map();
      items.forEach((item, index) => {
        const anchor = projectLonLat(item.lng, item.lat, width, height, padding);
        anchorById.set(item.id, anchor);
        positions.set(item.id, { ...anchor, index });
      });

      for (let iteration = 0; iteration < 90; iteration += 1) {
        for (let i = 0; i < items.length; i += 1) {
          for (let j = i + 1; j < items.length; j += 1) {
            const a = items[i];
            const b = items[j];
            const pa = positions.get(a.id);
            const pb = positions.get(b.id);
            let dx = pb.x - pa.x;
            let dy = pb.y - pa.y;
            let distance = Math.hypot(dx, dy);
            if (distance < 0.01) {
              const angle = (i + j + 1) * 2.399963;
              dx = Math.cos(angle);
              dy = Math.sin(angle);
              distance = 1;
            }
            const minDistance = (radiusById.get(a.id) || 7) + (radiusById.get(b.id) || 7) + 9;
            if (distance >= minDistance) continue;
            const push = (minDistance - distance) / 2;
            const ux = dx / distance;
            const uy = dy / distance;
            pa.x -= ux * push;
            pa.y -= uy * push;
            pb.x += ux * push;
            pb.y += uy * push;
          }
        }

        items.forEach((item) => {
          const position = positions.get(item.id);
          const anchor = anchorById.get(item.id);
          position.x += (anchor.x - position.x) * 0.035;
          position.y += (anchor.y - position.y) * 0.035;
          position.x = clampTranslate(position.x, padding, width - padding);
          position.y = clampTranslate(position.y, padding, height - padding);
        });
      }

      return positions;
    }

    function updateOverlayPositions() {
      anchorLayer.querySelectorAll('.map-anchor-line').forEach((line) => {
        const id = line.getAttribute('data-id');
        const anchor = anchorById.get(id);
        const position = positionById.get(id);
        if (!anchor || !position) return;
        const a = toScreen(anchor);
        const b = toScreen(position);
        line.setAttribute('x1', a.x);
        line.setAttribute('y1', a.y);
        line.setAttribute('x2', b.x);
        line.setAttribute('y2', b.y);
      });
      anchorLayer.querySelectorAll('.map-anchor-dot').forEach((dot) => {
        const anchor = anchorById.get(dot.getAttribute('data-id'));
        if (!anchor) return;
        const p = toScreen(anchor);
        dot.setAttribute('cx', p.x);
        dot.setAttribute('cy', p.y);
      });
      linkLayer.querySelectorAll('.map-institution-link').forEach((line) => {
        const sourcePos = positionById.get(line.getAttribute('data-source-id'));
        const targetPos = positionById.get(line.getAttribute('data-target-id'));
        if (!sourcePos || !targetPos) return;
        const a = toScreen(sourcePos);
        const b = toScreen(targetPos);
        line.setAttribute('x1', a.x);
        line.setAttribute('y1', a.y);
        line.setAttribute('x2', b.x);
        line.setAttribute('y2', b.y);
      });
      pointLayer.querySelectorAll('.map-point-group').forEach((group) => {
        const pos = positionById.get(group.getAttribute('data-id'));
        if (!pos) return;
        const p = toScreen(pos);
        group.setAttribute('transform', `translate(${p.x} ${p.y})`);
      });
      labelLayer.querySelectorAll('.map-label').forEach((label) => {
        const pos = positionById.get(label.getAttribute('data-id'));
        if (!pos) return;
        const p = toScreen(pos);
        const radius = Number(label.getAttribute('data-radius')) || 0;
        label.setAttribute('x', p.x + radius + 4);
        label.setAttribute('y', p.y - radius - 2);
      });
    }

    function applyTransform() {
      transform = clampTransform(transform, { minX: 0, maxX: width, minY: 0, maxY: height }, width, height);
      viewport.setAttribute('transform', `translate(${transform.x} ${transform.y}) scale(${transform.k})`);
      updateOverlayPositions();
    }

    function visibleInstitutions() {
      const relatedNames = selectedPaperInstitutions();
      const scenario = activeScenario();
      let top;
      if (activeScenarioId === 'bridge') {
        top = pickBalancedInstitutions(institutions, (item) => scenarioValue(item, scenario, linkStrength));
      } else if (activeScenarioId === 'paper' && relatedNames.size) {
        top = pickBalancedInstitutions(institutions, (item) => (relatedNames.has(item.institution) ? 1000 : 0) + item.influence_score);
      } else {
        top = pickBalancedInstitutions(institutions, (item) => item.influence_score);
      }
      relatedNames.forEach((name) => {
        const item = byName.get(name);
        if (item && !top.some((candidate) => candidate.id === item.id)) top.push(item);
      });
      return top;
    }

    function renderScenario() {
      const scenario = activeScenario();
      questionTitleEl.textContent = scenario.question;
      questionCopyEl.textContent = scenario.description;
      rankingTitleEl.textContent = scenario.rankTitle;
      scenarioButtons.forEach((button) => {
        const active = button.dataset.scenario === activeScenarioId;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', String(active));
      });
      const paperInsts = selectedPaperInstitutions();
      if (activeScenarioId === 'paper') {
        const theme = getAppState().selectedTheme;
        evidenceEl.textContent = paperInsts.size
          ? theme
            ? `当前主题“${theme}”关联 ${paperInsts.size} 个已归一化机构。`
            : `当前论文关联 ${paperInsts.size} 个已归一化机构。`
          : '先在论文网络、路径图或地铁图中选中论文，可查看其机构归属。';
      } else if (activeScenarioId === 'bridge') {
        evidenceEl.textContent = `基于 ${instLinks.length} 条机构共同引用联系计算。`;
      } else {
        const top = institutions.slice().sort((a, b) => b.influence_score - a.influence_score)[0];
        evidenceEl.textContent = top ? `当前样本最高影响力机构：${top.institution}。` : '';
      }
    }

    function renderLegend() {
      legendEl.innerHTML = '';
      const items = colorModeEl.value === 'community'
        ? [['#2563eb', '英文社区'], ['#dc2626', '中文社区']]
        : [['#d97706', '公司'], ['#16a34a', '大学'], ['#7c3aed', '研究实验室']];
      items.forEach(([color, label]) => {
        const chip = document.createElement('span');
        chip.className = 'legend-chip map-legend-chip';
        chip.innerHTML = `<span class="legend-swatch" style="background:${color}"></span>${label}`;
        legendEl.appendChild(chip);
      });
      ['圆形=公司', '方形=大学', '三角=研究实验室', '细线=真实地理锚点', '描边=当前论文机构'].forEach((label) => {
        const chip = document.createElement('span');
        chip.className = 'legend-chip';
        chip.textContent = label;
        legendEl.appendChild(chip);
      });
    }

    function renderLinks() {
      linkLayer.innerHTML = '';
      if (!linkToggle.checked) return;
      const paperInsts = selectedPaperInstitutions();
      const filtered = instLinks.filter((link) => {
        const source = byName.get(link.source);
        const target = byName.get(link.target);
        return source && target && visibleIds.has(source.id) && visibleIds.has(target.id);
      });
      const maxCount = Math.max(...filtered.map((link) => link.count), 1);
      filtered.forEach((link) => {
        const source = byName.get(link.source);
        const target = byName.get(link.target);
        const a = toScreen(positionById.get(source.id) || projectLonLat(source.lng, source.lat, width, height, padding));
        const b = toScreen(positionById.get(target.id) || projectLonLat(target.lng, target.lat, width, height, padding));
        const active = paperInsts.has(link.source) || paperInsts.has(link.target);
        const line = createSvgElement('line', {
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          class: active ? 'map-institution-link is-active' : 'map-institution-link',
          'stroke-width': mapRange(link.count, 1, maxCount, 0.8, 4),
          'data-source-id': source.id,
          'data-target-id': target.id
        });
        linkLayer.appendChild(line);
      });
    }

    function renderRanking() {
      const paperInsts = selectedPaperInstitutions();
      const scenario = activeScenario();
      rankingEl.innerHTML = '';
      const list = institutions.slice().sort((a, b) => {
        const relatedDiff = activeScenarioId === 'paper'
          ? Number(paperInsts.has(b.institution)) - Number(paperInsts.has(a.institution))
          : 0;
        return relatedDiff || scenarioValue(b, scenario, linkStrength) - scenarioValue(a, scenario, linkStrength) || b.influence_score - a.influence_score;
      }).slice(0, 12);

      list.forEach((item, index) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = paperInsts.has(item.institution) ? 'institution-rank-row is-related' : 'institution-rank-row';
        const value = scenarioValue(item, scenario, linkStrength);
        if (compareCheckboxEl && compareCheckboxEl.checked) {
          const cmpValue = scenarioValue(item, scenario, compareLinkStrength);
          const delta = (value || 0) - (cmpValue || 0);
          row.innerHTML = `<span>${index + 1}</span><strong>${item.institution}</strong><div class="rank-values"><em class="primary">${value}</em><em class="compare">${cmpValue}</em><span class="delta">${delta >= 0 ? '+' + delta : delta}</span></div>`;
        } else {
          row.innerHTML = `<span>${index + 1}</span><strong>${item.institution}</strong><em>${value}</em>`;
        }
        row.addEventListener('click', () => setAppState({ selectedInstitutionId: item.id }, 'institution-map'));
        rankingEl.appendChild(row);
      });
    }

    function renderDetail() {
      const selected = selectedInstitution();
      if (!selected) {
        detailEl.textContent = '没有可用机构数据。';
        return;
      }
      const papers = papersByInstitution.get(selected.institution) || [];
      const selectedPaper = nodes.find((node) => node.id === getAppState().selectedPaperId);
      const selectedPaperText = selectedPaper
        ? `当前选中论文《${selectedPaper.title}》${selectedPaperInstitutions().has(selected.institution) ? '属于该机构。' : '暂未归到该机构。'}`
        : '尚未选中论文。';
      const paperText = summarizePapers(papers).join('；') || '暂无可展示论文';
      const linkText = `机构联系强度 ${linkStrength.get(selected.institution) || 0}`;
      detailEl.innerHTML = `<strong>${selected.institution}</strong> · ${selected.city}, ${selected.country}<br />论文数 ${selected.papers_count}，引用数 ${selected.citations_count.toLocaleString()}，影响力 ${selected.influence_score}，类型 ${selected.org_type}，${linkText}。<br />${selectedPaperText}<br />代表论文：${paperText}`;
    }

    function renderPoints() {
      const colorMode = colorModeEl.value;
      const sizeMode = sizeModeEl.value;
      const visible = visibleInstitutions();
      const selectedNames = selectedPaperInstitutions();
      visibleIds = new Set(visible.map((item) => item.id));
      pointLayer.innerHTML = '';
      labelLayer.innerHTML = '';
      anchorLayer.innerHTML = '';
      const values = visible.map((item) => Number(item[sizeMode]) || 0);
      const minValue = Math.min(...values);
      const maxValue = Math.max(...values);
      const radiusById = new Map(visible.map((item) => [item.id, mapRange(Number(item[sizeMode]) || 0, minValue, maxValue, 4, 11)]));
      positionById = computePositions(visible, radiusById);
      visible.forEach((item) => {
        const radius = radiusById.get(item.id);
        const anchor = anchorById.get(item.id);
        const projected = positionById.get(item.id);
        if (anchor && projected && Math.hypot(projected.x - anchor.x, projected.y - anchor.y) > 3) {
          anchorLayer.appendChild(createSvgElement('line', { class: 'map-anchor-line', 'data-id': item.id }));
          anchorLayer.appendChild(createSvgElement('circle', { class: 'map-anchor-dot', 'data-id': item.id, r: 2.1 }));
        }
        const position = toScreen(positionById.get(item.id) || projectLonLat(item.lng, item.lat, width, height, padding));
        const group = createSvgElement('g', { class: 'map-point-group', 'data-id': item.id, transform: `translate(${position.x} ${position.y})`, tabindex: '0', role: 'button' });
        const symbol = createSymbol(item, radius, colorByMode(item, colorMode));
        symbol.setAttribute('data-id', item.id);
        symbol.classList.toggle('is-related', selectedNames.has(item.institution));
        symbol.classList.toggle('is-selected', getAppState().selectedInstitutionId === item.id);
        group.appendChild(symbol);
        const url = institutionLink(item);
        const tooltipHtml = `<strong>${escapeHtml(item.institution)}</strong><span>${escapeHtml(item.city)}, ${escapeHtml(item.country)}</span><span>${escapeHtml(sizeMode)}: ${escapeHtml(item[sizeMode])}</span><span>论文 ${escapeHtml(item.papers_count)} · 引用 ${Number(item.citations_count || 0).toLocaleString()}</span>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">打开机构链接</a>` : ''}`;
        group.addEventListener('pointerenter', (event) => tooltip.show(event, tooltipHtml));
        group.addEventListener('pointermove', (event) => tooltip.move(event));
        group.addEventListener('pointerleave', () => tooltip.hideSoon());
        group.addEventListener('pointerdown', (event) => event.stopPropagation());
        group.addEventListener('click', () => setAppState({ selectedInstitutionId: item.id }, 'institution-map'));
        group.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setAppState({ selectedInstitutionId: item.id }, 'institution-map');
          }
        });
        pointLayer.appendChild(group);

        if (selectedNames.has(item.institution) || item.influence_score >= 68) {
          const label = createSvgElement('text', { class: 'map-label', 'data-id': item.id, 'data-radius': radius });
          label.textContent = item.institution;
          labelLayer.appendChild(label);
        }
      });
      statEl.textContent = `可见机构 ${visible.length}/${institutions.length} · 年份 ${currentYear === 'all' ? '全部' : currentYear} · 归一化别名 ${aliasLookup.size} 个 · 联系 ${instLinks.length} 条`;
      renderScenario();
      renderLinks();
      renderRanking();
      renderLegend();
      renderDetail();
      updateOverlayPositions();
    }

    colorModeEl.addEventListener('change', renderPoints);
    sizeModeEl.addEventListener('change', renderPoints);
    linkToggle.addEventListener('change', renderPoints);
    scenarioButtons.forEach((button) => {
      button.addEventListener('click', () => {
        activeScenarioId = button.dataset.scenario || 'leader';
        if (activeScenarioId === 'bridge') sizeModeEl.value = 'influence_score';
        renderPoints();
      });
    });
    onAppStateChange(({ state }) => {
      if (state.selectedTheme) activeScenarioId = 'paper';
      renderPoints();
    });
    svg.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const px = ((event.clientX - rect.left) / rect.width) * width;
      const py = ((event.clientY - rect.top) / rect.height) * height;
      const nextK = Math.max(0.7, Math.min(4, transform.k * (event.deltaY > 0 ? 0.9 : 1.1)));
      transform.x = px - ((px - transform.x) / transform.k) * nextK;
      transform.y = py - ((py - transform.y) / transform.k) * nextK;
      transform.k = nextK;
      applyTransform();
    }, { passive: false });
    svg.addEventListener('pointerdown', (event) => {
      panning = { lastX: event.clientX, lastY: event.clientY };
      svg.setPointerCapture(event.pointerId);
    });
    svg.addEventListener('pointermove', (event) => {
      if (!panning) return;
      transform.x += event.clientX - panning.lastX;
      transform.y += event.clientY - panning.lastY;
      panning.lastX = event.clientX;
      panning.lastY = event.clientY;
      applyTransform();
    });
    svg.addEventListener('pointerup', () => { panning = null; });
    svg.addEventListener('pointerleave', () => { panning = null; });

    applyTransform();
    renderPoints();
  } catch (error) {
    statEl.textContent = '数据加载失败，请检查 institutions_geo.json、institution_aliases.json、nodes.json、edges.json 与 world.geojson';
    svg.innerHTML = '';
  }
}
