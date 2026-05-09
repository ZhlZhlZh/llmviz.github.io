import { loadJson } from '../../shared/data-loader.js';
import { getAppState, onAppStateChange, setAppState } from '../../shared/app-state.js';
import { createInteractiveTooltip, escapeHtml, paperLink } from '../../shared/interactive-tooltip.js';
import { paperMatchesTheme, topThemePaper } from '../../shared/theme-filter.js';
import { createYearRangeFilter } from '../../shared/year-range-filter.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDTH = 900;
const HEIGHT = 500;

function createSvgElement(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
  return el;
}

function shorten(text, maxLength) {
  if (!text || text.length <= maxLength) return text || '';
  return `${text.slice(0, maxLength - 1)}...`;
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value) return [value];
  return [];
}

function searchText(node) {
  return `${node.title} ${(node.authors || []).join(' ')} ${asArray(node.institution).join(' ')} ${asArray(node.topic).join(' ')} ${asArray(node.keywords).join(' ')}`.toLowerCase();
}

function phaseLabel(year) {
  if (year <= 2017) return '基础机制';
  if (year <= 2022) return '预训练扩展';
  return '对齐与智能体';
}

function phaseClassByYear(year) {
  if (year <= 2017) return 'phase-foundation';
  if (year <= 2022) return 'phase-boom';
  return 'phase-agentic';
}

function primaryTopic(node) {
  const text = `${asArray(node.topic).join(' ')} ${asArray(node.keywords).join(' ')}`.toLowerCase();
  if (/retrieval|rag|knowledge|question/.test(text)) return '检索知识';
  if (/reason|agent|instruction|alignment|preference|feedback/.test(text)) return '推理对齐';
  if (/vision|image|multimodal|diffusion|clip/.test(text)) return '多模态';
  if (/efficient|mamba|attention|state space|inference|serving/.test(text)) return '架构效率';
  return '语言模型';
}

function radiusByImpact(node) {
  return 6 + Math.min(10, Math.log10((node.citations_count || 0) + 10) * 1.8);
}

function buildDirectedNeighbors(nodes, edges) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const referencesById = new Map(nodes.map((node) => [node.id, []]));
  const citationsById = new Map(nodes.map((node) => [node.id, []]));
  edges.forEach((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return;
    referencesById.get(edge.source).push(edge.target);
    citationsById.get(edge.target).push(edge.source);
  });
  return { referencesById, citationsById };
}

function findPaper(nodes, query) {
  const q = query.trim().toLowerCase().split('|')[0].trim();
  if (!q) return null;
  return nodes
    .filter((node) => node.search.includes(q))
    .sort((a, b) => (b.citations_count || 0) - (a.citations_count || 0))[0] || null;
}

function pickDefaultPaper(nodes, nodeById, selectedId) {
  if (selectedId && nodeById.has(selectedId)) return nodeById.get(selectedId);
  return nodes.find((node) => node.title.toLowerCase() === 'attention is all you need') ||
    nodes.find((node) => node.title.toLowerCase().includes('attention is all')) ||
    nodes.slice().sort((a, b) => (b.citations_count || 0) - (a.citations_count || 0))[0];
}

function sortInfluence(items, direction, centerYear) {
  return items
    .slice()
    .sort((a, b) => {
      const nodeA = a.node || a;
      const nodeB = b.node || b;
      const depthBias = (a.depth || 1) - (b.depth || 1);
      const yearBias = direction === 'upstream'
        ? (nodeA.year || 0) - (nodeB.year || 0)
        : (nodeB.year || 0) - (nodeA.year || 0);
      const relevantYear = direction === 'upstream'
        ? Number(nodeA.year <= centerYear) - Number(nodeB.year <= centerYear)
        : Number(nodeA.year >= centerYear) - Number(nodeB.year >= centerYear);
      return depthBias || relevantYear * -100 || yearBias || (nodeB.citations_count || 0) - (nodeA.citations_count || 0);
    });
}

function collectInfluenceLayers(centerId, neighborMap, nodeById, maxDepth, limitPerDepth) {
  const results = [];
  const visited = new Set([centerId]);
  let frontier = [centerId];

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const layerIds = [];
    frontier.forEach((id) => {
      (neighborMap.get(id) || []).forEach((nextId) => {
        if (visited.has(nextId)) return;
        visited.add(nextId);
        layerIds.push({ id: nextId, parentId: id });
      });
    });
    const layer = layerIds
      .map((item) => ({ node: nodeById.get(item.id), parentId: item.parentId }))
      .filter((item) => item.node)
      .sort((a, b) => (b.node.citations_count || 0) - (a.node.citations_count || 0))
      .slice(0, limitPerDepth);
    layer.forEach((item) => results.push({ node: item.node, depth, parentId: item.parentId }));
    frontier = layerIds.map((item) => item.id);
    if (!frontier.length) break;
  }

  return results;
}

function distributePoints(items, xForDepth, top, bottom) {
  if (!items.length) return [];
  const byDepth = new Map();
  items.forEach((item) => {
    const depth = item.depth || 1;
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth).push(item);
  });

  return Array.from(byDepth.entries()).flatMap(([depth, layer]) => {
    const step = (bottom - top) / Math.max(layer.length - 1, 1);
    return layer.map((item, index) => ({
      ...item,
      x: xForDepth(depth),
      y: layer.length === 1 ? (top + bottom) / 2 : top + index * step
    }));
  });
}

function renderWrappedText(parent, text, x, y, maxChars, className, anchor = 'start') {
  const chunks = [];
  let rest = text || '';
  while (rest.length > maxChars) {
    chunks.push(rest.slice(0, maxChars));
    rest = rest.slice(maxChars);
  }
  if (rest) chunks.push(rest);
  chunks.slice(0, 2).forEach((line, index) => {
    const t = createSvgElement('text', { x, y: y + index * 12, class: className, 'text-anchor': anchor });
    t.textContent = index === 1 && chunks.length > 2 ? `${line.slice(0, Math.max(0, maxChars - 3))}...` : line;
    parent.appendChild(t);
  });
}

function depthColumnX(centerX, direction, depth, maxDepth, hasOppositeWing) {
  const innerGap = hasOppositeWing ? 150 : 175;
  const outerGap = hasOppositeWing ? 300 : 405;
  const span = maxDepth <= 1 ? innerGap : innerGap + ((outerGap - innerGap) * (depth - 1)) / (maxDepth - 1);
  return direction === 'upstream' ? centerX - span : centerX + span;
}

export async function initButterflyPath(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="module-shell">
      <p class="module-tag">Module 03</p>
      <h3 class="module-title">蝴蝶影响图</h3>
      <p class="module-subtitle">选择一篇中心论文，左翼展示它引用并继承的上游论文，右翼展示引用它、受它影响的下游论文。</p>
      <div class="chart-toolbar chart-toolbar-wrap">
        <div class="butterfly-year-slot"></div>
        <label class="chart-control">
          中心论文
          <input class="chart-input butterfly-search" list="butterfly-paper-list" placeholder="标题 / 作者 / 机构 / 主题" />
          <datalist id="butterfly-paper-list"></datalist>
        </label>
        <label class="chart-control">
          每侧数量
          <select class="chart-select butterfly-limit">
            <option value="4">每阶 4 篇</option>
            <option value="6" selected>每阶 6 篇</option>
            <option value="10">每阶 10 篇</option>
          </select>
        </label>
        <label class="chart-control">
          引用深度
          <select class="chart-select butterfly-depth">
            <option value="1">1 阶</option>
            <option value="2" selected>2 阶</option>
            <option value="3">3 阶</option>
          </select>
        </label>
        <button class="chart-button butterfly-use-selected" type="button">使用当前选中论文</button>
        <button class="chart-button butterfly-reset" type="button">回到 Attention</button>
        <div class="chart-stat" aria-live="polite">加载中...</div>
      </div>
      <div class="module-canvas chart-canvas butterfly-canvas">
        <svg class="chart-svg butterfly-svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Paper influence butterfly chart"></svg>
      </div>
      <div class="butterfly-explain-grid">
        <div class="chart-detail butterfly-detail"></div>
        <div class="butterfly-wing-lists">
          <section>
            <h4>受到影响</h4>
            <ol class="butterfly-upstream-list"></ol>
          </section>
          <section>
            <h4>影响后续</h4>
            <ol class="butterfly-downstream-list"></ol>
          </section>
        </div>
      </div>
      <div class="legend-row">
        <span class="legend-chip">左翼 = 中心论文引用的上游论文</span>
        <span class="legend-chip">右翼 = 引用中心论文的后续论文</span>
        <span class="legend-chip">节点大小 = 引用量</span>
        <span class="legend-chip">颜色 = 研究阶段</span>
      </div>
    </div>
  `;

  const searchInput = container.querySelector('.butterfly-search');
  const paperList = container.querySelector('#butterfly-paper-list');
  const limitSelect = container.querySelector('.butterfly-limit');
  const depthSelect = container.querySelector('.butterfly-depth');
  const useSelectedButton = container.querySelector('.butterfly-use-selected');
  const resetButton = container.querySelector('.butterfly-reset');
  const statEl = container.querySelector('.chart-stat');
  const detailEl = container.querySelector('.butterfly-detail');
  const upstreamList = container.querySelector('.butterfly-upstream-list');
  const downstreamList = container.querySelector('.butterfly-downstream-list');
  const svg = container.querySelector('.butterfly-svg');
  const canvas = container.querySelector('.butterfly-canvas');

  if (!searchInput || !paperList || !limitSelect || !depthSelect || !useSelectedButton || !resetButton || !statEl || !detailEl || !upstreamList || !downstreamList || !svg || !canvas) return;

  try {
    const [nodesData, edgesData] = await Promise.all([
      loadJson('./data/processed/nodes.json'),
      loadJson('./data/processed/edges.json')
    ]);

    const nodes = nodesData.map((node) => ({ ...node, search: searchText(node) }));
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const { referencesById, citationsById } = buildDirectedNeighbors(nodes, edgesData);
    let centerNode = pickDefaultPaper(nodes, nodeById, getAppState().selectedPaperId);
    let linkedTheme = getAppState().selectedTheme || null;

    // Shared year-range filter
    const butterflyYearSlot = container.querySelector('.butterfly-year-slot');
    const bfAllYears = nodes.map((n) => n.year).filter(Boolean);
    const bfMinYear = Math.min(...bfAllYears, 2013);
    const bfMaxYear = Math.max(...bfAllYears, 2026);
    const yearFilter = createYearRangeFilter({
      source: 'butterfly-path',
      label: '年份范围',
      min: bfMinYear,
      max: bfMaxYear,
      onChange: () => render()
    });
    if (butterflyYearSlot) butterflyYearSlot.appendChild(yearFilter.element);

    const tooltip = createInteractiveTooltip(canvas);

    nodes.forEach((node) => {
      const option = document.createElement('option');
      option.value = `${node.title} | ${(node.authors || []).slice(0, 2).join(', ')} | ${asArray(node.institution).slice(0, 2).join(', ')}`;
      paperList.appendChild(option);
    });

    function selectCenter(node, publish = true) {
      if (!node) return;
      centerNode = node;
      searchInput.value = node.title;
      if (publish) {
        const { start, end } = yearFilter.getRange();
        setAppState({ selectedPaperId: node.id, year: node.year, yearRangeStart: start, yearRangeEnd: end }, 'butterfly-path');
      }
      render();
    }

    function selectedWings() {
      const limit = Number(limitSelect.value) || 10;
      const depth = Number(depthSelect.value) || 2;
      const { start, end } = yearFilter.getRange();
      const yearFilter_ = (item) => {
        const n = item.node || item;
        return !n.year || (n.year >= start && n.year <= end);
      };
      const themeFilter = (item) => !linkedTheme || paperMatchesTheme(item.node || item, linkedTheme);
      const upstream = sortInfluence(collectInfluenceLayers(centerNode.id, referencesById, nodeById, depth, limit * 3).filter(themeFilter).filter(yearFilter_), 'upstream', centerNode.year).slice(0, limit * depth);
      const downstream = sortInfluence(collectInfluenceLayers(centerNode.id, citationsById, nodeById, depth, limit * 3).filter(themeFilter).filter(yearFilter_), 'downstream', centerNode.year).slice(0, limit * depth);
      return { upstream, downstream };
    }

    function applyLinkedTheme(theme) {
      linkedTheme = theme || null;
      if (linkedTheme) {
        const themeCenter = topThemePaper(nodes, linkedTheme);
        if (themeCenter) {
          centerNode = themeCenter;
          searchInput.value = themeCenter.title;
        }
      }
      render();
    }

    function drawCurve(from, to, className) {
      const dx = Math.abs(to.x - from.x);
      const c1x = from.x + (to.x > from.x ? dx * 0.48 : -dx * 0.48);
      const c2x = to.x - (to.x > from.x ? dx * 0.48 : -dx * 0.48);
      const path = createSvgElement('path', {
        d: `M ${from.x} ${from.y} C ${c1x} ${from.y}, ${c2x} ${to.y}, ${to.x} ${to.y}`,
        class: className
      });
      svg.appendChild(path);
    }

    function drawNode(point, role) {
      const node = point.node;
      const group = createSvgElement('g', {
        class: `butterfly-node-group ${phaseClassByYear(node.year)} is-${role} depth-${point.depth || 0}`,
        transform: `translate(${point.x} ${point.y})`,
        tabindex: '0',
        role: 'button'
      });
      const circle = createSvgElement('circle', {
        r: role === 'center' ? 18 : radiusByImpact(node),
        class: 'butterfly-node'
      });
      const year = createSvgElement('text', {
        x: role === 'center' ? 0 : 0,
        y: role === 'center' ? 4 : radiusByImpact(node) + 14,
        class: role === 'center' ? 'butterfly-node-year' : 'butterfly-node-year is-outside',
        'text-anchor': 'middle'
      });
      year.textContent = String(node.year || '');
      group.append(circle, year);

      const url = paperLink(node);
      const tooltipHtml = `<strong>${escapeHtml(node.title)}</strong><span>${escapeHtml(phaseLabel(node.year))} · ${escapeHtml(node.year || '')}</span><span>引用 ${Number(node.citations_count || 0).toLocaleString()}</span>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">打开论文链接</a>` : ''}`;
      group.addEventListener('pointerenter', (event) => tooltip.show(event, tooltipHtml));
      group.addEventListener('pointermove', (event) => tooltip.move(event));
      group.addEventListener('pointerleave', () => tooltip.hideSoon());

      const labelAnchor = role === 'upstream' ? 'end' : role === 'downstream' ? 'start' : 'middle';
      const labelX = role === 'upstream' ? -18 : role === 'downstream' ? 18 : 0;
      const labelY = role === 'center' ? 34 : -4;
      renderWrappedText(group, shorten(node.title, role === 'center' ? 48 : 34), labelX, labelY, role === 'center' ? 24 : 17, 'butterfly-node-label', labelAnchor);

      group.addEventListener('click', () => selectCenter(node));
      group.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectCenter(node);
        }
      });
      svg.appendChild(group);
    }

    function listHtml(items) {
      if (!items.length) return '<li class="is-empty">暂无直接关系数据</li>';
      return items.map((item) => {
        const node = item.node || item;
        const inst = asArray(node.institution)[0] || '机构待补齐';
        return `<li data-id="${node.id}"><strong>${item.depth || 1} 阶 · ${shorten(node.title, 54)}</strong><span>${node.year} · ${primaryTopic(node)} · ${inst}</span></li>`;
      }).join('');
    }

    function wireList(list) {
      list.querySelectorAll('li[data-id]').forEach((row) => {
        row.addEventListener('click', () => selectCenter(nodeById.get(row.getAttribute('data-id'))));
      });
    }

    function render() {
      if (!centerNode) return;
      const { upstream, downstream } = selectedWings();
      const hasUpstream = upstream.length > 0;
      const hasDownstream = downstream.length > 0;
      const maxDepth = Number(depthSelect.value) || 2;
      const centerX = hasUpstream && !hasDownstream ? 585 : !hasUpstream && hasDownstream ? 315 : WIDTH / 2;
      const center = { node: centerNode, x: centerX, y: HEIGHT / 2 };
      const upstreamPoints = distributePoints(upstream, (depth) => depthColumnX(centerX, 'upstream', depth, maxDepth, hasDownstream), 72, HEIGHT - 78);
      const downstreamPoints = distributePoints(downstream, (depth) => depthColumnX(centerX, 'downstream', depth, maxDepth, hasUpstream), 72, HEIGHT - 78);
      const upstreamPointById = new Map(upstreamPoints.map((point) => [point.node.id, point]));
      const downstreamPointById = new Map(downstreamPoints.map((point) => [point.node.id, point]));

      svg.innerHTML = '';
      const leftTitle = createSvgElement('text', { x: 32, y: 32, class: 'butterfly-wing-title' });
      leftTitle.textContent = '受到影响：它引用的论文';
      const rightTitle = createSvgElement('text', { x: WIDTH - 32, y: 32, class: 'butterfly-wing-title', 'text-anchor': 'end' });
      rightTitle.textContent = '影响后续：引用它的论文';
      svg.append(leftTitle, rightTitle);

      if (!hasUpstream) {
        const empty = createSvgElement('text', { x: 74, y: HEIGHT / 2, class: 'butterfly-empty-wing' });
        empty.textContent = '当前数据未采到这篇论文的上游引用';
        svg.appendChild(empty);
      }
      if (!hasDownstream) {
        const empty = createSvgElement('text', { x: WIDTH - 74, y: HEIGHT / 2, class: 'butterfly-empty-wing', 'text-anchor': 'end' });
        empty.textContent = '当前数据未采到后续引用';
        svg.appendChild(empty);
      }

      upstreamPoints.forEach((point) => {
        const parentPoint = point.depth === 1 ? center : upstreamPointById.get(point.parentId);
        drawCurve(point, parentPoint || center, `butterfly-influence-link is-upstream depth-${point.depth}`);
      });
      downstreamPoints.forEach((point) => {
        const parentPoint = point.depth === 1 ? center : downstreamPointById.get(point.parentId);
        drawCurve(parentPoint || center, point, `butterfly-influence-link is-downstream depth-${point.depth}`);
      });
      upstreamPoints.forEach((point) => drawNode(point, 'upstream'));
      downstreamPoints.forEach((point) => drawNode(point, 'downstream'));
      drawNode(center, 'center');

      const themeText = linkedTheme ? `主题模式：${linkedTheme}。` : '';
      detailEl.innerHTML = `<strong>${centerNode.title}</strong> (${centerNode.year}) · ${centerNode.venue || 'Unknown'}<br />${themeText}当前向两侧追踪 ${maxDepth} 阶引用链：上游 ${upstream.length} 篇、下游 ${downstream.length} 篇。越靠近中心表示越直接，越外侧表示影响链越长。<br />作者：${(centerNode.authors || []).slice(0, 8).join(', ') || '未知作者'}<br />主题：${asArray(centerNode.keywords).slice(0, 8).join('、') || asArray(centerNode.topic).join('、') || '暂无主题'}`;
      upstreamList.innerHTML = listHtml(upstream);
      downstreamList.innerHTML = listHtml(downstream);
      wireList(upstreamList);
      wireList(downstreamList);

      statEl.textContent = `中心论文 1 篇 · ${maxDepth} 阶链路 · 上游 ${upstream.length} · 下游 ${downstream.length}${linkedTheme ? ` · 主题：${linkedTheme}` : ''}`;
    }

    searchInput.addEventListener('input', () => {
      linkedTheme = null;
      const node = findPaper(nodes, searchInput.value);
      if (node) selectCenter(node);
    });
    searchInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const node = findPaper(nodes, searchInput.value);
      if (node) selectCenter(node);
    });
    limitSelect.addEventListener('change', render);
    depthSelect.addEventListener('change', render);
    useSelectedButton.addEventListener('click', () => {
      const node = nodeById.get(getAppState().selectedPaperId);
      if (node) selectCenter(node);
    });
    resetButton.addEventListener('click', () => selectCenter(pickDefaultPaper(nodes, nodeById, null)));

    onAppStateChange(({ state, source }) => {
      if (source === 'butterfly-path') return;
      if (state.selectedTheme !== linkedTheme) {
        applyLinkedTheme(state.selectedTheme);
        return;
      }
      const node = state.selectedPaperId ? nodeById.get(state.selectedPaperId) : null;
      if (node) selectCenter(node, false);
    });

    if (linkedTheme) applyLinkedTheme(linkedTheme);
    selectCenter(centerNode, false);
  } catch (error) {
    statEl.textContent = '数据加载失败，请检查 nodes.json 和 edges.json';
    svg.innerHTML = '';
  }
}
