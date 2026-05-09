import { loadJson } from '../../shared/data-loader.js';
import { getAppState, onAppStateChange, phaseLabelByYear, setAppState } from '../../shared/app-state.js';
import { themePapers, topThemePaper } from '../../shared/theme-filter.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STREAM_COLORS = [
  '#2563eb', '#dc2626', '#d97706', '#16a34a', '#7c3aed', '#0891b2',
  '#be123c', '#4f46e5', '#0f766e', '#b45309', '#475569', '#9333ea',
  '#15803d', '#c2410c', '#0ea5e9', '#f97316', '#84cc16', '#e11d48',
  '#14b8a6', '#8b5cf6', '#64748b', '#ca8a04', '#0284c7', '#db2777',
  '#22c55e', '#a855f7', '#f59e0b', '#06b6d4', '#ef4444', '#10b981'
];
const TOPIC_SELECTION_TEXT = '主题选取：上层分类参考 LLM Survey、Stanford Foundation Models 报告、HELM 与 NIST GenAI Profile 中反复出现的 pre-training、adaptation、utilization、evaluation、systems、data、risk 轴；条带再细分为同级 LLM 研究主题簇，并用 OpenAlex works 按年度分组统计。纵轴使用 OpenAlex group_by 返回的原始 count。';

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

function formatTick(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(value));
}

function formatZoom(value) {
  return `${Number(value).toFixed(2).replace(/\.00$/, '').replace(/0$/, '')}x`;
}

function estimateTextWidth(text) {
  return text.length * 7.2 + 18;
}

function labelPositionForRiver(topPoints, bottomPoints, label) {
  const minThickness = 22;
  const labelWidth = estimateTextWidth(label);
  const middleX = topPoints[Math.floor(topPoints.length / 2)]?.x ?? 0;
  const runs = [];
  let run = [];

  topPoints.forEach((point, index) => {
    const bottom = bottomPoints[index];
    const thickness = bottom.y - point.y;
    if (thickness >= minThickness) {
      run.push({ index, x: point.x, y: (point.y + bottom.y) / 2, thickness });
    } else if (run.length) {
      runs.push(run);
      run = [];
    }
  });
  if (run.length) runs.push(run);

  const candidates = runs.map((items) => {
    const first = items[0];
    const last = items[items.length - 1];
    const width = Math.max(last.x - first.x, 72);
    const center = items[Math.floor(items.length / 2)];
    const weightedY = items.reduce((sum, item) => sum + item.y * item.thickness, 0) /
      items.reduce((sum, item) => sum + item.thickness, 0);
    return {
      x: (first.x + last.x) / 2,
      y: weightedY || center.y,
      width,
      textLength: Math.min(labelWidth, Math.max(72, width - 18)),
      score: width + center.thickness * 6 - Math.abs(((first.x + last.x) / 2) - middleX) * 0.2
    };
  }).sort((a, b) => b.score - a.score);

  return candidates[0] || null;
}

function smoothLinePath(points) {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const commands = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 0; i < points.length - 1; i += 1) {
    const current = points[i];
    const next = points[i + 1];
    commands.push(`Q ${current.x} ${current.y} ${(current.x + next.x) / 2} ${(current.y + next.y) / 2}`);
  }
  const last = points[points.length - 1];
  commands.push(`T ${last.x} ${last.y}`);
  return commands.join(' ');
}

function buildAreaPath(topPoints, bottomPoints) {
  if (!topPoints.length) return '';
  const topPath = smoothLinePath(topPoints);
  const reversedBottom = bottomPoints.slice().reverse();
  const bottomPath = smoothLinePath(reversedBottom).replace(/^M\s[-.\d]+\s[-.\d]+/, `L ${reversedBottom[0].x} ${reversedBottom[0].y}`);
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
      values: years.map((year) => byYear.get(year) || 0),
      years
    }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total);
}

function yearRanking(series, yearIndex) {
  return series
    .map((item) => ({ keyword: item.keyword, count: item.values[yearIndex] || 0 }))
    .sort((a, b) => b.count - a.count)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function topKeywordsForYear(series, yearIndex) {
  return yearRanking(series, yearIndex).slice(0, 5);
}

export async function initThemeRiver(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="module-shell">
      <p class="module-tag">Module 01</p>
      <h3 class="module-title">LLM 主题河流图</h3>
      <p class="module-subtitle">参考 NameVoyager 的连续河流样式，展示 OpenAlex 中 LLM 研究主题年度作品数的迁移。</p>
      <div class="chart-toolbar chart-toolbar-wrap">
        <label class="chart-control river-year-control">
          年份
          <input class="chart-range river-year-range" type="range" min="0" max="0" step="1" value="0" />
          <output class="year-badge river-year-output">2025</output>
        </label>
        <label class="chart-control river-filter-control">
          筛选
          <select class="chart-select river-filter-select">
            <option value="0">显示全部主题</option>
            <option value="3">隐藏最大 3 条</option>
            <option value="5">隐藏最大 5 条</option>
            <option value="10">隐藏最大 10 条</option>
            <option value="custom">自定义</option>
          </select>
          <input class="chart-number river-filter-number" type="number" min="0" max="46" step="1" value="0" aria-label="自定义隐藏最大主题数量" />
        </label>
        <label class="chart-control river-zoom-control">
          缩放
          <input class="chart-range river-zoom-range" type="range" min="1" max="5" step="0.25" value="1" />
          <output class="year-badge river-zoom-output">1x</output>
        </label>
        <button class="chart-button river-clear-button" type="button">重置视图</button>
        <div class="chart-stat" aria-live="polite">加载中...</div>
      </div>
      <div class="theme-river-explore-layout">
        <div class="module-canvas chart-canvas theme-river-canvas">
          <div class="theme-river-canvas-inner">
            <svg class="chart-svg" viewBox="0 0 900 390" role="img" aria-label="LLM theme river chart"></svg>
            <div class="theme-river-tooltip" hidden></div>
          </div>
        </div>
        <aside class="theme-river-explore-card">
          <p class="scenario-kicker">联动探索</p>
          <h4 class="scenario-title river-explore-title">先选择一条主题河流</h4>
          <p class="scenario-copy river-explore-copy">点击河流后，可以把该主题同步到下方论文网络、影响路径、机构地图和地铁图。</p>
          <button class="chart-button river-explore-button" type="button" disabled>探索该主题</button>
        </aside>
      </div>
      <div class="chart-detail theme-river-detail"></div>
    </div>
  `;

  const slider = container.querySelector('.river-year-range');
  const yearOutput = container.querySelector('.river-year-output');
  const filterSelect = container.querySelector('.river-filter-select');
  const filterNumber = container.querySelector('.river-filter-number');
  const zoomSlider = container.querySelector('.river-zoom-range');
  const zoomOutput = container.querySelector('.river-zoom-output');
  const clearButton = container.querySelector('.river-clear-button');
  const statEl = container.querySelector('.chart-stat');
  const svg = container.querySelector('.chart-svg');
  const tooltip = container.querySelector('.theme-river-tooltip');
  const detailEl = container.querySelector('.theme-river-detail');
  const exploreTitle = container.querySelector('.river-explore-title');
  const exploreCopy = container.querySelector('.river-explore-copy');
  const exploreButton = container.querySelector('.river-explore-button');

  if (!slider || !yearOutput || !filterSelect || !filterNumber || !zoomSlider || !zoomOutput || !clearButton || !statEl || !svg || !tooltip || !detailEl || !exploreTitle || !exploreCopy || !exploreButton) return;

  try {
    const [records, nodes] = await Promise.all([
      loadJson('./data/processed/keyword_trends.json'),
      loadJson('./data/processed/nodes.json')
    ]);
    const allSeries = toKeywordSeries(records);
    const years = allSeries[0]?.years || [];
    let focusedKeyword = null;
    let hiddenTopCount = 0;
    let zoomLevel = 1;

    const width = 900;
    const height = 390;
    const margin = { top: 24, right: 96, bottom: 44, left: 24 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const root = createSvgElement('g', { transform: `translate(${margin.left}, ${margin.top})` });
    const gridGroup = createSvgElement('g');
    const areaGroup = createSvgElement('g');
    const labelGroup = createSvgElement('g');
    const axisGroup = createSvgElement('g');
    const yAxisGroup = createSvgElement('g');
    root.append(gridGroup, areaGroup, labelGroup, axisGroup, yAxisGroup);
    svg.appendChild(root);
    const clipId = `theme-river-clip-${Math.random().toString(36).slice(2)}`;
    const defs = createSvgElement('defs');
    const clipPath = createSvgElement('clipPath', { id: clipId });
    clipPath.appendChild(createSvgElement('rect', {
      x: 0,
      y: 0,
      width: innerWidth,
      height: innerHeight
    }));
    defs.appendChild(clipPath);
    svg.appendChild(defs);
    areaGroup.setAttribute('clip-path', `url(#${clipId})`);

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
    filterNumber.max = String(Math.max(allSeries.length - 1, 0));
    const initialIndex = years.indexOf(getAppState().year);
    slider.value = String(initialIndex >= 0 ? initialIndex : years.length - 1);

    function setHiddenTopCount(value) {
      hiddenTopCount = Math.max(0, Math.min(allSeries.length - 1, Number(value) || 0));
      filterNumber.value = String(hiddenTopCount);
      filterSelect.value = ['0', '3', '5', '10'].includes(String(hiddenTopCount)) ? String(hiddenTopCount) : 'custom';
    }

    function activeSeries() {
      if (focusedKeyword) return allSeries.filter((item) => item.keyword === focusedKeyword);
      const hidden = new Set(allSeries.slice(0, hiddenTopCount).map((item) => item.keyword));
      return allSeries.filter((item) => !hidden.has(item.keyword));
    }

    function updateExploreCard() {
      const selected = focusedKeyword;
      const papers = selected ? themePapers(nodes, selected) : [];
      exploreButton.disabled = !selected || papers.length === 0;
      exploreTitle.textContent = selected ? `探索：${selected}` : '先选择一条主题河流';
      exploreCopy.textContent = selected
        ? `将下方图表刷新为该主题相关论文：论文网络显示 ${papers.length} 篇，路径图以最高引用论文为中心，机构图和地铁图继续联动。`
        : '点击河流后，可以把该主题同步到下方论文网络、影响路径、机构地图和地铁图。';
    }

    function publishThemeExplore() {
      if (!focusedKeyword) return;
      const paper = topThemePaper(nodes, focusedKeyword);
      setAppState({
        selectedTheme: focusedKeyword,
        selectedPaperId: paper?.id || null,
        year: paper?.year || years[Number(slider.value)] || getAppState().year,
        yearRangeStart: years[0],
        yearRangeEnd: years[Number(slider.value)] || getAppState().year
      }, 'theme-river-explore');
      document.getElementById('section-force')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function drawYAxis(yDomainMax) {
      gridGroup.innerHTML = '';
      yAxisGroup.innerHTML = '';
      for (let i = 0; i <= 5; i += 1) {
        const value = (yDomainMax * i) / 5;
        const y = mapRange(value, 0, yDomainMax, innerHeight, 0);
        gridGroup.appendChild(createSvgElement('line', {
          x1: 0,
          y1: y,
          x2: innerWidth,
          y2: y,
          class: 'chart-grid-line'
        }));
        const tick = createSvgElement('text', {
          x: innerWidth + 10,
          y: y + 4,
          'text-anchor': 'start',
          class: 'chart-axis-label'
        });
        tick.textContent = formatTick(value);
        yAxisGroup.appendChild(tick);
      }
      yAxisGroup.appendChild(createSvgElement('line', {
        x1: innerWidth,
        y1: 0,
        x2: innerWidth,
        y2: innerHeight,
        class: 'chart-axis-line'
      }));
      const title = createSvgElement('text', {
        x: innerWidth + 72,
        y: innerHeight / 2,
        transform: `rotate(-90 ${innerWidth + 72} ${innerHeight / 2})`,
        'text-anchor': 'middle',
        class: 'chart-axis-title'
      });
      title.textContent = 'papers count';
      yAxisGroup.appendChild(title);
    }

    function renderRiver() {
      areaGroup.innerHTML = '';
      labelGroup.innerHTML = '';

      const series = activeSeries();
      const totalsByYear = years.map((_, yearIndex) =>
        series.reduce((sum, item) => sum + item.values[yearIndex], 0)
      );
      const maxTotal = Math.max(...totalsByYear, 1);
      const yDomainMax = Math.max(maxTotal / zoomLevel, 1);
      const cumulativeByYear = new Array(years.length).fill(0);
      drawYAxis(yDomainMax);

      series.forEach((item) => {
        const sourceIndex = allSeries.findIndex((seriesItem) => seriesItem.keyword === item.keyword);
        const color = STREAM_COLORS[sourceIndex % STREAM_COLORS.length];
        const topPoints = [];
        const bottomPoints = [];
        let peak = { index: 0, value: -1, y: 0 };

        years.forEach((year, yearIndex) => {
          const y0 = cumulativeByYear[yearIndex];
          const y1 = y0 + item.values[yearIndex];
          cumulativeByYear[yearIndex] += item.values[yearIndex];

          const x = mapRange(year, years[0], years[years.length - 1], 0, innerWidth);
          const topY = mapRange(y1, 0, yDomainMax, innerHeight, 0);
          const bottomY = mapRange(y0, 0, yDomainMax, innerHeight, 0);
          topPoints.push({ x, y: topY });
          bottomPoints.push({ x, y: bottomY });

          if (item.values[yearIndex] > peak.value) {
            peak = { index: yearIndex, value: item.values[yearIndex], y: (topY + bottomY) / 2 };
          }
        });

        const area = createSvgElement('path', {
          d: buildAreaPath(topPoints, bottomPoints),
          fill: color,
          'fill-opacity': focusedKeyword && focusedKeyword !== item.keyword ? 0.12 : 0.7,
          stroke: '#ffffff',
          'stroke-width': 0.65,
          class: focusedKeyword === item.keyword ? 'theme-river-area is-focused' : 'theme-river-area',
          'data-keyword': item.keyword
        });
        area.addEventListener('click', () => {
          focusedKeyword = focusedKeyword === item.keyword ? null : item.keyword;
          renderRiver();
          updateFocus(false);
          updateExploreCard();
        });
        area.addEventListener('mouseenter', () => {
          const peakYear = years[peak.index];
          detailEl.innerHTML = `<strong>${item.keyword}</strong> 的峰值出现在 ${peakYear} 年，OpenAlex count ${formatTick(peak.value)}。点击河流可单独查看该主题。${TOPIC_SELECTION_TEXT}`;
          tooltip.hidden = false;
        });
        area.addEventListener('mousemove', (event) => {
          const rect = svg.getBoundingClientRect();
          const px = ((event.clientX - rect.left) / rect.width) * width;
          const yearIndex = Math.max(0, Math.min(years.length - 1, Math.round(mapRange(px - margin.left, 0, innerWidth, 0, years.length - 1))));
          const year = years[yearIndex];
          const heat = item.values[yearIndex] || 0;
          const rank = yearRanking(allSeries, yearIndex).find((ranked) => ranked.keyword === item.keyword)?.rank || '-';
          tooltip.innerHTML = `<strong>${item.keyword}</strong><span>${year} 年 · OpenAlex count ${formatTick(heat)}</span><span>当年排名 #${rank}</span>`;
          tooltip.style.left = `${event.offsetX + 14}px`;
          tooltip.style.top = `${event.offsetY + 12}px`;
        });
        area.addEventListener('mouseleave', () => {
          tooltip.hidden = true;
        });
        areaGroup.appendChild(area);

        if (focusedKeyword === item.keyword) {
          const labelPosition = labelPositionForRiver(topPoints, bottomPoints, item.keyword);
          if (!labelPosition) return;
          const label = createSvgElement('text', {
            x: labelPosition.x,
            y: labelPosition.y,
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
            textLength: labelPosition.textLength,
            lengthAdjust: 'spacingAndGlyphs',
            class: 'theme-river-label theme-river-label-focus'
          });
          label.textContent = item.keyword;
          labelGroup.appendChild(label);
        }
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
      const filterText = hiddenTopCount > 0 ? ` · 已隐藏最大 ${hiddenTopCount} 条` : '';
      const zoomText = zoomLevel > 1 ? ` · ${formatZoom(zoomLevel)}` : '';
      statEl.textContent = focusedKeyword
        ? `${year} 年 · ${focusedKeyword}: ${formatTick(top[0]?.count ?? 0)}`
        : `${year} 年 Top: ${top.map((item) => `${item.keyword} ${formatTick(item.count)}`).join(' | ')}${filterText}${zoomText}`;
      detailEl.innerHTML = focusedKeyword
        ? `<strong>${focusedKeyword}</strong> 单主题模式：拖动年份查看该主题的 OpenAlex 年度作品数如何上升、回落或进入平台期。${TOPIC_SELECTION_TEXT}`
        : `<strong>${phaseLabelByYear(year)}</strong>：${year} 年最突出的主题是 ${top.map((item) => item.keyword).join('、')}。${TOPIC_SELECTION_TEXT}`;

      if (shouldPublish) setAppState({ year, yearRangeStart: year, yearRangeEnd: year }, 'theme-river');
      updateExploreCard();
    }

    slider.addEventListener('input', () => updateFocus(true));
    filterSelect.addEventListener('change', () => {
      setHiddenTopCount(filterSelect.value === 'custom' ? filterNumber.value : filterSelect.value);
      focusedKeyword = null;
      renderRiver();
      updateFocus(false);
    });
    filterNumber.addEventListener('input', () => {
      setHiddenTopCount(filterNumber.value);
      focusedKeyword = null;
      renderRiver();
      updateFocus(false);
    });
    zoomSlider.addEventListener('input', () => {
      zoomLevel = Number(zoomSlider.value);
      zoomOutput.textContent = formatZoom(zoomLevel);
      renderRiver();
      updateFocus(false);
    });
    clearButton.addEventListener('click', () => {
      focusedKeyword = null;
      hiddenTopCount = 0;
      zoomLevel = 1;
      filterSelect.value = '0';
      filterNumber.value = '0';
      zoomSlider.value = '1';
      zoomOutput.textContent = '1x';
      renderRiver();
      updateFocus(false);
      updateExploreCard();
      setAppState({ selectedTheme: null }, 'theme-river');
    });
    exploreButton.addEventListener('click', publishThemeExplore);
    onAppStateChange(({ state, source }) => {
      if (source === 'theme-river') return;
      if (state.selectedTheme && state.selectedTheme !== focusedKeyword) {
        focusedKeyword = state.selectedTheme;
        renderRiver();
        updateExploreCard();
      }
      const yearIndex = years.indexOf(state.year);
      if (yearIndex >= 0 && slider.value !== String(yearIndex)) {
        slider.value = String(yearIndex);
        updateFocus(false);
      }
    });

    renderRiver();
    updateFocus(false);
    updateExploreCard();
  } catch (error) {
    statEl.textContent = '数据加载失败，请检查 data/processed/keyword_trends.json';
    svg.innerHTML = '';
  }
}
