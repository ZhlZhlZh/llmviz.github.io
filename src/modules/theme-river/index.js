import { loadJson } from '../../shared/data-loader.js';

const STREAM_COLORS = [
  '#3b82f6',
  '#ef4444',
  '#f59e0b',
  '#10b981',
  '#8b5cf6',
  '#14b8a6',
  '#f97316',
  '#6366f1'
];

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgElement(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => {
    el.setAttribute(key, String(value));
  });
  return el;
}

function mapRange(value, domainMin, domainMax, rangeMin, rangeMax) {
  if (domainMax === domainMin) {
    return (rangeMin + rangeMax) / 2;
  }
  const t = (value - domainMin) / (domainMax - domainMin);
  return rangeMin + t * (rangeMax - rangeMin);
}

function buildAreaPath(topPoints, bottomPoints) {
  if (!topPoints.length) {
    return '';
  }
  const head = `M ${topPoints[0].x} ${topPoints[0].y}`;
  const topPath = topPoints
    .slice(1)
    .map((point) => `L ${point.x} ${point.y}`)
    .join(' ');
  const bottomPath = bottomPoints
    .slice()
    .reverse()
    .map((point) => `L ${point.x} ${point.y}`)
    .join(' ');
  return `${head} ${topPath} ${bottomPath} Z`;
}

function toKeywordSeries(records) {
  const yearSet = new Set();
  const keywordMap = new Map();

  records.forEach((item) => {
    yearSet.add(item.year);
    if (!keywordMap.has(item.keyword)) {
      keywordMap.set(item.keyword, new Map());
    }
    keywordMap.get(item.keyword).set(item.year, item.count);
  });

  const years = Array.from(yearSet).sort((a, b) => a - b);
  const totalsByKeyword = Array.from(keywordMap.entries()).map(([keyword, byYear]) => {
    let total = 0;
    years.forEach((year) => {
      total += byYear.get(year) || 0;
    });
    return { keyword, total };
  });

  const topKeywords = totalsByKeyword
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
    .map((item) => item.keyword);

  const series = topKeywords.map((keyword) => {
    const byYear = keywordMap.get(keyword);
    return {
      keyword,
      values: years.map((year) => byYear.get(year) || 0)
    };
  });

  return { years, series };
}

function buildTopKeywordsForYear(series, yearIndex) {
  return series
    .map((item) => ({ keyword: item.keyword, count: item.values[yearIndex] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
}

export async function initThemeRiver(container) {
  if (!container) {
    return;
  }

  container.innerHTML = `
    <div class="module-shell">
      <p class="module-tag">Module 01</p>
      <h3 class="module-title">主题河流图</h3>
      <p class="module-subtitle">关键词热度随时间演化，演示从奠基期到智能体阶段的主题迁移。</p>
      <div class="chart-toolbar">
        <label class="chart-control">
          年份
          <input class="chart-range" type="range" min="0" max="0" step="1" value="0" />
        </label>
        <div class="chart-stat" aria-live="polite">加载中...</div>
      </div>
      <div class="module-canvas chart-canvas">
        <svg class="chart-svg" viewBox="0 0 860 300" role="img" aria-label="Theme river chart"></svg>
      </div>
      <div class="legend-row chart-legend"></div>
    </div>
  `;

  const slider = container.querySelector('.chart-range');
  const statEl = container.querySelector('.chart-stat');
  const svg = container.querySelector('.chart-svg');
  const legendEl = container.querySelector('.chart-legend');

  if (!slider || !statEl || !svg || !legendEl) {
    return;
  }

  try {
    const data = await loadJson('./data/processed/keyword_trends.json');
    const { years, series } = toKeywordSeries(data);

    const width = 860;
    const height = 300;
    const margin = { top: 18, right: 16, bottom: 34, left: 42 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const totalsByYear = years.map((_, yearIndex) => {
      return series.reduce((sum, item) => sum + item.values[yearIndex], 0);
    });
    const maxTotal = Math.max(...totalsByYear, 1);

    const rootGroup = createSvgElement('g', {
      transform: `translate(${margin.left}, ${margin.top})`
    });
    svg.appendChild(rootGroup);

    const gridGroup = createSvgElement('g');
    rootGroup.appendChild(gridGroup);

    const yTicks = 4;
    for (let i = 0; i <= yTicks; i += 1) {
      const y = mapRange(i, 0, yTicks, 0, innerHeight);
      const line = createSvgElement('line', {
        x1: 0,
        y1: y,
        x2: innerWidth,
        y2: y,
        class: 'chart-grid-line'
      });
      gridGroup.appendChild(line);
    }

    const areaGroup = createSvgElement('g');
    rootGroup.appendChild(areaGroup);

    const cumulativeByYear = new Array(years.length).fill(0);
    const areaPaths = [];

    series.forEach((item, seriesIndex) => {
      const topPoints = [];
      const bottomPoints = [];

      years.forEach((year, yearIndex) => {
        const total = totalsByYear[yearIndex];
        const baseline = (maxTotal - total) / 2;
        const y0 = baseline + cumulativeByYear[yearIndex];
        const y1 = y0 + item.values[yearIndex];
        cumulativeByYear[yearIndex] += item.values[yearIndex];

        const x = mapRange(year, years[0], years[years.length - 1], 0, innerWidth);
        const topY = mapRange(y1, 0, maxTotal, innerHeight, 0);
        const bottomY = mapRange(y0, 0, maxTotal, innerHeight, 0);

        topPoints.push({ x, y: topY });
        bottomPoints.push({ x, y: bottomY });
      });

      const areaPath = createSvgElement('path', {
        d: buildAreaPath(topPoints, bottomPoints),
        fill: STREAM_COLORS[seriesIndex % STREAM_COLORS.length],
        'fill-opacity': 0.72,
        stroke: '#ffffff',
        'stroke-width': 0.8,
        class: 'theme-river-area'
      });
      areaPath.setAttribute('data-keyword', item.keyword);
      areaGroup.appendChild(areaPath);
      areaPaths.push(areaPath);
    });

    const axisGroup = createSvgElement('g');
    rootGroup.appendChild(axisGroup);

    years.forEach((year, index) => {
      if (index % 2 !== 0 && index !== years.length - 1) {
        return;
      }
      const x = mapRange(year, years[0], years[years.length - 1], 0, innerWidth);
      const tick = createSvgElement('line', {
        x1: x,
        y1: innerHeight,
        x2: x,
        y2: innerHeight + 5,
        class: 'chart-axis-line'
      });
      axisGroup.appendChild(tick);

      const label = createSvgElement('text', {
        x,
        y: innerHeight + 18,
        'text-anchor': 'middle',
        class: 'chart-axis-label'
      });
      label.textContent = String(year);
      axisGroup.appendChild(label);
    });

    const focusLine = createSvgElement('line', {
      x1: 0,
      y1: 0,
      x2: 0,
      y2: innerHeight,
      class: 'chart-focus-line'
    });
    rootGroup.appendChild(focusLine);

    const chips = series.map((item, index) => {
      const chip = document.createElement('span');
      chip.className = `legend-chip chart-color-${index % STREAM_COLORS.length}`;
      chip.textContent = item.keyword;
      legendEl.appendChild(chip);
      return chip;
    });

    slider.min = '0';
    slider.max = String(Math.max(years.length - 1, 0));
    slider.value = String(Math.max(years.length - 1, 0));

    function updateFocus() {
      const yearIndex = Number(slider.value);
      const year = years[yearIndex];
      const x = mapRange(year, years[0], years[years.length - 1], 0, innerWidth);
      focusLine.setAttribute('x1', String(x));
      focusLine.setAttribute('x2', String(x));

      const topKeywords = buildTopKeywordsForYear(series, yearIndex);
      statEl.textContent = `${year}年 Top: ${topKeywords
        .map((item) => `${item.keyword} (${item.count})`)
        .join(' | ')}`;

      const topKeywordSet = new Set(topKeywords.map((item) => item.keyword));
      areaPaths.forEach((path) => {
        const keyword = path.getAttribute('data-keyword');
        const active = keyword && topKeywordSet.has(keyword);
        path.setAttribute('fill-opacity', active ? '0.9' : '0.35');
      });
      chips.forEach((chip) => {
        const active = topKeywordSet.has(chip.textContent || '');
        chip.classList.toggle('legend-chip-active', active);
      });
    }

    slider.addEventListener('input', updateFocus);
    updateFocus();
  } catch (error) {
    statEl.textContent = '数据加载失败，请检查 data/processed/keyword_trends.json';
    svg.innerHTML = '';
  }
}
