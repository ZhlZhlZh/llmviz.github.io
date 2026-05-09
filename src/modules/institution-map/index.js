import { loadJson } from '../../shared/data-loader.js';
import { getAppState, onAppStateChange, setAppState } from '../../shared/app-state.js';
import { escapeHtml } from '../../shared/interactive-tooltip.js';
import { themePapers } from '../../shared/theme-filter.js';

/* ═══════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════ */
function asArray(v) { return Array.isArray(v) ? v.filter(Boolean) : v ? [v] : []; }

function normalizeName(name, lookup) {
  return lookup.get(String(name || '').trim()) || String(name || '').trim();
}

function buildAliasLookup(rows) {
  const m = new Map();
  rows.forEach((r) => { m.set(r.canonical, r.canonical); (r.aliases || []).forEach((a) => m.set(a, r.canonical)); });
  return m;
}

function normalizeNodeInstitutions(node, alias, names) {
  return Array.from(new Set(asArray(node.institution).map((n) => normalizeName(n, alias)).filter((n) => names.has(n))));
}

function institutionId(name) {
  return `inst_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
}

function mergeInstitutions(raw, alias) {
  const merged = new Map();
  raw.forEach((item) => {
    const name = normalizeName(item.institution, alias);
    const cur = merged.get(name);
    if (!cur) { merged.set(name, { ...item, id: institutionId(name), institution: name }); return; }
    cur.papers_count += Number(item.papers_count) || 0;
    cur.citations_count += Number(item.citations_count) || 0;
    cur.influence_score = Math.max(cur.influence_score, Number(item.influence_score) || 0);
  });
  return Array.from(merged.values());
}

function colorByMode(item, mode) {
  if (mode === 'org_type') {
    if (item.org_type === 'university') return '#16a34a';
    if (item.org_type === 'company') return '#d97706';
    return '#7c3aed';
  }
  return item.community === 'chinese' ? '#dc2626' : '#2563eb';
}

function mSize(value, min, max) {
  if (min === max) return 18;
  return 12 + ((value - min) / (max - min)) * 22;
}

function buildInstitutionLinks(nodes, edges, alias, names) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const linkMap = new Map();
  edges.forEach((edge) => {
    const sn = normalizeNodeInstitutions(byId.get(edge.source) || {}, alias, names);
    const tn = normalizeNodeInstitutions(byId.get(edge.target) || {}, alias, names);
    sn.forEach((s) => tn.forEach((t) => {
      if (s === t) return;
      const [a, b] = s < t ? [s, t] : [t, s];
      const key = `${a}__${b}`;
      if (!linkMap.has(key)) linkMap.set(key, { source: a, target: b, count: 0 });
      linkMap.get(key).count += 1;
    }));
  });
  return Array.from(linkMap.values()).sort((a, b) => b.count - a.count);
}

/* ═══════════════════════════════════════════════════════════════
   Arc particle animation on Canvas overlay
   ═══════════════════════════════════════════════════════════════ */
class ArcFlowLayer {
  constructor(map) {
    this._map = map;
    this._canvas = document.createElement('canvas');
    this._canvas.className = 'arc-flow-canvas';
    this._canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:450;';
    map.getContainer().appendChild(this._canvas);
    this._ctx = this._canvas.getContext('2d');
    this._arcs = [];
    this._particles = [];
    this._animId = null;
    this._resize();
    map.on('move zoom resize', () => this._resize());
  }

  _resize() {
    const size = this._map.getSize();
    this._canvas.width = size.x * (window.devicePixelRatio || 1);
    this._canvas.height = size.y * (window.devicePixelRatio || 1);
    this._canvas.style.width = size.x + 'px';
    this._canvas.style.height = size.y + 'px';
    this._ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
  }

  setArcs(arcs) {
    // arcs: [{source:{lat,lng}, target:{lat,lng}, count, color, isActive}]
    this._arcs = arcs;
    this._particles = arcs.map((arc) => {
      const count = Math.min(6, Math.max(2, Math.ceil(arc.count / 2)));
      return Array.from({ length: count }, () => ({ t: Math.random(), speed: 0.002 + Math.random() * 0.003 }));
    });
    if (!this._animId) this._animate();
  }

  clear() {
    this._arcs = [];
    this._particles = [];
    if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
    this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
  }

  _latLngToPixel(lat, lng) {
    const pt = this._map.latLngToContainerPoint([lat, lng]);
    return { x: pt.x, y: pt.y };
  }

  _quadBezier(p0, p1, cp, t) {
    const u = 1 - t;
    return { x: u * u * p0.x + 2 * u * t * cp.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * cp.y + t * t * p1.y };
  }

  _animate() {
    this._animId = requestAnimationFrame(() => this._animate());
    const ctx = this._ctx;
    const w = this._canvas.width / (window.devicePixelRatio || 1);
    const h = this._canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, w, h);

    this._arcs.forEach((arc, i) => {
      const s = this._latLngToPixel(arc.source.lat, arc.source.lng);
      const e = this._latLngToPixel(arc.target.lat, arc.target.lng);
      const dx = e.x - s.x;
      const dy = e.y - s.y;
      const dist = Math.hypot(dx, dy);
      // Control point: perpendicular offset for arc curvature
      const mx = (s.x + e.x) / 2;
      const my = (s.y + e.y) / 2;
      const offset = Math.min(dist * 0.3, 80);
      const nx = -dy / dist;
      const ny = dx / dist;
      const cp = { x: mx + nx * offset, y: my + ny * offset };

      // Draw arc path
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.quadraticCurveTo(cp.x, cp.y, e.x, e.y);
      ctx.strokeStyle = arc.isActive ? 'rgba(217, 119, 6, 0.35)' : 'rgba(23, 107, 135, 0.15)';
      ctx.lineWidth = arc.isActive ? 2.5 : 1.2;
      ctx.stroke();

      // Draw particles
      const particles = this._particles[i] || [];
      particles.forEach((p) => {
        p.t += p.speed;
        if (p.t > 1) p.t -= 1;
        const pos = this._quadBezier(s, e, cp, p.t);
        const radius = arc.isActive ? 3.5 : 2.2;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = arc.isActive ? 'rgba(217, 119, 6, 0.9)' : 'rgba(23, 107, 135, 0.7)';
        ctx.fill();
      });
    });
  }

  destroy() {
    this.clear();
    this._canvas.remove();
  }
}

/* ═══════════════════════════════════════════════════════════════
   Scenarios
   ═══════════════════════════════════════════════════════════════ */
const MAP_SCENARIOS = {
  leader: { label: '谁在主导', question: '数据集中哪些来源承载了 AI 论文元数据？', description: '按综合热度展示可定位的数据来源；当前 arXiv 数据不包含作者机构归属。', rankTitle: '来源热度排行', metric: 'influence_score' },
  paper: { label: '论文背后是谁', question: '当前选中的论文由哪些机构推动？', description: '高亮选中论文对应的机构，帮助追溯论文的组织来源。', rankTitle: '当前论文相关机构', metric: 'papers_count' },
  bridge: { label: '谁连接主线', question: '哪些机构通过引用关系把不同论文主线连接起来？', description: '展示机构之间的共同引用联系，观察哪些机构承担桥梁角色。', rankTitle: '联系强度排行', metric: 'link_count' }
};

/* ═══════════════════════════════════════════════════════════════
   Main Export
   ═══════════════════════════════════════════════════════════════ */
export async function initInstitutionMap(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="module-shell">
      <p class="module-tag">Module 04</p>
      <h3 class="module-title">机构影响力地理图</h3>
      <p class="module-subtitle">展示 AI 研究机构的全球分布，通过 OpenAlex 元数据提取作者机构归属，观察不同机构在引用网络中的影响力。</p>
      <div class="scenario-panel institution-scenario-panel">
        <div>
          <p class="scenario-kicker">问题场景</p>
          <h4 class="scenario-title map-question-title"></h4>
          <p class="scenario-copy map-question-copy"></p>
        </div>
        <div class="scenario-switch map-scenario-switch" role="tablist" aria-label="机构地图问题场景">
          ${Object.entries(MAP_SCENARIOS).map(([id, s]) => `<button class="scenario-button map-scenario" type="button" data-scenario="${id}">${s.label}</button>`).join('')}
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
          年份筛选
          <div class="year-controls">
            <div class="map-year-dual" role="group" aria-label="年份范围选择">
              <div class="dual-track"><div class="dual-range"></div></div>
              <button type="button" class="dual-thumb start" aria-label="起始年份"></button>
              <button type="button" class="dual-thumb end" aria-label="结束年份"></button>
            </div>
            <span class="map-year-display">全部</span>
            <button type="button" class="map-year-play">▶</button>
          </div>
        </label>
        <label class="chart-control">
          大小维度
          <select class="chart-select map-size-mode">
            <option value="influence_score">影响力</option>
            <option value="citations_count">热度分</option>
            <option value="papers_count">论文数</option>
          </select>
        </label>
      </div>
      <div class="institution-map-body">
        <div class="institution-layout">
          <div class="map-container">
            <div class="map-leaflet" id="institution-leaflet-map"></div>
            <div class="map-overlay-controls">
              <button type="button" class="map-overlay-btn map-btn-heatmap">热力图</button>
              <button type="button" class="map-overlay-btn map-btn-flow is-active">流动性（合作）</button>
              <button type="button" class="map-overlay-btn map-btn-cluster">数量聚合（按地区）</button>
            </div>
          </div>
          <aside class="institution-side-panel">
            <div class="inst-panel-ranking">
              <h4 class="institution-ranking-title">机构排行榜</h4>
              <p class="institution-scenario-evidence"></p>
              <div class="institution-ranking"></div>
            </div>
            <div class="inst-profile-panel" hidden>
              <button type="button" class="inst-profile-close" aria-label="返回排行榜">← 返回</button>
              <div class="inst-profile-content"></div>
            </div>
          </aside>
        </div>
      </div>
      <div class="map-stats-bar"></div>
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
  const playButtonEl = container.querySelector('.map-year-play');
  const heatmapBtn = container.querySelector('.map-btn-heatmap');
  const flowBtn = container.querySelector('.map-btn-flow');
  const clusterBtn = container.querySelector('.map-btn-cluster');
  const statsBar = container.querySelector('.map-stats-bar');
  const legendEl = container.querySelector('.map-legend');
  const rankingEl = container.querySelector('.institution-ranking');
  const scenarioButtons = Array.from(container.querySelectorAll('.map-scenario'));
  const questionTitleEl = container.querySelector('.map-question-title');
  const questionCopyEl = container.querySelector('.map-question-copy');
  const evidenceEl = container.querySelector('.institution-scenario-evidence');
  const rankingTitleEl = container.querySelector('.institution-ranking-title');
  const mapDiv = container.querySelector('#institution-leaflet-map');
  const profilePanel = container.querySelector('.inst-profile-panel');
  const profileContent = container.querySelector('.inst-profile-content');
  const profileCloseBtn = container.querySelector('.inst-profile-close');

  if (!mapDiv || !colorModeEl || !sizeModeEl) return;

  try {
    const [rawInstitutions, nodes, edges, aliasRows] = await Promise.all([
      loadJson('./data/processed/institutions_geo.json'),
      loadJson('./data/processed/nodes.json'),
      loadJson('./data/processed/edges.json'),
      loadJson('./data/processed/institution_aliases.json').catch(() => [])
    ]);

    const aliasLookup = buildAliasLookup(aliasRows);
    const institutions = mergeInstitutions(rawInstitutions, aliasLookup);
    const institutionNames = new Set(institutions.map((i) => i.institution));
    const byName = new Map(institutions.map((i) => [i.institution, i]));

    const years = Array.from(new Set(nodes.map((n) => Number(n.year)).filter(Boolean))).sort((a, b) => a - b);
    const minYear = years.length ? years[0] : 1993;
    const maxYear = years.length ? years[years.length - 1] : 2023;

    let currentYearStart = minYear;
    let currentYearEnd = maxYear;
    let activeScenarioId = 'leader';
    let showHeatmap = false;
    let showFlow = true;
    let showCluster = false;
    let playInterval = null;
    let selectedProfileId = null;

    let instLinks = [];
    let linkStrength = new Map();
    let papersByInstitution = new Map();

    function recompute() {
      const fn = getFilteredNodes();
      const fe = getFilteredEdges(fn);
      instLinks = buildInstitutionLinks(fn, fe, aliasLookup, institutionNames).slice(0, 60);
      linkStrength = new Map();
      instLinks.forEach((l) => {
        linkStrength.set(l.source, (linkStrength.get(l.source) || 0) + l.count);
        linkStrength.set(l.target, (linkStrength.get(l.target) || 0) + l.count);
      });
      papersByInstitution = new Map(institutions.map((i) => [i.institution, []]));
      fn.forEach((node) => {
        normalizeNodeInstitutions(node, aliasLookup, institutionNames).forEach((name) => {
          papersByInstitution.get(name)?.push(node);
        });
      });
    }

    function getFilteredNodes() {
      return nodes.filter((n) => { const y = Number(n.year); return y >= currentYearStart && y <= currentYearEnd; });
    }

    function getFilteredEdges(fn) {
      const ids = new Set(fn.map((n) => n.id));
      return edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    }

    function selectedPaperInstitutions() {
      const theme = getAppState().selectedTheme;
      if (theme) return new Set(themePapers(nodes, theme).flatMap((n) => normalizeNodeInstitutions(n, aliasLookup, institutionNames)));
      const paper = nodes.find((n) => n.id === getAppState().selectedPaperId);
      return new Set(normalizeNodeInstitutions(paper || {}, aliasLookup, institutionNames));
    }

    function scenarioValue(item) {
      const s = MAP_SCENARIOS[activeScenarioId];
      if (s.metric === 'link_count') return linkStrength.get(item.institution) || 0;
      return Number(item[s.metric]) || 0;
    }

    // ─── Leaflet Map ───
    function renderOfflineSummary() {
      recompute();
      const topTopics = {};
      nodes.forEach((node) => {
        asArray(node.keywords).slice(0, 3).forEach((keyword) => {
          topTopics[keyword] = (topTopics[keyword] || 0) + 1;
        });
      });
      const topicRows = Object.entries(topTopics).sort((a, b) => b[1] - a[1]).slice(0, 8);
      mapDiv.innerHTML = `
        <div class="map-offline-summary">
          <h4>arXiv AI 数据来源</h4>
          <p>当前环境未加载在线地图组件，机构图以离线摘要方式展示。CSV 不包含作者机构字段，因此这里展示数据来源与主题概览。</p>
          <div class="map-offline-metrics">
            <span><strong>${nodes.length.toLocaleString()}</strong> 篇论文</span>
            <span><strong>${years[0]}-${years[years.length - 1]}</strong> 年</span>
            <span><strong>${institutions.length}</strong> 个数据来源</span>
          </div>
        </div>
      `;
      statsBar.innerHTML = `
        <div class="stat-item">数据来源 <span class="stat-value">arXiv AI Metadata Corpus</span></div>
        <div class="stat-item">论文 <span class="stat-value">${nodes.length.toLocaleString()}</span></div>
        <div class="stat-item">年份 <span class="stat-value">${years[0]}-${years[years.length - 1]}</span></div>
      `;
      rankingEl.innerHTML = topicRows.map(([topic, count], index) => `
        <button type="button" class="institution-rank-row">
          <span>${index + 1}</span><strong>${escapeHtml(topic)}</strong><em>${count} 篇</em>
        </button>
      `).join('');
      questionTitleEl.textContent = 'arXiv AI 数据集中哪些主题最活跃？';
      questionCopyEl.textContent = '由于原始 CSV 缺少作者机构归属，离线视图改为展示论文来源与热点主题分布。';
      rankingTitleEl.textContent = '热点主题排行';
      evidenceEl.textContent = '主题来自标题、摘要与类别字段的规则化标注。';
      legendEl.innerHTML = '<span class="legend-chip">离线摘要</span><span class="legend-chip">机构字段缺失，未推断真实机构</span>';
    }

    if (typeof L === 'undefined') {
      renderOfflineSummary();
      return;
    }

    const map = L.map(mapDiv, { center: [30, 0], zoom: 2, minZoom: 2, maxZoom: 12, zoomControl: true, scrollWheelZoom: true });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd', maxZoom: 19
    }).addTo(map);

    let markersLayer = L.layerGroup().addTo(map);
    let clusterGroup = L.markerClusterGroup
      ? L.markerClusterGroup({ maxClusterRadius: 50, spiderfyOnMaxZoom: true })
      : L.layerGroup();
    let heatLayer = null;
    const arcFlow = new ArcFlowLayer(map);

    // ─── Marker rendering ───
    function createMarkerIcon(item, size, color, isHighlighted) {
      const cls = `inst-marker inst-marker--${item.org_type}${isHighlighted ? ' is-highlighted' : ''}`;
      return L.divIcon({ className: '', html: `<div class="${cls}" style="width:${size}px;height:${size}px;background:${color};"></div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
    }

    function renderMarkers() {
      markersLayer.clearLayers();
      clusterGroup.clearLayers();
      const colorMode = colorModeEl.value;
      const sizeMode = sizeModeEl.value;
      const highlighted = selectedPaperInstitutions();
      const vals = institutions.map((i) => Number(i[sizeMode]) || 0);
      const minV = Math.min(...vals), maxV = Math.max(...vals);
      const active = institutions.filter((i) => {
        const p = papersByInstitution.get(i.institution) || [];
        return p.length > 0 || (currentYearStart === minYear && currentYearEnd === maxYear);
      });

      active.forEach((item) => {
        const size = mSize(Number(item[sizeMode]) || 0, minV, maxV);
        const color = colorByMode(item, colorMode);
        const hl = highlighted.has(item.institution);
        const icon = createMarkerIcon(item, size, color, hl);
        const marker = L.marker([item.lat, item.lng], { icon, riseOnHover: true });
        marker.on('click', () => openProfile(item));
        marker.bindTooltip(`<strong>${item.institution}</strong><br/>${item.city}, ${item.country}`, { direction: 'top', offset: [0, -size / 2] });
        if (showCluster) clusterGroup.addLayer(marker); else markersLayer.addLayer(marker);
      });

      if (showCluster) map.addLayer(clusterGroup); else map.removeLayer(clusterGroup);

      const totalPapers = Array.from(papersByInstitution.values()).reduce((s, a) => s + a.length, 0);
      statsBar.innerHTML = `
        <div class="stat-item">可见机构 <span class="stat-value">${active.length}/${institutions.length}</span></div>
        <div class="stat-item">年份 <span class="stat-value">${currentYearStart}–${currentYearEnd}</span></div>
        <div class="stat-item">论文 <span class="stat-value">${totalPapers}</span></div>
        <div class="stat-item">连线 <span class="stat-value">${instLinks.length}</span></div>
      `;
    }

    // ─── Arc flow rendering ───
    function renderFlow() {
      if (!showFlow) { arcFlow.clear(); return; }
      const highlighted = selectedPaperInstitutions();
      const arcs = instLinks.slice(0, 35).map((link) => {
        const s = byName.get(link.source);
        const t = byName.get(link.target);
        if (!s || !t) return null;
        const isActive = highlighted.has(link.source) || highlighted.has(link.target);
        return { source: { lat: s.lat, lng: s.lng }, target: { lat: t.lat, lng: t.lng }, count: link.count, isActive };
      }).filter(Boolean);
      arcFlow.setArcs(arcs);
    }

    // ─── Heatmap ───
    function renderHeatmap() {
      if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
      if (!showHeatmap) return;
      if (!L.heatLayer) return;
      // Use paper count as primary driver, amplify differences
      const paperCounts = institutions.map((i) => (papersByInstitution.get(i.institution) || []).length);
      const maxPapers = Math.max(...paperCounts, 1);
      const pts = institutions.map((i) => {
        const p = (papersByInstitution.get(i.institution) || []).length;
        if (p === 0) return null;
        // Exponential scaling to make differences more dramatic
        const normalized = p / maxPapers;
        const intensity = Math.pow(normalized, 0.5) * 0.8 + 0.2;
        return [i.lat, i.lng, intensity];
      }).filter(Boolean);
      heatLayer = L.heatLayer(pts, {
        radius: 50,
        blur: 18,
        maxZoom: 10,
        max: 1.0,
        minOpacity: 0.45,
        gradient: { 0.0: '#312e81', 0.2: '#7c3aed', 0.4: '#ec4899', 0.6: '#f97316', 0.8: '#facc15', 1.0: '#ff0000' }
      });
      heatLayer.addTo(map);
    }

    // ─── Scenario / Ranking / Legend ───
    function renderScenario() {
      const sc = MAP_SCENARIOS[activeScenarioId];
      questionTitleEl.textContent = sc.question;
      questionCopyEl.textContent = sc.description;
      rankingTitleEl.textContent = sc.rankTitle;
      scenarioButtons.forEach((b) => { const a = b.dataset.scenario === activeScenarioId; b.classList.toggle('is-active', a); b.setAttribute('aria-selected', String(a)); });
      const pi = selectedPaperInstitutions();
      if (activeScenarioId === 'paper') {
        const theme = getAppState().selectedTheme;
        evidenceEl.textContent = pi.size ? (theme ? `主题"${theme}"关联 ${pi.size} 个机构。` : `当前论文关联 ${pi.size} 个机构。`) : '选中论文或主题后可查看机构归属。';
      } else if (activeScenarioId === 'bridge') {
        evidenceEl.textContent = `基于 ${instLinks.length} 条共同引用联系。`;
      } else {
        evidenceEl.textContent = `${currentYearStart}–${currentYearEnd} 年间最有影响力的研究机构。`;
      }
    }

    function renderRanking() {
      const pi = selectedPaperInstitutions();
      rankingEl.innerHTML = '';
      const list = institutions.slice().sort((a, b) => {
        const rd = activeScenarioId === 'paper' ? Number(pi.has(b.institution)) - Number(pi.has(a.institution)) : 0;
        return rd || scenarioValue(b) - scenarioValue(a) || b.influence_score - a.influence_score;
      }).slice(0, 12);
      list.forEach((item, idx) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `institution-rank-row${pi.has(item.institution) ? ' is-related' : ''}`;
        const v = scenarioValue(item);
        const p = (papersByInstitution.get(item.institution) || []).length;
        row.innerHTML = `<span>${idx + 1}</span><strong>${escapeHtml(item.institution)}</strong><em>${v}${p > 0 ? ` · ${p}篇` : ''}</em>`;
        row.addEventListener('click', () => openProfile(item));
        rankingEl.appendChild(row);
      });
    }

    function renderLegend() {
      legendEl.innerHTML = '';
      const items = colorModeEl.value === 'community' ? [['#2563eb', '英文社区'], ['#dc2626', '中文社区']] : [['#d97706', '公司'], ['#16a34a', '大学'], ['#7c3aed', '实验室']];
      items.forEach(([c, l]) => { const ch = document.createElement('span'); ch.className = 'legend-chip map-legend-chip'; ch.innerHTML = `<span class="legend-swatch" style="background:${c}"></span>${l}`; legendEl.appendChild(ch); });
      ['⬤ 公司', '■ 大学', '▲ 实验室', '✨ 粒子=知识流动'].forEach((l) => { const ch = document.createElement('span'); ch.className = 'legend-chip'; ch.textContent = l; legendEl.appendChild(ch); });
    }

    function renderAll() {
      recompute();
      renderMarkers();
      renderFlow();
      renderHeatmap();
      renderScenario();
      renderRanking();
      renderLegend();
    }

    // ─── Institution Profile Panel ───
    function openProfile(item) {
      selectedProfileId = item.id;
      setAppState({ selectedInstitutionId: item.id }, 'institution-map');
      map.flyTo([item.lat, item.lng], 5, { duration: 1 });
      // Show profile, hide ranking
      profilePanel.hidden = false;
      container.querySelector('.inst-panel-ranking').hidden = true;

      const papers = (papersByInstitution.get(item.institution) || []).sort((a, b) => (b.citations_count || 0) - (a.citations_count || 0));
      const allPapers = nodes.filter((n) => normalizeNodeInstitutions(n, aliasLookup, institutionNames).includes(item.institution));

      // Sparkline data: papers per year
      const yearCounts = {};
      years.forEach((y) => { yearCounts[y] = 0; });
      allPapers.forEach((p) => { const y = Number(p.year); if (yearCounts[y] !== undefined) yearCounts[y]++; });
      const sparkData = years.map((y) => yearCounts[y] || 0);
      const sparkMax = Math.max(...sparkData, 1);
      const sparkW = 220, sparkH = 40;
      const sparkPoints = sparkData.map((v, i) => `${(i / (sparkData.length - 1)) * sparkW},${sparkH - (v / sparkMax) * sparkH}`).join(' ');

      // Top collaborators
      const collabMap = new Map();
      instLinks.forEach((l) => {
        if (l.source === item.institution) collabMap.set(l.target, (collabMap.get(l.target) || 0) + l.count);
        if (l.target === item.institution) collabMap.set(l.source, (collabMap.get(l.source) || 0) + l.count);
      });
      const topCollabs = Array.from(collabMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);

      // Topic distribution (radar-like bar chart)
      const topicCounts = {};
      allPapers.forEach((p) => { asArray(p.keywords).forEach((k) => { topicCounts[k] = (topicCounts[k] || 0) + 1; }); });
      const topTopics = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
      const topicMax = topTopics.length ? topTopics[0][1] : 1;

      profileContent.innerHTML = `
        <div class="inst-profile-header">
          <span class="inst-popup-badge inst-popup-badge--${item.org_type}">${item.org_type === 'university' ? '大学' : item.org_type === 'company' ? '公司' : '研究实验室'}</span>
          <h3>${escapeHtml(item.institution)}</h3>
          <p class="inst-profile-location">📍 ${escapeHtml(item.city)}, ${escapeHtml(item.country)}</p>
        </div>
        <div class="inst-profile-metrics">
          <div class="metric-card"><span class="metric-value">${item.papers_count}</span><span class="metric-label">论文总数</span></div>
          <div class="metric-card"><span class="metric-value">${Number(item.citations_count).toLocaleString()}</span><span class="metric-label">总热度</span></div>
          <div class="metric-card"><span class="metric-value">${item.influence_score}</span><span class="metric-label">影响力</span></div>
          <div class="metric-card"><span class="metric-value">${linkStrength.get(item.institution) || 0}</span><span class="metric-label">联系强度</span></div>
        </div>
        <div class="inst-profile-section">
          <h5>📈 论文产出时间线</h5>
          <svg class="inst-sparkline" viewBox="0 0 ${sparkW} ${sparkH + 16}" width="${sparkW}" height="${sparkH + 16}">
            <polyline points="${sparkPoints}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
            <g class="spark-labels" font-size="9" fill="var(--muted)">
              <text x="0" y="${sparkH + 12}">${years[0]}</text>
              <text x="${sparkW}" y="${sparkH + 12}" text-anchor="end">${years[years.length - 1]}</text>
            </g>
          </svg>
        </div>
        <div class="inst-profile-section">
          <h5>🤝 合作最多的机构</h5>
          ${topCollabs.length ? `<ul class="inst-collab-list">${topCollabs.map(([name, count]) => `<li><span class="collab-name">${escapeHtml(name)}</span><span class="collab-count">${count} 次</span></li>`).join('')}</ul>` : '<p class="inst-empty">暂无合作数据</p>'}
        </div>
        <div class="inst-profile-section">
          <h5>🏷️ 研究主题分布</h5>
          <div class="inst-topic-bars">
            ${topTopics.map(([topic, count]) => `<div class="topic-bar-row"><span class="topic-name" title="${escapeHtml(topic)}">${escapeHtml(topic)}</span><div class="topic-bar"><div class="topic-bar-fill" style="width:${(count / topicMax) * 100}%"></div></div><span class="topic-count">${count}</span></div>`).join('')}
          </div>
        </div>
        <div class="inst-profile-section">
          <h5>📄 代表论文 (${currentYearStart}–${currentYearEnd})</h5>
          <ul class="inst-paper-list">
            ${papers.slice(0, 8).map((p) => `<li><span class="paper-year">${p.year}</span><span class="paper-title">${escapeHtml(p.title)}</span><span class="paper-cite">热度 ${(p.hotness_score || p.citations_count || 0).toLocaleString()}</span></li>`).join('')}
            ${papers.length === 0 ? '<li class="inst-empty">该时间段内无论文</li>' : ''}
          </ul>
        </div>
      `;
    }

    profileCloseBtn.addEventListener('click', () => {
      profilePanel.hidden = true;
      selectedProfileId = null;
      container.querySelector('.inst-panel-ranking').hidden = false;
    });

    // ─── Year slider ───
    if (dualTrackEl && thumbStartEl && thumbEndEl && dualRangeEl) {
      const valueToPercent = (v) => ((v - minYear) / (maxYear - minYear)) * 100;
      const percentToValue = (p) => Math.round(minYear + (p / 100) * (maxYear - minYear));

      function setThumbs(s, e) {
        s = Math.max(minYear, Math.min(maxYear, Number(s)));
        e = Math.max(minYear, Math.min(maxYear, Number(e)));
        if (s > e) [s, e] = [e, s];
        const sp = valueToPercent(s), ep = valueToPercent(e);
        thumbStartEl.style.left = `${sp}%`; thumbEndEl.style.left = `${ep}%`;
        dualRangeEl.style.left = `${sp}%`; dualRangeEl.style.width = `${Math.max(0, ep - sp)}%`;
        currentYearStart = s; currentYearEnd = e;
        yearDisplayEl.textContent = s === e ? String(s) : `${s}—${e}`;
      }
      setThumbs(minYear, maxYear);

      function onThumbPointerDown(ev, thumb) {
        ev.preventDefault();
        // Ignore if thumb is disabled (during playback)
        if (thumb.disabled) return;
        // Stop any running animation when user manually drags
        if (playInterval) {
          clearInterval(playInterval);
          playInterval = null;
          playButtonEl.textContent = '▶';
          thumbStartEl.disabled = false;
          thumbEndEl.disabled = false;
        }
        const pid = ev.pointerId;
        thumb.setPointerCapture(pid);
        const onMove = (e) => {
          const rect = dualTrackEl.getBoundingClientRect();
          const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
          if (thumb === thumbStartEl) { thumbStartEl.style.left = `${Math.min(pct, parseFloat(thumbEndEl.style.left) || 100)}%`; }
          else { thumbEndEl.style.left = `${Math.max(pct, parseFloat(thumbStartEl.style.left) || 0)}%`; }
          const sp = parseFloat(thumbStartEl.style.left) || 0, ep = parseFloat(thumbEndEl.style.left) || 0;
          dualRangeEl.style.left = `${sp}%`; dualRangeEl.style.width = `${Math.max(0, ep - sp)}%`;
          currentYearStart = percentToValue(sp); currentYearEnd = percentToValue(ep);
          yearDisplayEl.textContent = currentYearStart === currentYearEnd ? String(currentYearStart) : `${currentYearStart}—${currentYearEnd}`;
        };
        const onUp = () => { try { thumb.releasePointerCapture(pid); } catch (e) {} window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); renderAll(); };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      }
      thumbStartEl.addEventListener('pointerdown', (e) => onThumbPointerDown(e, thumbStartEl));
      thumbEndEl.addEventListener('pointerdown', (e) => onThumbPointerDown(e, thumbEndEl));

      if (playButtonEl) {
        playButtonEl.addEventListener('click', () => {
          if (playInterval) {
            clearInterval(playInterval);
            playInterval = null;
            playButtonEl.textContent = '▶';
            thumbStartEl.disabled = false;
            thumbEndEl.disabled = false;
            return;
          }
          playButtonEl.textContent = '❚❚';
          // Disable manual thumb dragging during animation
          thumbStartEl.disabled = true;
          thumbEndEl.disabled = true;
          currentYearStart = minYear;
          currentYearEnd = minYear;
          setThumbs(minYear, minYear);
          renderAll();
          playInterval = setInterval(() => {
            if (currentYearEnd >= maxYear) {
              clearInterval(playInterval);
              playInterval = null;
              playButtonEl.textContent = '▶';
              thumbStartEl.disabled = false;
              thumbEndEl.disabled = false;
              return;
            }
            currentYearEnd += 1;
            setThumbs(currentYearStart, currentYearEnd);
            renderAll();
          }, 1000);
        });
      }
    }

    // ─── Overlay toggles ───
    heatmapBtn.addEventListener('click', () => { showHeatmap = !showHeatmap; heatmapBtn.classList.toggle('is-active', showHeatmap); renderHeatmap(); });
    flowBtn.addEventListener('click', () => { showFlow = !showFlow; flowBtn.classList.toggle('is-active', showFlow); renderFlow(); });
    clusterBtn.addEventListener('click', () => { showCluster = !showCluster; clusterBtn.classList.toggle('is-active', showCluster); renderMarkers(); });

    // ─── Control events ───
    colorModeEl.addEventListener('change', renderAll);
    sizeModeEl.addEventListener('change', renderAll);
    scenarioButtons.forEach((b) => b.addEventListener('click', () => { activeScenarioId = b.dataset.scenario || 'leader'; renderAll(); }));
    onAppStateChange(({ state }) => { if (state.selectedTheme) activeScenarioId = 'paper'; renderAll(); });

    // Initial render
    renderAll();
    setTimeout(() => map.invalidateSize(), 300);
    const observer = new IntersectionObserver((entries) => { if (entries[0].isIntersecting) map.invalidateSize(); }, { threshold: 0.1 });
    observer.observe(mapDiv);

  } catch (error) {
    console.error('Institution map error:', error);
    if (container.querySelector('.map-stats-bar')) container.querySelector('.map-stats-bar').textContent = '数据加载失败';
  }
}
