import { loadJson } from '../../shared/data-loader.js';
import { getAppState, onAppStateChange, phaseLabelByYear, setAppState } from '../../shared/app-state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STREAM_COLORS = [
  '#176b87',
  '#d97706',
  '#7c3aed',
  '#16a34a',
  '#dc2626',
  '#2563eb',
  '#0891b2',
  '#be123c',
  '#4f46e5',
  '#0f766e',
  '#b45309',
  '#475569'
];

function createSvgElement(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
  return el;
}

function mapRange(value, domainMin, domainMax, rangeMin, rangeMax) {
  if (domainMax === domainMin) return (rangeMin + rangeMax) / 2;
  const t = (value - domainMin) / (domainMax - domainMin);
  return rangeMin + t * (rangeMax - rangeMin);
}

function buildAreaPath(topPoints, bottomPoints) {
  if (!topPoints.length) return '';
  const topPath = topPoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const bottomPath = bottomPoints
    .slice()
    .reverse()
    .map((point) => `L ${point.x} ${point.y}`)
    .join(' ');
  return `${topPath} ${bottomPath} Z`;
}

function toKeywordSeries(records) {
  const years = Array.from(new Set(records.map((item) => item.year))).sort((a, b) => a - b);
  const byKeyword = new Map();

  records.forEach((item) => {
    if (!byKeyword.has(item.keyword)) byKeyword.set(item.keyword, new Map());
    byKeyword.get(item.keyword).set(item.year, item.count);
  });

  return Array.from(byKeyword.entries())
    .map(([keyword, byYear]) => ({
      keyword,
      total: years.reduce((sum, year) => sum + (byYear.get(year) || 0), 0),
      values: years.map((year) => byYear.get(year) || 0)
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12)
    .map((item) => ({ ...item, years }));
}

function topKeywordsForYear(series, yearIndex) {
  return series
    .map((item) => ({ keyword: item.keyword, count: item.values[yearIndex] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);
}

export async function initThemeRiver(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="module-shell">
      <p class="module-tag">Module 01</p>
      <h3 class="module-title">主题河流图</h3>
      <p class="module-subtitle">拖动年份查看年度热点；点击某条河流可像 NameVoyager 一样单独聚焦该主题，再次点击或清除恢复总览。</p>
      <div class="chart-toolbar chart-toolbar-wrap">
        <label class="chart-control river-year-control">
          年份
          <input class="chart-range river-year-range" type="range" min="0" max="0" step="1" value="0" />
          <output class="year-badge river-year-output">2026</output>
        </label>
        <button class="chart-button river-clear-button" type="button">显示全部主题</button>
        <div class="chart-stat" aria-live="polite">加载中...</div>
      </div>
      <div class="module-canvas chart-canvas">
        <svg class="chart-svg" viewBox="0 0 900 340" role="img" aria-label="Theme river chart"></svg>
      </div>
      <div class="chart-detail theme-river-detail"></div>
      <div class="legend-row chart-legend"></div>
    </div>
  `;

  const slider = container.querySelector('.river-year-range');
  const yearOutput = container.querySelector('.river-year-output');
  const clearButton = container.querySelector('.river-clear-button');
  const statEl = container.querySelector('.chart-stat');
  const svg = container.querySelector('.chart-svg');
  const legendEl = container.querySelector('.chart-legend');
  const detailEl = container.querySelector('.theme-river-detail');

  if (!slider || !yearOutput || !clearButton || !statEl || !svg || !legendEl || !detailEl) return;

  try {
    const records = await loadJson('./data/processed/keyword_trends.json');
    const allSeries = toKeywordSeries(records);
    const years = allSeries[0]?.years || [];
    let focusedKeyword = null;

    const width = 900;
    const height = 340;
    const margin = { top: 24, right: 30, bottom: 42, left: 42 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const root = createSvgElement('g', { transform: `translate(${margin.left}, ${margin.top})` });
    const gridGroup = createSvgElement('g');
    const areaGroup = createSvgElement('g');
    const labelGroup = createSvgElement('g');
    const axisGroup = createSvgElement('g');
    root.append(gridGroup, areaGroup, labelGroup, axisGroup);
    svg.appendChild(root);

    for (let i = 0; i <= 4; i += 1) {
      const y = mapRange(i, 0, 4, 0, innerHeight);
      gridGroup.appendChild(createSvgElement('line', {
        x1: 0,
        y1: y,
        x2: innerWidth,
        y2: y,
        class: 'chart-grid-line'
      }));
    }

    years.forEach((year, index) => {
      const x = mapRange(year, years[0], years[years.length - 1], 0, innerWidth);
      if (index % 2 === 0 || index === years.length - 1) {
        axisGroup.appendChild(createSvgElement('line', {
          x1: x,
          y1: innerHeight,
          x2: x,
          y2: innerHeight + 6,
          class: 'chart-axis-line'
        }));
        const label = createSvgElement('text', {
          x,
          y: innerHeight + 22,
          'text-anchor': 'middle',
          class: 'chart-axis-label'
        });
        label.textContent = String(year);
        axisGroup.appendChild(label);
      }
    });

    const focusLine = createSvgElement('line', {
      x1: 0,
      y1: 0,
      x2: 0,
      y2: innerHeight,
      class: 'chart-focus-line'
    });
    root.appendChild(focusLine);

    slider.min = '0';
    slider.max = String(Math.max(years.length - 1, 0));
    const initialIndex = years.indexOf(getAppState().year);
    slider.value = String(initialIndex >= 0 ? initialIndex : years.length - 1);

    function activeSeries() {
      return focusedKeyword
        ? allSeries.filter((item) => item.keyword === focusedKeyword)
        : allSeries;
    }

    function renderRiver() {
      areaGroup.innerHTML = '';
      labelGroup.innerHTML = '';
      legendEl.innerHTML = '';

      const series = activeSeries();
      const totalsByYear = years.map((_, yearIndex) =>
        series.reduce((sum, item) => sum + item.values[yearIndex], 0)
      );
      const maxTotal = Math.max(...totalsByYear, 1);
      const cumulativeByYear = new Array(years.length).fill(0);

      series.forEach((item) => {
        const sourceIndex = allSeries.findIndex((seriesItem) => seriesItem.keyword === item.keyword);
        const color = STREAM_COLORS[sourceIndex % STREAM_COLORS.length];
        const topPoints = [];
        const bottomPoints = [];
        let peak = { index: 0, value: -1, y: 0 };

        years.forEach((year, yearIndex) => {
          const total = totalsByYear[yearIndex];
          const centeredBaseline = focusedKeyword ? 0 : (maxTotal - total) / 2;
          const y0 = centeredBaseline + cumulativeByYear[yearIndex];
          const y1 = y0 + item.values[yearIndex];
          cumulativeByYear[yearIndex] += item.values[yearIndex];

          const x = mapRange(year, years[0], years[years.length - 1], 0, innerWidth);
          const topY = mapRange(y1, 0, maxTotal, innerHeight, 0);
          const bottomY = mapRange(y0, 0, maxTotal, innerHeight, 0);
          topPoints.push({ x, y: topY });
          bottomPoints.push({ x, y: bottomY });

          if (item.values[yearIndex] > peak.value) {
            peak = { index: yearIndex, value: item.values[yearIndex], y: (topY + bottomY) / 2 };
          }
        });

        const area = createSvgElement('path', {
          d: buildAreaPath(topPoints, bottomPoints),
          fill: color,
          'fill-opacity': focusedKeyword && focusedKeyword !== item.keyword ? 0.15 : 0.74,
          stroke: '#ffffff',
          'stroke-width': 1,
          class: focusedKeyword === item.keyword ? 'theme-river-area is-focused' : 'theme-river-area',
          'data-keyword': item.keyword
        });
        area.addEventListener('click', () => {
          focusedKeyword = focusedKeyword === item.keyword ? null : item.keyword;
          renderRiver();
          updateFocus(false);
        });
        area.addEventListener('mouseenter', () => {
          const peakYear = years[peak.index];
          detailEl.innerHTML = `<strong>${item.keyword}</strong> 的峰值出现在 ${peakYear} 年，热度 ${peak.value}；点击河流可单独查看该主题曲线。`;
        });
        areaGroup.appendChild(area);

        const label = createSvgElement('text', {
          x: mapRange(years[peak.index], years[0], years[years.length - 1], 0, innerWidth),
          y: peak.y,
          'text-anchor': 'middle',
          class: 'theme-river-label'
        });
        label.textContent = item.keyword;
        labelGroup.appendChild(label);

        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `legend-chip chart-color-${sourceIndex % STREAM_COLORS.length}`;
        chip.textContent = item.keyword;
        chip.addEventListener('click', () => {
          focusedKeyword = focusedKeyword === item.keyword ? null : item.keyword;
          renderRiver();
          updateFocus(false);
        });
        legendEl.appendChild(chip);
      });
    }

    function updateFocus(shouldPublish = true) {
      const yearIndex = Number(slider.value);
      const year = years[yearIndex];
      const x = mapRange(year, years[0], years[years.length - 1], 0, innerWidth);
      focusLine.setAttribute('x1', String(x));
      focusLine.setAttribute('x2', String(x));
      yearOutput.textContent = String(year);

      const top = topKeywordsForYear(activeSeries(), yearIndex);
      statEl.textContent = focusedKeyword
        ? `${year} 年 · ${focusedKeyword}: ${top[0]?.count ?? 0}`
        : `${year} 年 Top: ${top.map((item) => `${item.keyword} ${item.count}`).join(' | ')}`;
      detailEl.innerHTML = focusedKeyword
        ? `<strong>${focusedKeyword}</strong> 单主题模式：拖动年份可查看该主题热度如何上升、回落或保持平台期。`
        : `<strong>${phaseLabelByYear(year)}</strong>：${year} 年最突出的主题是 ${top.map((item) => item.keyword).join('、')}。`;

      if (shouldPublish) setAppState({ year }, 'theme-river');
    }

    slider.addEventListener('input', () => updateFocus(true));
    clearButton.addEventListener('click', () => {
      focusedKeyword = null;
      renderRiver();
      updateFocus(false);
    });
    onAppStateChange(({ state, source }) => {
      if (source === 'theme-river') return;
      const yearIndex = years.indexOf(state.year);
      if (yearIndex >= 0 && slider.value !== String(yearIndex)) {
        slider.value = String(yearIndex);
        updateFocus(false);
      }
    });

    renderRiver();
    updateFocus(false);
  } catch (error) {
    statEl.textContent = '数据加载失败，请检查 data/processed/keyword_trends.json';
    svg.innerHTML = '';
  }
}
