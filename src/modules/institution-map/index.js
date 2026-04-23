import { loadJson } from '../../shared/data-loader.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgElement(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => {
    el.setAttribute(key, String(value));
  });
  return el;
}

function projectLonLat(lon, lat, width, height, padding) {
  const x = padding + ((lon + 180) / 360) * (width - padding * 2);
  const y = padding + ((90 - lat) / 180) * (height - padding * 2);
  return { x, y };
}

function polygonToPath(rings, width, height, padding) {
  return rings
    .map((ring) => {
      if (!ring.length) {
        return '';
      }
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
  if (!geometry) {
    return '';
  }

  if (geometry.type === 'Polygon') {
    return polygonToPath(geometry.coordinates, width, height, padding);
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates
      .map((polygon) => polygonToPath(polygon, width, height, padding))
      .join(' ');
  }

  return '';
}

function mapRange(value, domainMin, domainMax, rangeMin, rangeMax) {
  if (domainMin === domainMax) {
    return (rangeMin + rangeMax) / 2;
  }
  const t = (value - domainMin) / (domainMax - domainMin);
  return rangeMin + t * (rangeMax - rangeMin);
}

function colorByMode(item, mode) {
  if (mode === 'org_type') {
    if (item.org_type === 'university') {
      return '#16a34a';
    }
    if (item.org_type === 'company') {
      return '#ea580c';
    }
    return '#7c3aed';
  }
  return item.community === 'chinese' ? '#dc2626' : '#2563eb';
}

function createSymbol(item, x, y, radius, color) {
  if (item.org_type === 'university') {
    return createSvgElement('rect', {
      x: x - radius,
      y: y - radius,
      width: radius * 2,
      height: radius * 2,
      fill: color,
      class: 'map-point'
    });
  }

  if (item.org_type === 'research_lab') {
    const d = `M ${x} ${y - radius} L ${x + radius} ${y + radius} L ${x - radius} ${y + radius} Z`;
    return createSvgElement('path', {
      d,
      fill: color,
      class: 'map-point'
    });
  }

  return createSvgElement('circle', {
    cx: x,
    cy: y,
    r: radius,
    fill: color,
    class: 'map-point'
  });
}

export async function initInstitutionMap(container) {
  if (!container) {
    return;
  }

  container.innerHTML = `
    <div class="module-shell">
      <p class="module-tag">Module 04</p>
      <h3 class="module-title">机构影响力世界地图</h3>
      <p class="module-subtitle">在世界底图上比较机构影响力、社区属性与组织类型差异。</p>
      <div class="chart-toolbar chart-toolbar-wrap">
        <label class="chart-control">
          颜色维度
          <select class="chart-select map-color-mode">
            <option value="community">community</option>
            <option value="org_type">org_type</option>
          </select>
        </label>
        <label class="chart-control">
          大小维度
          <select class="chart-select map-size-mode">
            <option value="influence_score">influence_score</option>
            <option value="citations_count">citations_count</option>
            <option value="papers_count">papers_count</option>
          </select>
        </label>
        <div class="chart-stat" aria-live="polite">加载中...</div>
      </div>
      <div class="module-canvas chart-canvas">
        <svg class="chart-svg" viewBox="0 0 860 420" role="img" aria-label="Institution world map scatter chart"></svg>
      </div>
      <div class="legend-row">
        <span class="legend-chip">圆形 = company</span>
        <span class="legend-chip">方形 = university</span>
        <span class="legend-chip">三角 = research_lab</span>
      </div>
    </div>
  `;

  const colorModeEl = container.querySelector('.map-color-mode');
  const sizeModeEl = container.querySelector('.map-size-mode');
  const statEl = container.querySelector('.chart-stat');
  const svg = container.querySelector('.chart-svg');

  if (!colorModeEl || !sizeModeEl || !statEl || !svg) {
    return;
  }

  try {
    const [world, institutions] = await Promise.all([
      loadJson('./public/world.geojson'),
      loadJson('./data/processed/institutions_geo.json')
    ]);

    const width = 860;
    const height = 420;
    const padding = 18;

    const mapLayer = createSvgElement('g');
    const pointLayer = createSvgElement('g');
    svg.appendChild(mapLayer);
    svg.appendChild(pointLayer);

    (world.features || []).forEach((feature) => {
      const pathData = geometryToPath(feature.geometry, width, height, padding);
      if (!pathData) {
        return;
      }
      const path = createSvgElement('path', {
        d: pathData,
        class: 'world-land'
      });
      mapLayer.appendChild(path);
    });

    function renderPoints() {
      pointLayer.innerHTML = '';

      const colorMode = colorModeEl.value;
      const sizeMode = sizeModeEl.value;

      const values = institutions.map((item) => Number(item[sizeMode]) || 0);
      const minValue = Math.min(...values);
      const maxValue = Math.max(...values);

      institutions.forEach((item) => {
        const { x, y } = projectLonLat(item.lng, item.lat, width, height, padding);
        const radius = mapRange(Number(item[sizeMode]) || 0, minValue, maxValue, 4, 12);
        const color = colorByMode(item, colorMode);
        const symbol = createSymbol(item, x, y, radius, color);

        const title = createSvgElement('title');
        title.textContent = `${item.institution}\n${item.country}\n${sizeMode}: ${item[sizeMode]}`;
        symbol.appendChild(title);

        pointLayer.appendChild(symbol);
      });

      statEl.textContent = `机构数: ${institutions.length} | 颜色: ${colorMode} | 大小: ${sizeMode}`;
    }

    colorModeEl.addEventListener('change', renderPoints);
    sizeModeEl.addEventListener('change', renderPoints);
    renderPoints();
  } catch (error) {
    statEl.textContent = '数据加载失败，请检查 institutions_geo.json 与 world.geojson';
    svg.innerHTML = '';
  }
}
