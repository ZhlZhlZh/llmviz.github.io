import { loadJson } from '../../shared/data-loader.js';
import { getAppState, onAppStateChange, setAppState } from '../../shared/app-state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgElement(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
  return el;
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
      const body = ring
        .slice(1)
        .map(([lon, lat]) => {
          const p = projectLonLat(lon, lat, width, height, padding);
          return `L ${p.x} ${p.y}`;
        })
        .join(' ');
      return `M ${head.x} ${head.y} ${body} Z`;
    })
    .join(' ');
}

function geometryToPath(geometry, width, height, padding) {
  if (!geometry) return '';
  if (geometry.type === 'Polygon') return polygonToPath(geometry.coordinates, width, height, padding);
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.map((polygon) => polygonToPath(polygon, width, height, padding)).join(' ');
  }
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
    return createSvgElement('rect', {
      x: -radius,
      y: -radius,
      width: radius * 2,
      height: radius * 2,
      fill: color,
      class: 'map-point'
    });
  }
  if (item.org_type === 'research_lab') {
    return createSvgElement('path', {
      d: `M 0 ${-radius} L ${radius} ${radius} L ${-radius} ${radius} Z`,
      fill: color,
      class: 'map-point'
    });
  }
  return createSvgElement('circle', { cx: 0, cy: 0, r: radius, fill: color, class: 'map-point' });
}

function buildInstitutionLinks(nodes, edges) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const linkMap = new Map();
  edges.forEach((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target || source.institution === target.institution) return;
    const key = source.institution < target.institution
      ? `${source.institution}__${target.institution}`
      : `${target.institution}__${source.institution}`;
    if (!linkMap.has(key)) {
      linkMap.set(key, { source: source.institution, target: target.institution, count: 0 });
    }
    linkMap.get(key).count += 1;
  });
  return Array.from(linkMap.values()).sort((a, b) => b.count - a.count);
}

export async function initInstitutionMap(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="module-shell">
      <p class="module-tag">Module 04</p>
      <h3 class="module-title">机构影响力世界地图</h3>
      <p class="module-subtitle">点表示机构，线表示论文引用所形成的机构联系；滚轮缩放与拖拽平移可聚焦区域，缩放越近显示越多机构。</p>
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
        <label class="chart-control">
          <input class="map-spread-toggle" type="checkbox" checked />
          展开重叠
        </label>
        <div class="chart-stat" aria-live="polite">加载中...</div>
      </div>
      <div class="module-canvas chart-canvas map-canvas">
        <svg class="chart-svg" viewBox="0 0 900 440" role="img" aria-label="Institution world map scatter chart"></svg>
      </div>
      <div class="chart-detail map-detail"></div>
      <div class="legend-row map-legend"></div>
    </div>
  `;

  const colorModeEl = container.querySelector('.map-color-mode');
  const sizeModeEl = container.querySelector('.map-size-mode');
  const linkToggle = container.querySelector('.map-link-toggle');
  const spreadToggle = container.querySelector('.map-spread-toggle');
  const statEl = container.querySelector('.chart-stat');
  const svg = container.querySelector('.chart-svg');
  const detailEl = container.querySelector('.map-detail');
  const legendEl = container.querySelector('.map-legend');

  if (!colorModeEl || !sizeModeEl || !linkToggle || !spreadToggle || !statEl || !svg || !detailEl || !legendEl) return;

  try {
    const [world, institutions, nodes, edges] = await Promise.all([
      loadJson('./public/world.geojson'),
      loadJson('./data/processed/institutions_geo.json'),
      loadJson('./data/processed/nodes.json'),
      loadJson('./data/processed/edges.json')
    ]);

    const width = 900;
    const height = 440;
    const padding = 18;
    const byName = new Map(institutions.map((item) => [item.institution, item]));
    const instLinks = buildInstitutionLinks(nodes, edges)
      .filter((link) => byName.has(link.source) && byName.has(link.target))
      .slice(0, 45);

    const viewport = createSvgElement('g', { class: 'map-viewport' });
    const mapLayer = createSvgElement('g');
    const linkLayer = createSvgElement('g');
    const pointLayer = createSvgElement('g');
    const labelLayer = createSvgElement('g');
    viewport.append(mapLayer);
    svg.append(viewport, linkLayer, pointLayer, labelLayer);

    let transform = { x: 0, y: 0, k: 1 };
    let panning = null;

    (world.features || []).forEach((feature) => {
      const pathData = geometryToPath(feature.geometry, width, height, padding);
      if (!pathData) return;
      mapLayer.appendChild(createSvgElement('path', { d: pathData, class: 'world-land' }));
    });

    let positionById = new Map();
    let visibleIds = new Set();
    let lastZoomBucket = '';

    function toScreenPosition(position) {
      return {
        x: transform.x + position.x * transform.k,
        y: transform.y + position.y * transform.k
      };
    }

    function updateOverlayPositions() {
      linkLayer.querySelectorAll('.map-institution-link').forEach((line) => {
        const sourceId = line.getAttribute('data-source-id');
        const targetId = line.getAttribute('data-target-id');
        const sourcePos = positionById.get(sourceId);
        const targetPos = positionById.get(targetId);
        if (!sourcePos || !targetPos) return;
        const a = toScreenPosition(sourcePos);
        const b = toScreenPosition(targetPos);
        line.setAttribute('x1', a.x);
        line.setAttribute('y1', a.y);
        line.setAttribute('x2', b.x);
        line.setAttribute('y2', b.y);
      });

      pointLayer.querySelectorAll('.map-point-group').forEach((group) => {
        const id = group.getAttribute('data-id');
        const pos = positionById.get(id);
        if (!pos) return;
        const screen = toScreenPosition(pos);
        group.setAttribute('transform', `translate(${screen.x} ${screen.y})`);
      });

      labelLayer.querySelectorAll('.map-label').forEach((label) => {
        const id = label.getAttribute('data-id');
        const pos = positionById.get(id);
        if (!pos) return;
        const screen = toScreenPosition(pos);
        const radius = Number(label.getAttribute('data-radius')) || 0;
        label.setAttribute('x', screen.x + radius + 4);
        label.setAttribute('y', screen.y - radius - 2);
      });
    }

    function applyTransform() {
      viewport.setAttribute('transform', `translate(${transform.x} ${transform.y}) scale(${transform.k})`);
      updateOverlayPositions();
    }

    function zoomBucket() {
      if (transform.k < 1.1) return 'far';
      if (transform.k < 1.6) return 'mid';
      if (transform.k < 2.2) return 'near';
      return 'close';
    }

    function maxVisibleCount() {
      const bucket = zoomBucket();
      if (bucket === 'far') return 10;
      if (bucket === 'mid') return 20;
      if (bucket === 'near') return 36;
      return institutions.length;
    }

    function getVisibleInstitutions() {
      const sorted = institutions.slice().sort((a, b) => b.influence_score - a.influence_score);
      const limit = maxVisibleCount();
      const visible = sorted.slice(0, limit);
      const selectedId = getAppState().selectedInstitutionId;
      if (selectedId && !visible.some((item) => item.id === selectedId)) {
        const selected = institutions.find((item) => item.id === selectedId);
        if (selected) {
          if (visible.length >= limit) visible.pop();
          visible.push(selected);
        }
      }
      return visible;
    }

    function positionKey(item) {
      const latKey = Math.round(item.lat * 5) / 5;
      const lngKey = Math.round(item.lng * 5) / 5;
      return `${latKey}_${lngKey}`;
    }

    function computePointPositions(items) {
      const groups = new Map();
      items.forEach((item) => {
        const key = positionKey(item);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      });

      const positions = new Map();
      groups.forEach((group) => {
        const sortedGroup = group
          .slice()
          .sort((a, b) => b.influence_score - a.influence_score || a.institution.localeCompare(b.institution));
        sortedGroup.forEach((item, index) => {
          const base = projectLonLat(item.lng, item.lat, width, height, padding);
          if (!spreadToggle.checked || group.length === 1) {
            positions.set(item.id, { x: base.x, y: base.y });
            return;
          }
          const angle = index * 2.399963;
          const radius = index === 0 ? 0 : 18 + 14 * Math.sqrt(index);
          positions.set(item.id, {
            x: base.x + Math.cos(angle) * radius,
            y: base.y + Math.sin(angle) * radius
          });
        });
      });
      return positions;
    }

    function relatedInstitutions(name) {
      return instLinks
        .filter((link) => link.source === name || link.target === name)
        .slice(0, 5)
        .map((link) => `${link.source === name ? link.target : link.source} (${link.count})`);
    }

    function renderLegend() {
      const colorMode = colorModeEl.value;
      legendEl.innerHTML = '';
      const items = colorMode === 'community'
        ? [
            ['#2563eb', '英文社区'],
            ['#dc2626', '中文社区']
          ]
        : [
            ['#d97706', '公司'],
            ['#16a34a', '大学'],
            ['#7c3aed', '研究实验室']
          ];
      items.forEach(([color, label]) => {
        const chip = document.createElement('span');
        chip.className = 'legend-chip map-legend-chip';
        chip.innerHTML = `<span class="legend-swatch" style="background:${color}"></span>${label}`;
        legendEl.appendChild(chip);
      });
      ['圆形 = 公司', '方形 = 大学', '三角 = 研究实验室', '线宽 = 引用联系强度'].forEach((label) => {
        const chip = document.createElement('span');
        chip.className = 'legend-chip';
        chip.textContent = label;
        legendEl.appendChild(chip);
      });
    }

    function renderSelectedInstitution() {
      const selectedId = getAppState().selectedInstitutionId || institutions[0]?.id;
      const selected = institutions.find((item) => item.id === selectedId) || institutions[0];
      Array.from(pointLayer.querySelectorAll('.map-point')).forEach((point) => {
        point.classList.toggle('is-selected', point.getAttribute('data-id') === selected?.id);
      });
      Array.from(linkLayer.querySelectorAll('.map-institution-link')).forEach((line) => {
        const active = line.getAttribute('data-source') === selected?.institution
          || line.getAttribute('data-target') === selected?.institution;
        line.classList.toggle('is-active', active);
      });
      if (!selected) {
        detailEl.textContent = '没有可用机构数据。';
        return;
      }
      const related = relatedInstitutions(selected.institution);
      detailEl.innerHTML = `<strong>${selected.institution}</strong> · ${selected.city}, ${selected.country}<br />论文数 ${selected.papers_count}，引用数 ${selected.citations_count.toLocaleString()}，影响力 ${selected.influence_score}，类型 ${selected.org_type}。<br />相关机构：${related.length ? related.join('、') : '暂无跨机构引用联系'}`;
    }

    function renderLinks() {
      linkLayer.innerHTML = '';
      if (!linkToggle.checked) return;
      const filteredLinks = instLinks.filter((link) => {
        const source = byName.get(link.source);
        const target = byName.get(link.target);
        if (!source || !target) return false;
        return visibleIds.has(source.id) && visibleIds.has(target.id);
      });
      const maxCount = Math.max(...filteredLinks.map((link) => link.count), 1);
      filteredLinks.forEach((link) => {
        const source = byName.get(link.source);
        const target = byName.get(link.target);
        if (!source || !target) return;
        const a = positionById.get(source.id) || projectLonLat(source.lng, source.lat, width, height, padding);
        const b = positionById.get(target.id) || projectLonLat(target.lng, target.lat, width, height, padding);
        const screenA = toScreenPosition(a);
        const screenB = toScreenPosition(b);
        const line = createSvgElement('line', {
          x1: screenA.x,
          y1: screenA.y,
          x2: screenB.x,
          y2: screenB.y,
          class: 'map-institution-link',
          'stroke-width': mapRange(link.count, 1, maxCount, 0.8, 4),
          'data-source': link.source,
          'data-target': link.target,
          'data-source-id': source.id,
          'data-target-id': target.id
        });
        const title = createSvgElement('title');
        title.textContent = `${link.source} ↔ ${link.target}: ${link.count} 条引用联系`;
        line.appendChild(title);
        linkLayer.appendChild(line);
      });
    }

    function renderPoints() {
      pointLayer.innerHTML = '';
      labelLayer.innerHTML = '';
      const colorMode = colorModeEl.value;
      const sizeMode = sizeModeEl.value;
      const visible = getVisibleInstitutions();
      visibleIds = new Set(visible.map((item) => item.id));
      positionById = computePointPositions(visible);
      const values = visible.map((item) => Number(item[sizeMode]) || 0);
      const minValue = Math.min(...values);
      const maxValue = Math.max(...values);
      const topLabels = new Set(
        visible
          .slice()
          .sort((a, b) => b.influence_score - a.influence_score)
          .slice(0, 10)
          .map((item) => item.id)
      );

      visible.forEach((item) => {
        const position = positionById.get(item.id) || projectLonLat(item.lng, item.lat, width, height, padding);
        const screen = toScreenPosition(position);
        const radius = mapRange(Number(item[sizeMode]) || 0, minValue, maxValue, 3, 10);
        const color = colorByMode(item, colorMode);
        const group = createSvgElement('g', {
          class: 'map-point-group',
          'data-id': item.id,
          transform: `translate(${screen.x} ${screen.y})`
        });
        group.setAttribute('tabindex', '0');
        group.setAttribute('role', 'button');
        group.addEventListener('pointerdown', (event) => event.stopPropagation());
        group.addEventListener('click', () => setAppState({ selectedInstitutionId: item.id }, 'institution-map'));
        group.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setAppState({ selectedInstitutionId: item.id }, 'institution-map');
          }
        });

        const symbol = createSymbol(item, radius, color);
        symbol.setAttribute('data-id', item.id);
        const title = createSvgElement('title');
        title.textContent = `${item.institution}\n${item.country}\n${sizeMode}: ${item[sizeMode]}`;
        symbol.appendChild(title);
        group.appendChild(symbol);
        pointLayer.appendChild(group);

        if (topLabels.has(item.id)) {
          const label = createSvgElement('text', {
            class: 'map-label',
            'data-id': item.id,
            'data-radius': radius
          });
          label.textContent = item.institution;
          labelLayer.appendChild(label);
        }
      });

      statEl.textContent = `可见机构: ${visible.length}/${institutions.length} | 联系数: ${instLinks.length} | 颜色: ${colorMode} | 大小: ${sizeMode}`;
      renderLegend();
      renderLinks();
      renderSelectedInstitution();
      updateOverlayPositions();
    }

    function handleZoomChange() {
      const bucket = zoomBucket();
      if (bucket !== lastZoomBucket) {
        lastZoomBucket = bucket;
        renderPoints();
      }
    }

    colorModeEl.addEventListener('change', renderPoints);
    sizeModeEl.addEventListener('change', renderPoints);
    spreadToggle.addEventListener('change', renderPoints);
    linkToggle.addEventListener('change', () => {
      renderLinks();
      renderSelectedInstitution();
    });
    onAppStateChange(() => {
      renderPoints();
      renderSelectedInstitution();
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
      handleZoomChange();
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
    svg.addEventListener('pointerup', () => {
      panning = null;
    });
    svg.addEventListener('pointerleave', () => {
      panning = null;
    });
    applyTransform();
    lastZoomBucket = zoomBucket();
    renderPoints();
  } catch (error) {
    statEl.textContent = '数据加载失败，请检查 institutions_geo.json、nodes.json、edges.json 与 world.geojson';
    svg.innerHTML = '';
  }
}
