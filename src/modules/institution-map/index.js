import { loadJson } from '../../shared/data-loader.js';
import { getAppState, onAppStateChange, setAppState } from '../../shared/app-state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

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
      <p class="module-subtitle">机构名称先做别名归一化；选中论文后，地图和排行榜会高亮对应机构。</p>
      <div class="chart-toolbar chart-toolbar-wrap">
        <label class="chart-control">
          颜色维度
          <select class="chart-select map-color-mode">
            <option value="community">研究社区</option>
            <option value="org_type">机构类型</option>
          </select>
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
          <h4>机构排行榜</h4>
          <div class="institution-ranking"></div>
        </aside>
      </div>
      <div class="chart-detail map-detail"></div>
      <div class="legend-row map-legend"></div>
    </div>
  `;

  const colorModeEl = container.querySelector('.map-color-mode');
  const sizeModeEl = container.querySelector('.map-size-mode');
  const linkToggle = container.querySelector('.map-link-toggle');
  const statEl = container.querySelector('.chart-stat');
  const svg = container.querySelector('.chart-svg');
  const detailEl = container.querySelector('.map-detail');
  const legendEl = container.querySelector('.map-legend');
  const rankingEl = container.querySelector('.institution-ranking');

  if (!colorModeEl || !sizeModeEl || !linkToggle || !statEl || !svg || !detailEl || !legendEl || !rankingEl) return;

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
    const institutions = mergeInstitutions(rawInstitutions, aliasLookup);
    const institutionNames = new Set(institutions.map((item) => item.institution));
    const byName = new Map(institutions.map((item) => [item.institution, item]));
    const instLinks = buildInstitutionLinks(nodes, edges, aliasLookup, institutionNames).slice(0, 55);
    const papersByInstitution = new Map(institutions.map((item) => [item.institution, []]));
    nodes.forEach((node) => {
      normalizeNodeInstitutions(node, aliasLookup, institutionNames).forEach((name) => {
        papersByInstitution.get(name)?.push(node);
      });
    });

    const viewport = createSvgElement('g', { class: 'map-viewport' });
    const mapLayer = createSvgElement('g');
    const linkLayer = createSvgElement('g');
    const pointLayer = createSvgElement('g');
    const labelLayer = createSvgElement('g');
    viewport.append(mapLayer);
    svg.append(viewport, linkLayer, pointLayer, labelLayer);

    (world.features || []).forEach((feature) => {
      const pathData = geometryToPath(feature.geometry, width, height, padding);
      if (pathData) mapLayer.appendChild(createSvgElement('path', { d: pathData, class: 'world-land' }));
    });

    let transform = { x: 0, y: 0, k: 1 };
    let panning = null;
    let positionById = new Map();
    let visibleIds = new Set();

    function selectedPaperInstitutions() {
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

    function computePositions(items) {
      const groups = new Map();
      items.forEach((item) => {
        const key = `${Math.round(item.lat * 5) / 5}_${Math.round(item.lng * 5) / 5}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      });
      const positions = new Map();
      groups.forEach((group) => {
        group
          .slice()
          .sort((a, b) => b.influence_score - a.influence_score)
          .forEach((item, index) => {
            const base = projectLonLat(item.lng, item.lat, width, height, padding);
            const radius = index === 0 ? 0 : 17 + 12 * Math.sqrt(index);
            const angle = index * 2.399963;
            positions.set(item.id, { x: base.x + Math.cos(angle) * radius, y: base.y + Math.sin(angle) * radius });
          });
      });
      return positions;
    }

    function updateOverlayPositions() {
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
      viewport.setAttribute('transform', `translate(${transform.x} ${transform.y}) scale(${transform.k})`);
      updateOverlayPositions();
    }

    function visibleInstitutions() {
      const relatedNames = selectedPaperInstitutions();
      const top = institutions.slice().sort((a, b) => b.influence_score - a.influence_score).slice(0, 18);
      relatedNames.forEach((name) => {
        const item = byName.get(name);
        if (item && !top.some((candidate) => candidate.id === item.id)) top.push(item);
      });
      return top;
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
      ['圆形=公司', '方形=大学', '三角=研究实验室', '描边=当前论文机构'].forEach((label) => {
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
      rankingEl.innerHTML = '';
      institutions
        .slice()
        .sort((a, b) => b.influence_score - a.influence_score)
        .slice(0, 12)
        .forEach((item, index) => {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = paperInsts.has(item.institution) ? 'institution-rank-row is-related' : 'institution-rank-row';
          row.innerHTML = `<span>${index + 1}</span><strong>${item.institution}</strong><em>${item.influence_score}</em>`;
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
      detailEl.innerHTML = `<strong>${selected.institution}</strong> · ${selected.city}, ${selected.country}<br />论文数 ${selected.papers_count}，引用数 ${selected.citations_count.toLocaleString()}，影响力 ${selected.influence_score}，类型 ${selected.org_type}。<br />${selectedPaperText}<br />代表论文：${paperText}`;
    }

    function renderPoints() {
      const colorMode = colorModeEl.value;
      const sizeMode = sizeModeEl.value;
      const visible = visibleInstitutions();
      const selectedNames = selectedPaperInstitutions();
      visibleIds = new Set(visible.map((item) => item.id));
      positionById = computePositions(visible);
      pointLayer.innerHTML = '';
      labelLayer.innerHTML = '';
      const values = visible.map((item) => Number(item[sizeMode]) || 0);
      const minValue = Math.min(...values);
      const maxValue = Math.max(...values);
      visible.forEach((item) => {
        const radius = mapRange(Number(item[sizeMode]) || 0, minValue, maxValue, 4, 11);
        const position = toScreen(positionById.get(item.id) || projectLonLat(item.lng, item.lat, width, height, padding));
        const group = createSvgElement('g', { class: 'map-point-group', 'data-id': item.id, transform: `translate(${position.x} ${position.y})`, tabindex: '0', role: 'button' });
        const symbol = createSymbol(item, radius, colorByMode(item, colorMode));
        symbol.setAttribute('data-id', item.id);
        symbol.classList.toggle('is-related', selectedNames.has(item.institution));
        symbol.classList.toggle('is-selected', getAppState().selectedInstitutionId === item.id);
        const title = createSvgElement('title');
        title.textContent = `${item.institution}\n${item.country}\n${sizeMode}: ${item[sizeMode]}`;
        symbol.appendChild(title);
        group.appendChild(symbol);
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
      statEl.textContent = `可见机构 ${visible.length}/${institutions.length} · 归一化别名 ${aliasLookup.size} 个 · 联系 ${instLinks.length} 条`;
      renderLinks();
      renderRanking();
      renderLegend();
      renderDetail();
      updateOverlayPositions();
    }

    colorModeEl.addEventListener('change', renderPoints);
    sizeModeEl.addEventListener('change', renderPoints);
    linkToggle.addEventListener('change', renderPoints);
    onAppStateChange(() => renderPoints());
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
