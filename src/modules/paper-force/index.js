import { loadJson } from '../../shared/data-loader.js';
import { getAppState, onAppStateChange, setAppState } from '../../shared/app-state.js';
import { createInteractiveTooltip, escapeHtml, paperLink } from '../../shared/interactive-tooltip.js';
import { paperMatchesTheme, topThemePaper } from '../../shared/theme-filter.js';
import { createYearRangeFilter } from '../../shared/year-range-filter.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDTH = 1100;
const HEIGHT = 680;
const CENTER = { x: WIDTH / 2, y: HEIGHT / 2 };

function createSvgElement(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value !== null && value !== undefined) el.setAttribute(key, String(value));
  });
  return el;
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value) return [value];
  return [];
}

function shorten(text, maxLength) {
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function paperSearchText(node) {
  return [
    node.title,
    ...(node.authors || []),
    ...asArray(node.institution),
    ...asArray(node.topic),
    ...asArray(node.keywords)
  ].join(' ').toLowerCase();
}

function topicSearchText(node) {
  return [...asArray(node.topic), ...asArray(node.keywords)].join(' ').toLowerCase();
}

function phaseClassByYear(year) {
  if (year <= 2017) return 'phase-foundation';
  if (year <= 2022) return 'phase-boom';
  return 'phase-agentic';
}

function radiusByImpact(node, minCitations, maxCitations) {
  const min = Math.log10((minCitations || 0) + 10);
  const max = Math.log10((maxCitations || 0) + 10);
  const value = Math.log10((node.citations_count || 0) + 10);
  const t = Math.max(0, Math.min(1, (value - min) / Math.max(max - min, 1)));
  return 3.6 + t * 10.5;
}

function buildAdjacency(nodes, edges) {
  const ids = new Set(nodes.map((node) => node.id));
  const adjacency = new Map(nodes.map((node) => [node.id, new Set()]));
  edges.forEach((edge) => {
    if (!ids.has(edge.source) || !ids.has(edge.target)) return;
    adjacency.get(edge.source).add(edge.target);
    adjacency.get(edge.target).add(edge.source);
  });
  return adjacency;
}

function makeGraph(nodesData, edgesData) {
  const minCitations = Math.min(...nodesData.map((node) => node.citations_count || 0));
  const maxCitations = Math.max(...nodesData.map((node) => node.citations_count || 0));
  const nodes = nodesData.map((item, index) => {
    const angle = index * 2.399963 + (item.year || 0) * 0.031;
    const radius = 38 + Math.sqrt(index + 1) * 24;
    return {
      ...item,
      r: radiusByImpact(item, minCitations, maxCitations),
      x: CENTER.x + Math.cos(angle) * radius,
      y: CENTER.y + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      pinned: false,
      search: paperSearchText(item)
    };
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const links = edgesData
    .map((edge) => ({
      ...edge,
      sourceNode: nodeById.get(edge.source),
      targetNode: nodeById.get(edge.target)
    }))
    .filter((edge) => edge.sourceNode && edge.targetNode);
  const adjacency = buildAdjacency(nodes, links);
  nodes.forEach((node) => {
    node.degree = adjacency.get(node.id)?.size || 0;
  });
  return { nodes, links, nodeById, adjacency };
}

function pickInitialNode(nodes, selectedId, nodeById) {
  if (selectedId && nodeById.has(selectedId)) return nodeById.get(selectedId);
  return nodes.find((node) => normalizeText(node.title) === 'attention is all you need') ||
    nodes.find((node) => normalizeText(node.title).includes('attention is all')) ||
    nodes.slice().sort((a, b) => (b.citations_count || 0) - (a.citations_count || 0))[0];
}

function tickObsidianGraph(nodes, links, alpha) {
  const repel = 1480 * alpha;
  const collision = 0.34 * alpha;
  const centerPull = 0.006 * alpha;
  const maxRepelDistance = 280;

  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distSq = dx * dx + dy * dy;
      if (distSq < 0.01) {
        dx = (Math.random() - 0.5) * 0.4;
        dy = (Math.random() - 0.5) * 0.4;
        distSq = dx * dx + dy * dy;
      }
      if (distSq > maxRepelDistance * maxRepelDistance) continue;
      const dist = Math.sqrt(distSq);
      const minDistance = a.r + b.r + 10;
      const force = repel / distSq + Math.max(0, minDistance - dist) * collision;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (!a.pinned) {
        a.vx -= fx;
        a.vy -= fy;
      }
      if (!b.pinned) {
        b.vx += fx;
        b.vy += fy;
      }
    }
  }

  links.forEach((link) => {
    const source = link.sourceNode;
    const target = link.targetNode;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const ideal = 86 + Math.min(source.r + target.r, 18) * 2.5;
    const strength = 0.022 * alpha;
    const force = (dist - ideal) * strength;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    if (!source.pinned) {
      source.vx += fx;
      source.vy += fy;
    }
    if (!target.pinned) {
      target.vx -= fx;
      target.vy -= fy;
    }
  });

  nodes.forEach((node) => {
    if (!node.pinned) {
      node.vx += (CENTER.x - node.x) * centerPull;
      node.vy += (CENTER.y - node.y) * centerPull;
      node.vx *= 0.86;
      node.vy *= 0.86;
      node.x += node.vx;
      node.y += node.vy;
    }
  });
}

function screenToGraph(transform, x, y) {
  return {
    x: (x - transform.x) / transform.k,
    y: (y - transform.y) / transform.k
  };
}

function zoomAt(transform, point, nextK) {
  const graphPoint = screenToGraph(transform, point.x, point.y);
  return {
    x: point.x - graphPoint.x * nextK,
    y: point.y - graphPoint.y * nextK,
    k: nextK
  };
}

function contentBounds(nodes, padding = 120) {
  if (!nodes.length) {
    return { minX: 0, maxX: WIDTH, minY: 0, maxY: HEIGHT };
  }
  const minX = Math.min(...nodes.map((node) => node.x - node.r)) - padding;
  const maxX = Math.max(...nodes.map((node) => node.x + node.r)) + padding;
  const minY = Math.min(...nodes.map((node) => node.y - node.r)) - padding;
  const maxY = Math.max(...nodes.map((node) => node.y + node.r)) + padding;
  return { minX, maxX, minY, maxY };
}

function clampTranslate(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampTransform(transform, bounds, viewportWidth = WIDTH, viewportHeight = HEIGHT) {
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

function fitTransform(nodes, padding = 70) {
  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const graphWidth = Math.max(maxX - minX, 1);
  const graphHeight = Math.max(maxY - minY, 1);
  const k = Math.max(0.28, Math.min(1.7, Math.min((WIDTH - padding * 2) / graphWidth, (HEIGHT - padding * 2) / graphHeight)));
  return {
    x: WIDTH / 2 - ((minX + maxX) / 2) * k,
    y: HEIGHT / 2 - ((minY + maxY) / 2) * k,
    k
  };
}

export async function initPaperForce(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="module-shell paper-obsidian-shell">
      <p class="module-tag">Module 02</p>
      <h3 class="module-title">论文关系图谱</h3>
      <p class="module-subtitle">全量论文节点在同一张力导向网络中自然聚合，拖拽画布、缩放、搜索或点击节点即可探索引用关系。</p>
      <div class="obsidian-toolbar">
        <div class="force-year-slot"></div>
        <label class="obsidian-search">
          <span>论文</span>
          <input class="chart-input force-search-input" list="force-paper-list" placeholder="标题 / 作者 / 机构 / 关键词" />
          <datalist id="force-paper-list"></datalist>
        </label>
        <label class="obsidian-search">
          <span>作者</span>
          <input class="chart-input force-author-input" list="force-author-list" placeholder="例如 Ashish Vaswani" />
          <datalist id="force-author-list"></datalist>
        </label>
        <label class="obsidian-search">
          <span>主题</span>
          <input class="chart-input force-topic-input" list="force-topic-list" placeholder="例如 transformer / reasoning" />
          <datalist id="force-topic-list"></datalist>
        </label>
        <label class="chart-control">
          节点
          <select class="chart-select force-node-limit">
            <option value="80">80</option>
            <option value="150">150</option>
            <option value="260">260</option>
            <option value="80" selected>80</option>
          </select>
        </label>
        <label class="chart-control">
          标签
          <select class="chart-select force-label-mode">
            <option value="focus">聚焦显示</option>
            <option value="important">重要节点</option>
            <option value="none">隐藏</option>
          </select>
        </label>
        <label class="chart-control">
          边
          <select class="chart-select force-edge-mode">
            <option value="focus">聚焦关系</option>
            <option value="explore">全边探索</option>
          </select>
        </label>
        <button class="chart-button force-clear-filter-button" type="button">清空筛选</button>
        <button class="chart-button force-reset-button" type="button">重置视图</button>
        <button class="chart-button force-reheat-button" type="button">重新布局</button>
        <div class="chart-stat force-stat" aria-live="polite">加载中...</div>
      </div>
      <div class="module-canvas chart-canvas force-canvas">
        <svg class="chart-svg force-svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Paper relation graph"></svg>
      </div>
      <div class="force-detail-grid">
        <div class="chart-detail force-detail"></div>
        <div class="force-hint">
          <span>滚轮缩放</span>
          <span>拖拽平移</span>
          <span>点击高亮邻居</span>
          <span>拖拽节点固定局部结构</span>
        </div>
      </div>
      <div class="legend-row">
        <span class="legend-chip">节点大小 = 引用量</span>
        <span class="legend-chip">连线 = 引用 / 关联关系</span>
        <span class="legend-chip">颜色 = 研究阶段</span>
        <span class="legend-chip">光晕 = 当前论文与一阶邻居</span>
      </div>
    </div>
  `;

  const svg = container.querySelector('.force-svg');
  const canvas = container.querySelector('.force-canvas');
  const shell = container.querySelector('.paper-obsidian-shell');
  const searchInput = container.querySelector('.force-search-input');
  const authorInput = container.querySelector('.force-author-input');
  const topicInput = container.querySelector('.force-topic-input');
  const paperList = container.querySelector('#force-paper-list');
  const authorList = container.querySelector('#force-author-list');
  const topicList = container.querySelector('#force-topic-list');
  const nodeLimit = container.querySelector('.force-node-limit');
  const labelMode = container.querySelector('.force-label-mode');
  const edgeMode = container.querySelector('.force-edge-mode');
  const clearFilterButton = container.querySelector('.force-clear-filter-button');
  const resetButton = container.querySelector('.force-reset-button');
  const reheatButton = container.querySelector('.force-reheat-button');
  const statEl = container.querySelector('.force-stat');
  const detailEl = container.querySelector('.force-detail');
  if (!svg || !canvas || !shell || !searchInput || !authorInput || !topicInput || !paperList || !authorList || !topicList || !nodeLimit || !labelMode || !edgeMode || !clearFilterButton || !resetButton || !reheatButton || !statEl || !detailEl) return;

  try {
    const [nodesData, edgesData] = await Promise.all([
      loadJson('./data/processed/nodes.json'),
      loadJson('./data/processed/edges.json')
    ]);

    const { nodes, links, nodeById, adjacency } = makeGraph(nodesData, edgesData);
    let selectedNode = pickInitialNode(nodes, getAppState().selectedPaperId, nodeById);
    let highlightedIds = new Set();
    let alpha = 1.25;
    let transform = { x: 0, y: 0, k: 1 };
    let draggingNode = null;
    let panning = null;
    let frame = null;
    let activeNodeIds = new Set(nodes.map((node) => node.id));
    let activeNodes = nodes;
    let activeLinks = links;
    let linkedTheme = getAppState().selectedTheme || null;

    // Shared year-range filter
    const forceYearSlot = container.querySelector('.force-year-slot');
    const allYears = nodes.map((n) => n.year).filter(Boolean);
    const forceMinYear = Math.min(...allYears, 2013);
    const forceMaxYear = Math.max(...allYears, 2026);
    const yearFilter = createYearRangeFilter({
      source: 'paper-force',
      label: '年份范围',
      min: forceMinYear,
      max: forceMaxYear,
      onChange: () => applyGraphFilters({ refit: true })
    });
    if (forceYearSlot) forceYearSlot.appendChild(yearFilter.element);

    const tooltip = createInteractiveTooltip(canvas);

    const viewport = createSvgElement('g', { class: 'graph-viewport' });
    const linkLayer = createSvgElement('g', { class: 'force-edge-layer' });
    const nodeLayer = createSvgElement('g', { class: 'force-node-layer' });
    viewport.append(linkLayer, nodeLayer);
    svg.appendChild(viewport);

    const linkEls = links.map((link) => {
      const line = createSvgElement('line', { class: 'force-link' });
      linkLayer.appendChild(line);
      link.el = line;
      return line;
    });

    nodes.forEach((node) => {
      const option = document.createElement('option');
      option.value = `${node.title} | ${(node.authors || []).slice(0, 2).join(', ')} | ${asArray(node.institution).slice(0, 2).join(', ')}`;
      paperList.appendChild(option);

      const group = createSvgElement('g', {
        class: 'force-node-group',
        tabindex: '0',
        role: 'button',
        'data-id': node.id
      });
      const halo = createSvgElement('circle', { class: 'force-node-halo', r: node.r + 8 });
      const circle = createSvgElement('circle', { class: `force-node ${phaseClassByYear(node.year)}`, r: node.r });
      const label = createSvgElement('text', { class: 'force-node-label', x: node.r + 7, y: 4 });
      label.textContent = shorten(node.title, 38);
      group.append(halo, circle, label);
      nodeLayer.appendChild(group);
      node.el = group;
      node.labelEl = label;

      const url = paperLink(node);
      const tooltipHtml = `<strong>${escapeHtml(node.title)}</strong><span>${escapeHtml(node.year)} · ${escapeHtml((node.authors || []).slice(0, 4).join(', ') || '未知作者')}</span><span>引用 ${(node.citations_count || 0).toLocaleString()}</span>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">打开论文链接</a>` : ''}`;
      group.addEventListener('pointerenter', (event) => tooltip.show(event, tooltipHtml));
      group.addEventListener('pointermove', (event) => tooltip.move(event));
      group.addEventListener('pointerleave', () => tooltip.hideSoon());

      group.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        const point = screenToGraph(transform, event.offsetX, event.offsetY);
        draggingNode = {
          node,
          pointerId: event.pointerId,
          offsetX: node.x - point.x,
          offsetY: node.y - point.y,
          moved: false,
          startX: event.clientX,
          startY: event.clientY
        };
        node.pinned = true;
        group.setPointerCapture(event.pointerId);
      });
      group.addEventListener('click', () => {
        if (node.suppressClick) {
          node.suppressClick = false;
          return;
        }
        selectNode(node, true);
      });
      group.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectNode(node, true);
        }
      });
    });

    Array.from(new Set(nodes.flatMap((node) => node.authors || []))).sort().forEach((author) => {
      const option = document.createElement('option');
      option.value = author;
      authorList.appendChild(option);
    });
    Array.from(new Set(nodes.flatMap((node) => [...asArray(node.topic), ...asArray(node.keywords)]))).sort().forEach((topic) => {
      const option = document.createElement('option');
      option.value = topic;
      topicList.appendChild(option);
    });

    function applyTransform() {
      transform = clampTransform(transform, contentBounds(activeNodes.length ? activeNodes : nodes));
      viewport.setAttribute('transform', `translate(${transform.x} ${transform.y}) scale(${transform.k})`);
    }

    function updateHighlightedIds() {
      highlightedIds = new Set(selectedNode ? [selectedNode.id, ...(adjacency.get(selectedNode.id) || [])] : []);
    }

    function updateDetail() {
      if (!selectedNode) {
        detailEl.textContent = '点击任意节点查看论文详情。';
        return;
      }
      const neighbors = adjacency.get(selectedNode.id)?.size || 0;
      const authors = (selectedNode.authors || []).slice(0, 6).join(', ') || '未知作者';
      const institutions = asArray(selectedNode.institution).join(', ') || '未知机构';
      const keywords = asArray(selectedNode.keywords).slice(0, 8).join('、') || asArray(selectedNode.topic).join('、') || '暂无关键词';
      detailEl.innerHTML = `<strong>${selectedNode.title}</strong> (${selectedNode.year}) · ${selectedNode.venue || 'Unknown'}<br />作者：${authors}<br />机构：${institutions}<br />引用：${(selectedNode.citations_count || 0).toLocaleString()} · 相邻节点：${neighbors}<br />关键词：${keywords}`;
    }

    function getFilterQueries() {
      return {
        paper: normalizeText(searchInput.value).split('|')[0].trim(),
        author: normalizeText(authorInput.value),
        topic: linkedTheme ? '' : normalizeText(topicInput.value),
        theme: linkedTheme,
        limit: Number(nodeLimit.value) || nodes.length
      };
    }

    function nodeMatchesFilters(node, queries) {
      // Year range filter
      const { start, end } = yearFilter.getRange();
      if (node.year && (node.year < start || node.year > end)) return false;
      if (queries.theme && !paperMatchesTheme(node, queries.theme)) return false;
      if (queries.paper && !node.search.includes(queries.paper) && !normalizeText(node.title).includes(queries.paper)) return false;
      if (queries.author && !(node.authors || []).some((author) => normalizeText(author).includes(queries.author))) return false;
      if (queries.topic && !topicSearchText(node).includes(queries.topic)) return false;
      return true;
    }

    function rankNode(node, seedIds) {
      const seedBoost = seedIds.has(node.id) ? 1_000_000 : 0;
      const selectedBoost = selectedNode?.id === node.id ? 500_000 : 0;
      const neighborSeedHits = Array.from(adjacency.get(node.id) || []).filter((id) => seedIds.has(id)).length;
      return seedBoost + selectedBoost + neighborSeedHits * 30_000 + (node.degree || 0) * 700 + Math.log10((node.citations_count || 0) + 10) * 1600;
    }

    function applyGraphFilters({ refit = false } = {}) {
      const queries = getFilterQueries();
      const hasFilters = Boolean(queries.theme || queries.paper || queries.author || queries.topic);
      const seedNodes = hasFilters ? nodes.filter((node) => nodeMatchesFilters(node, queries)) : nodes;
      const seedIds = new Set(seedNodes.map((node) => node.id));
      const candidateIds = new Set(seedIds);

      if (hasFilters) {
        const themeOnly = Boolean(queries.theme) && !queries.paper && !queries.author && !queries.topic;
        if (!themeOnly) {
          seedIds.forEach((id) => {
            (adjacency.get(id) || []).forEach((neighborId) => candidateIds.add(neighborId));
          });
        }
      }

      const rankedNodes = nodes
        .filter((node) => candidateIds.has(node.id))
        .sort((a, b) => rankNode(b, seedIds) - rankNode(a, seedIds))
        .slice(0, queries.limit);

      activeNodeIds = new Set(rankedNodes.map((node) => node.id));
      activeNodes = rankedNodes;
      activeLinks = links.filter((link) => activeNodeIds.has(link.source) && activeNodeIds.has(link.target));

      if (!activeNodeIds.has(selectedNode?.id)) {
        selectedNode = activeNodes[0] || null;
        updateHighlightedIds();
      }

      nodes.forEach((node) => node.el.classList.toggle('is-hidden', !activeNodeIds.has(node.id)));
      links.forEach((link) => link.el.classList.toggle('is-hidden', !activeNodeIds.has(link.source) || !activeNodeIds.has(link.target)));

      if (refit && activeNodes.length) {
        transform = fitTransform(activeNodes);
        applyTransform();
      }
      alpha = Math.max(alpha, 0.72);
      updateStyles();
    }

    function updateStyles() {
      const mode = labelMode.value;
      const edgeModeValue = edgeMode.value;
      const exploreEdges = edgeModeValue === 'explore';
      svg.classList.toggle('is-edge-explore', exploreEdges);
      shell.classList.toggle('is-edge-explore', exploreEdges);
      nodes.forEach((node) => {
        if (!activeNodeIds.has(node.id)) return;
        const isSelected = selectedNode?.id === node.id;
        const isNeighbor = highlightedIds.has(node.id) && !isSelected;
        const isDimmed = selectedNode && !highlightedIds.has(node.id);
        const showLabel = mode === 'focus'
          ? isSelected || isNeighbor || node.degree >= 8 || node.r >= 11
          : mode === 'important' && (node.degree >= 8 || node.r >= 11);
        node.el.classList.toggle('is-selected', isSelected);
        node.el.classList.toggle('is-neighbor', isNeighbor);
        node.el.classList.toggle('is-dimmed', Boolean(isDimmed));
        node.labelEl.classList.toggle('is-hidden', !showLabel);
      });
      links.forEach((link) => {
        if (!activeNodeIds.has(link.source) || !activeNodeIds.has(link.target)) return;
        const active = selectedNode && link.source !== selectedNode.id && link.target !== selectedNode.id
          ? highlightedIds.has(link.source) && highlightedIds.has(link.target)
          : selectedNode && (link.source === selectedNode.id || link.target === selectedNode.id);
        link.el.classList.toggle('is-active', Boolean(active));
        link.el.classList.toggle('is-dimmed', Boolean(selectedNode && !active && !exploreEdges));
      });
      const queries = getFilterQueries();
      const filtered = queries.paper || queries.author || queries.topic || activeNodes.length < nodes.length;
      const themeText = queries.theme ? ` · 主题：${queries.theme}` : '';
      statEl.textContent = `${activeNodes.length}/${nodes.length} 篇论文 · ${activeLinks.length}/${links.length} 条关系${filtered || queries.theme ? ' · 已筛选' : ''}${themeText} · 当前：${selectedNode ? shorten(selectedNode.title, 34) : '未选择'}`;
      updateDetail();
    }

    function applyLinkedTheme(theme, publish = false) {
      linkedTheme = theme || null;
      if (linkedTheme) {
        topicInput.value = linkedTheme;
        searchInput.value = '';
        authorInput.value = '';
        nodeLimit.value = String(nodes.length);
        selectedNode = topThemePaper(nodes, linkedTheme) || selectedNode;
      } else {
        topicInput.value = '';
      }
      updateHighlightedIds();
      applyGraphFilters({ refit: true });
      if (publish && selectedNode) {
        const { start, end } = yearFilter.getRange();
        setAppState({ selectedPaperId: selectedNode.id, year: selectedNode.year, yearRangeStart: start, yearRangeEnd: end }, 'paper-force');
      }
    }

    function selectNode(node, publish = false) {
      if (!node) return;
      selectedNode = node;
      updateHighlightedIds();
      if (!activeNodeIds.has(node.id)) applyGraphFilters();
      updateStyles();
      if (publish) {
        const { start, end } = yearFilter.getRange();
        setAppState({ selectedPaperId: node.id, year: node.year, yearRangeStart: start, yearRangeEnd: end }, 'paper-force');
      }
    }

    function renderPositions() {
      linkEls.forEach((line, index) => {
        const link = links[index];
        if (!activeNodeIds.has(link.source) || !activeNodeIds.has(link.target)) return;
        line.setAttribute('x1', link.sourceNode.x);
        line.setAttribute('y1', link.sourceNode.y);
        line.setAttribute('x2', link.targetNode.x);
        line.setAttribute('y2', link.targetNode.y);
      });
      activeNodes.forEach((node) => {
        node.el.setAttribute('transform', `translate(${node.x} ${node.y})`);
      });
    }

    function animate() {
      if (alpha > 0.018) {
        tickObsidianGraph(activeNodes, activeLinks, alpha);
        alpha *= 0.986;
      }
      renderPositions();
      frame = requestAnimationFrame(animate);
    }

    function findPaper(query) {
      const q = normalizeText(query).split('|')[0].trim();
      if (!q) return null;
      return nodes
        .filter((node) => node.search.includes(q) || normalizeText(node.title).includes(q))
        .sort((a, b) => (b.citations_count || 0) - (a.citations_count || 0))[0] || null;
    }

    function focusNode(node, scale = 1.35) {
      if (!node) return;
      const nextK = Math.max(0.35, Math.min(3.6, scale));
      transform = {
        x: WIDTH / 2 - node.x * nextK,
        y: HEIGHT / 2 - node.y * nextK,
        k: nextK
      };
      applyTransform();
      selectNode(node, true);
    }

    function resetView() {
      transform = fitTransform(activeNodes.length ? activeNodes : nodes);
      applyTransform();
      updateStyles();
    }

    svg.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const point = {
        x: ((event.clientX - rect.left) / rect.width) * WIDTH,
        y: ((event.clientY - rect.top) / rect.height) * HEIGHT
      };
      const nextK = Math.max(0.22, Math.min(4.2, transform.k * (event.deltaY > 0 ? 0.9 : 1.12)));
      transform = zoomAt(transform, point, nextK);
      applyTransform();
    }, { passive: false });

    svg.addEventListener('pointerdown', (event) => {
      tooltip.hideNow();
      panning = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
      svg.setPointerCapture(event.pointerId);
    });
    svg.addEventListener('pointermove', (event) => {
      if (draggingNode) {
        const rect = svg.getBoundingClientRect();
        const local = {
          x: ((event.clientX - rect.left) / rect.width) * WIDTH,
          y: ((event.clientY - rect.top) / rect.height) * HEIGHT
        };
        const point = screenToGraph(transform, local.x, local.y);
        draggingNode.node.x = point.x + draggingNode.offsetX;
        draggingNode.node.y = point.y + draggingNode.offsetY;
        draggingNode.node.vx = 0;
        draggingNode.node.vy = 0;
        draggingNode.moved = Math.hypot(event.clientX - draggingNode.startX, event.clientY - draggingNode.startY) > 3;
        alpha = Math.max(alpha, 0.35);
        renderPositions();
        return;
      }
      if (!panning) return;
      const rect = svg.getBoundingClientRect();
      transform.x += ((event.clientX - panning.lastX) / rect.width) * WIDTH;
      transform.y += ((event.clientY - panning.lastY) / rect.height) * HEIGHT;
      panning.lastX = event.clientX;
      panning.lastY = event.clientY;
      applyTransform();
    });
    svg.addEventListener('pointerup', () => {
      if (draggingNode) {
        draggingNode.node.suppressClick = draggingNode.moved;
        draggingNode.node.pinned = false;
        alpha = Math.max(alpha, 0.42);
      }
      draggingNode = null;
      panning = null;
    });
    svg.addEventListener('pointerleave', () => {
      panning = null;
    });

    searchInput.addEventListener('input', () => {
      linkedTheme = null;
      applyGraphFilters({ refit: true });
    });
    searchInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const node = findPaper(searchInput.value);
      if (node) focusNode(node, 1.65);
    });
    authorInput.addEventListener('input', () => {
      linkedTheme = null;
      applyGraphFilters({ refit: true });
    });
    topicInput.addEventListener('input', () => {
      linkedTheme = null;
      applyGraphFilters({ refit: true });
    });
    nodeLimit.addEventListener('change', () => applyGraphFilters({ refit: true }));
    labelMode.addEventListener('change', updateStyles);
    edgeMode.addEventListener('change', updateStyles);
    clearFilterButton.addEventListener('click', () => {
      searchInput.value = '';
      authorInput.value = '';
      topicInput.value = '';
      linkedTheme = null;
      setAppState({ selectedTheme: null }, 'paper-force');
      nodeLimit.value = String(nodes.length);
      selectedNode = pickInitialNode(nodes, getAppState().selectedPaperId, nodeById);
      updateHighlightedIds();
      applyGraphFilters({ refit: true });
    });
    resetButton.addEventListener('click', resetView);
    reheatButton.addEventListener('click', () => {
      nodes.forEach((node, index) => {
        const angle = index * 2.399963 + Math.random() * 0.35;
        const radius = 42 + Math.sqrt(index + 1) * 24;
        node.x = CENTER.x + Math.cos(angle) * radius;
        node.y = CENTER.y + Math.sin(angle) * radius;
        node.vx = 0;
        node.vy = 0;
      });
      alpha = 1.25;
      applyGraphFilters({ refit: true });
    });

    onAppStateChange(({ state, source }) => {
      if (source === 'paper-force') return;
      if (state.selectedTheme !== linkedTheme) {
        applyLinkedTheme(state.selectedTheme, false);
      }
      const node = state.selectedPaperId ? nodeById.get(state.selectedPaperId) : null;
      if (node) {
        selectNode(node, false);
        applyGraphFilters();
      }
    });

    updateHighlightedIds();
    if (linkedTheme) applyLinkedTheme(linkedTheme, false);
    applyGraphFilters();
    resetView();
    focusNode(selectedNode, 1.15);
    animate();

    container.addEventListener('codex:dispose', () => {
      if (frame) cancelAnimationFrame(frame);
    });
  } catch (error) {
    statEl.textContent = '数据加载失败，请检查 nodes.json 和 edges.json。';
    detailEl.textContent = error.message;
    svg.innerHTML = '';
  }
}
