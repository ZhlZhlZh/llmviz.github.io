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
  if (year <= 2005) return 'phase-foundation';
  if (year <= 2015) return 'phase-boom';
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
  // Only include nodes that participate in at least one edge (have citations data)
  const edgeNodeIds = new Set();
  edgesData.forEach((edge) => {
    edgeNodeIds.add(edge.source);
    edgeNodeIds.add(edge.target);
  });
  const connectedNodes = nodesData.filter((node) => edgeNodeIds.has(node.id));

  const minCitations = Math.min(...connectedNodes.map((node) => node.citations_count || 0));
  const maxCitations = Math.max(...connectedNodes.map((node) => node.citations_count || 0));
  const nodes = connectedNodes.map((item, index) => {
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
          <input class="chart-input force-search-input" list="force-paper-list" placeholder="输入论文标题" />
          <datalist id="force-paper-list"></datalist>
        </label>
        <label class="obsidian-search">
          <span>作者</span>
          <input class="chart-input force-author-input" list="force-author-list" placeholder="例如 Ashish Vaswani" />
          <datalist id="force-author-list"></datalist>
        </label>
        <label class="obsidian-search">
          <span>主题</span>
          <input class="chart-input force-topic-input" list="force-topic-list" placeholder="选择或输入 AI 研究主题" />
          <datalist id="force-topic-list"></datalist>
        </label>
        <label class="chart-control">
          节点
          <select class="chart-select force-node-limit">
            <option value="80" selected>80</option>
            <option value="150">150</option>
            <option value="260">260</option>
            <option value="300">300</option>
            <option value="500">500</option>
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
      <div class="force-graph-analysis">
        <span class="force-analysis-label">图分析</span>
        <label class="chart-control">
          拓扑
          <select class="chart-select force-topo-depth">
            <option value="0" selected>关闭</option>
            <option value="1">1阶</option>
            <option value="2">2阶</option>
            <option value="3">3阶</option>
          </select>
        </label>
        <label class="chart-control">
          预设图形
          <select class="chart-select force-topo-preset">
            <option value="none" selected>自定义</option>
            <option value="triangle">三角形 (K3)</option>
            <option value="square">正方形 (C4)</option>
            <option value="star3">三叉星 (K1,3)</option>
            <option value="star4">四叉星 (K1,4)</option>
            <option value="diamond">菱形 (K4-e)</option>
            <option value="path3">路径 (P3)</option>
            <option value="path4">路径 (P4)</option>
            <option value="k4">完全图 (K4)</option>
          </select>
        </label>
        <button class="chart-button force-topo-extract-button" type="button" disabled>提取同构</button>
        <button class="chart-button force-topo-match-button" type="button">匹配图形</button>
        <button class="chart-button force-cut-vertex-button" type="button">割点</button>
        <button class="chart-button force-dominating-button" type="button">最小支配集</button>
        <button class="chart-button force-mst-button" type="button">最小生成树</button>
        <button class="chart-button force-analysis-clear-button" type="button">清除分析</button>
      </div>
      <div class="module-canvas chart-canvas force-canvas">
        <svg class="chart-svg force-svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Paper relation graph"></svg>
        <div class="force-analysis-panel" hidden>
          <div class="force-analysis-panel-header">
            <span class="force-analysis-panel-title">图分析结果</span>
            <button class="force-analysis-panel-close" type="button">×</button>
          </div>
          <svg class="force-analysis-panel-svg" viewBox="0 0 260 260"></svg>
          <div class="force-analysis-panel-info">选中节点后使用图分析工具</div>
        </div>
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
        <span class="legend-chip">节点大小 = 元数据热度</span>
        <span class="legend-chip">连线 = 同主题 / 同作者 / 同类别关系</span>
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
  const topoDepthSelect = container.querySelector('.force-topo-depth');
  const topoPresetSelect = container.querySelector('.force-topo-preset');
  const topoExtractButton = container.querySelector('.force-topo-extract-button');
  const topoMatchButton = container.querySelector('.force-topo-match-button');
  const cutVertexButton = container.querySelector('.force-cut-vertex-button');
  const dominatingButton = container.querySelector('.force-dominating-button');
  const mstButton = container.querySelector('.force-mst-button');
  const analysisClearButton = container.querySelector('.force-analysis-clear-button');
  const analysisPanelSvg = container.querySelector('.force-analysis-panel-svg');
  const analysisPanelInfo = container.querySelector('.force-analysis-panel-info');
  const analysisPanel = container.querySelector('.force-analysis-panel');
  const analysisPanelClose = container.querySelector('.force-analysis-panel-close');
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
    const forceMinYear = Math.min(...allYears, 1993);
    const forceMaxYear = Math.max(...allYears, 2023);
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
      option.value = node.title;
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
      const tooltipHtml = `<strong>${escapeHtml(node.title)}</strong><span>${escapeHtml(node.year)} · ${escapeHtml((node.authors || []).slice(0, 4).join(', ') || '未知作者')}</span><span>热度 ${(node.hotness_score || node.citations_count || 0).toLocaleString()}</span>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">打开论文链接</a>` : ''}`;
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
    // 主题下拉只显示河流图的主题（与 keyword_trends.json 一致）
    const RIVER_THEMES = [
      'Search and Planning',
      'Knowledge Representation and Reasoning',
      'Constraint Solving and Optimization',
      'Machine Learning and Neural Networks',
      'Natural Language Processing and LLMs',
      'Computer Vision and Multimodal AI',
      'Multi-Agent Systems and Game AI',
      'Robotics and Autonomous Systems',
      'Probabilistic and Causal AI',
      'Data Mining and Information Retrieval',
      'AI Safety, Ethics and Explainability',
      'Reinforcement Learning and Decision Making'
    ];
    RIVER_THEMES.forEach((topic) => {
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
      detailEl.innerHTML = `<strong>${selectedNode.title}</strong> (${selectedNode.year}) · ${selectedNode.venue || 'Unknown'}<br />作者：${authors}<br />来源：${institutions}<br />热度：${(selectedNode.hotness_score || selectedNode.citations_count || 0).toLocaleString()} · 相邻节点：${neighbors}<br />关键词：${keywords}`;
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
      if (queries.paper && !normalizeText(node.title).includes(queries.paper)) return false;
      if (queries.author && !(node.authors || []).some((author) => normalizeText(author).includes(queries.author))) return false;
      if (queries.topic && !paperMatchesTheme(node, queries.topic)) return false;
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
          // 扩展至3阶邻居
          let frontier = new Set(seedIds);
          for (let depth = 0; depth < 3; depth++) {
            const nextFrontier = new Set();
            frontier.forEach((id) => {
              (adjacency.get(id) || []).forEach((neighborId) => {
                if (!candidateIds.has(neighborId)) {
                  candidateIds.add(neighborId);
                  nextFrontier.add(neighborId);
                }
              });
            });
            frontier = nextFrontier;
            if (frontier.size === 0) break;
          }
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
        nodeLimit.value = '80';
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
      topoExtractButton.disabled = !selectedNode || topoDepthSelect.value === '0';
      if (publish) {
        const { start, end } = yearFilter.getRange();
        setAppState({ selectedPaperId: node.id, year: node.year, yearRangeStart: start, yearRangeEnd: end }, 'paper-force');
      }
    }

    /* ═══════════════════════════════════════════════════════════════
       Graph Analysis Algorithms (operate on activeNodes/activeLinks)
       ═══════════════════════════════════════════════════════════════ */
    let analysisHighlight = new Set(); // IDs to highlight for analysis results
    let analysisEdges = new Set(); // edge keys "source|target" for MST

    function activeAdjacency() {
      const adj = new Map(activeNodes.map((n) => [n.id, new Set()]));
      activeLinks.forEach((link) => {
        if (adj.has(link.source) && adj.has(link.target)) {
          adj.get(link.source).add(link.target);
          adj.get(link.target).add(link.source);
        }
      });
      return adj;
    }

    function clearAnalysis() {
      analysisHighlight = new Set();
      analysisEdges = new Set();
      nodes.forEach((n) => {
        n.el.classList.remove('is-analysis', 'is-analysis-edge');
      });
      links.forEach((link) => {
        link.el.classList.remove('is-analysis-edge');
      });
      // Restore visibility based on activeNodeIds
      nodes.forEach((n) => {
        n.el.classList.toggle('is-hidden', !activeNodeIds.has(n.id));
      });
      links.forEach((link) => {
        link.el.classList.toggle('is-hidden', !activeNodeIds.has(link.source) || !activeNodeIds.has(link.target));
      });
      detailEl.innerHTML = '';
    }

    function applyAnalysisHighlight(label) {
      nodes.forEach((n) => {
        n.el.classList.toggle('is-analysis', analysisHighlight.has(n.id));
      });
      links.forEach((link) => {
        const key1 = `${link.source}|${link.target}`;
        const key2 = `${link.target}|${link.source}`;
        link.el.classList.toggle('is-analysis-edge', analysisEdges.has(key1) || analysisEdges.has(key2));
      });
      const count = analysisHighlight.size;
      const edgeCount = analysisEdges.size;
      let info = `<strong>${label}</strong>：${count} 个节点`;
      if (edgeCount > 0) info += `，${edgeCount} 条边`;
      detailEl.innerHTML = info;
    }

    // Show only analysis nodes, hide everything else
    function applyAnalysisExclusive(label) {
      nodes.forEach((n) => {
        const inAnalysis = analysisHighlight.has(n.id);
        n.el.classList.toggle('is-analysis', inAnalysis);
        n.el.classList.toggle('is-hidden', !inAnalysis && activeNodeIds.has(n.id));
      });
      links.forEach((link) => {
        const key1 = `${link.source}|${link.target}`;
        const key2 = `${link.target}|${link.source}`;
        const inEdges = analysisEdges.has(key1) || analysisEdges.has(key2);
        const bothVisible = analysisHighlight.has(link.source) && analysisHighlight.has(link.target);
        link.el.classList.toggle('is-analysis-edge', inEdges);
        link.el.classList.toggle('is-hidden', !bothVisible);
      });
      const count = analysisHighlight.size;
      const edgeCount = analysisEdges.size;
      let info = `<strong>${label}</strong>：${count} 个节点`;
      if (edgeCount > 0) info += `，${edgeCount} 条边`;
      detailEl.innerHTML = info;
    }

    // --- 1. Extract k-hop topology from selected node ---
    function extractTopology(depth) {
      if (!selectedNode || !activeNodeIds.has(selectedNode.id)) return new Set();
      const adj = activeAdjacency();
      const visited = new Set([selectedNode.id]);
      let frontier = new Set([selectedNode.id]);
      for (let d = 0; d < depth; d++) {
        const next = new Set();
        frontier.forEach((id) => {
          (adj.get(id) || []).forEach((nid) => {
            if (!visited.has(nid)) {
              visited.add(nid);
              next.add(nid);
            }
          });
        });
        frontier = next;
        if (frontier.size === 0) break;
      }
      return visited;
    }

    // --- 1b. Find isomorphic subgraphs (degree-sequence matching) ---
    function getDegreeSignature(centerIds, adj) {
      const degrees = [];
      centerIds.forEach((id) => {
        const neighbors = adj.get(id) || new Set();
        const internalDeg = Array.from(neighbors).filter((nid) => centerIds.has(nid)).length;
        degrees.push(internalDeg);
      });
      return degrees.sort((a, b) => a - b).join(',');
    }

    // Preset graph patterns: { nodeCount, degreeSignature, label, edgeCount }
    const PRESET_PATTERNS = {
      triangle:  { nodeCount: 3, sig: '2,2,2', label: '三角形 (K3)', edgeCount: 3 },
      square:    { nodeCount: 4, sig: '2,2,2,2', label: '正方形 (C4)', edgeCount: 4 },
      star3:     { nodeCount: 4, sig: '1,1,1,3', label: '三叉星 (K1,3)', edgeCount: 3 },
      star4:     { nodeCount: 5, sig: '1,1,1,1,4', label: '四叉星 (K1,4)', edgeCount: 4 },
      diamond:   { nodeCount: 4, sig: '2,2,3,3', label: '菱形 (K4-e)', edgeCount: 5 },
      path3:     { nodeCount: 3, sig: '1,1,2', label: '路径 (P3)', edgeCount: 2 },
      path4:     { nodeCount: 4, sig: '1,1,2,2', label: '路径 (P4)', edgeCount: 3 },
      k4:        { nodeCount: 4, sig: '3,3,3,3', label: '完全图 (K4)', edgeCount: 6 },
    };

    // Find all subgraphs matching a preset degree signature
    function findPresetMatches(preset) {
      const pattern = PRESET_PATTERNS[preset];
      if (!pattern) return;
      const adj = activeAdjacency();
      const targetSig = pattern.sig;
      const targetSize = pattern.nodeCount;
      const matches = new Set();
      let groupCount = 0;

      // For each node, try to find a connected subgraph of targetSize with matching signature
      activeNodes.forEach((startNode) => {
        if (matches.has(startNode.id)) return;
        // BFS to collect subgraphs of exact size
        const candidates = findConnectedSubgraphs(startNode.id, targetSize, adj);
        candidates.forEach((subgraph) => {
          const sig = getDegreeSignature(subgraph, adj);
          if (sig === targetSig) {
            // Check no overlap with already matched
            let overlaps = false;
            subgraph.forEach((id) => { if (matches.has(id)) overlaps = true; });
            if (!overlaps) {
              subgraph.forEach((id) => matches.add(id));
              groupCount++;
            }
          }
        });
      });

      // Collect internal edges
      const matchEdges = new Set();
      activeLinks.forEach((link) => {
        if (matches.has(link.source) && matches.has(link.target)) {
          const key = link.source < link.target ? `${link.source}|${link.target}` : `${link.target}|${link.source}`;
          matchEdges.add(key);
        }
      });

      analysisHighlight = matches;
      analysisEdges = matchEdges;
      applyAnalysisExclusive(`${pattern.label} 匹配`);
      renderPresetInPanel(preset, groupCount);
    }

    // Find connected subgraphs of exact size starting from a node (limited search)
    function findConnectedSubgraphs(startId, size, adj) {
      const results = [];
      if (size === 1) { results.push(new Set([startId])); return results; }

      // DFS-based enumeration with pruning (limit attempts)
      const maxAttempts = 200;
      let attempts = 0;

      function dfs(current, visited) {
        if (visited.size === size) { results.push(new Set(visited)); return; }
        if (attempts++ > maxAttempts) return;
        const neighbors = adj.get(current) || new Set();
        for (const nid of neighbors) {
          if (visited.has(nid)) continue;
          // Check connectivity: nid must be adjacent to at least one visited node
          visited.add(nid);
          dfs(nid, visited);
          visited.delete(nid);
          if (results.length >= 3) return; // enough for this start node
        }
      }

      dfs(startId, new Set([startId]));
      return results;
    }

    // Render preset pattern shape in panel
    function renderPresetInPanel(preset, groupCount) {
      const pattern = PRESET_PATTERNS[preset];
      if (!pattern) return;
      analysisPanelSvg.innerHTML = '';
      const size = 260;
      const center = size / 2;
      const r = 60;

      // Draw the ideal shape
      const n = pattern.nodeCount;
      const points = [];
      for (let i = 0; i < n; i++) {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
        points.push({ x: center + Math.cos(angle) * r, y: center + Math.sin(angle) * r });
      }

      // Draw edges based on pattern type
      const edges = getPresetEdges(preset, n);
      edges.forEach(([a, b]) => {
        analysisPanelSvg.appendChild(createSvgElement('line', {
          x1: points[a].x, y1: points[a].y, x2: points[b].x, y2: points[b].y,
          stroke: '#94a3b8', 'stroke-width': 2
        }));
      });

      // Draw nodes
      points.forEach((p, i) => {
        analysisPanelSvg.appendChild(createSvgElement('circle', {
          cx: p.x, cy: p.y, r: 8, fill: '#176b87', stroke: '#fff', 'stroke-width': 1.5
        }));
      });

      analysisPanelInfo.innerHTML = `<strong>${pattern.label}</strong><br>${pattern.nodeCount} 节点，${pattern.edgeCount} 条边<br>度序列：[${pattern.sig}]<br>匹配到 <strong>${groupCount}</strong> 组`;
      analysisPanel.hidden = false;
    }

    function getPresetEdges(preset, n) {
      switch (preset) {
        case 'triangle': return [[0,1],[1,2],[2,0]];
        case 'square': return [[0,1],[1,2],[2,3],[3,0]];
        case 'star3': return [[0,1],[0,2],[0,3]]; // node 0 is center
        case 'star4': return [[0,1],[0,2],[0,3],[0,4]];
        case 'diamond': return [[0,1],[1,2],[2,3],[3,0],[0,2]]; // K4 minus one edge
        case 'path3': return [[0,1],[1,2]];
        case 'path4': return [[0,1],[1,2],[2,3]];
        case 'k4': return [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
        default: return [];
      }
    }

    function findIsomorphicSubgraphs(depth) {
      if (!selectedNode) return;
      const adj = activeAdjacency();
      const refIds = extractTopology(depth);
      const refSig = getDegreeSignature(refIds, adj);
      const refSize = refIds.size;
      const matches = new Set(refIds);
      let groupCount = 1;

      activeNodes.forEach((node) => {
        if (refIds.has(node.id)) return;
        const visited = new Set([node.id]);
        let frontier = new Set([node.id]);
        for (let d = 0; d < depth; d++) {
          const next = new Set();
          frontier.forEach((id) => {
            (adj.get(id) || []).forEach((nid) => {
              if (!visited.has(nid)) { visited.add(nid); next.add(nid); }
            });
          });
          frontier = next;
          if (frontier.size === 0) break;
        }
        if (visited.size === refSize) {
          const sig = getDegreeSignature(visited, adj);
          if (sig === refSig) { visited.forEach((id) => matches.add(id)); groupCount++; }
        }
      });

      // Collect internal edges of matched subgraphs
      const matchEdges = new Set();
      activeLinks.forEach((link) => {
        if (matches.has(link.source) && matches.has(link.target)) {
          const key = link.source < link.target ? `${link.source}|${link.target}` : `${link.target}|${link.source}`;
          matchEdges.add(key);
        }
      });

      analysisHighlight = matches;
      analysisEdges = matchEdges;
      applyAnalysisExclusive(`${depth}阶同构匹配`);

      // Render the reference topology in side panel
      renderSubgraphInPanel(refIds, `${depth}阶同构图`, `匹配到 <strong>${groupCount}</strong> 组（每组 ${refSize} 节点）`);
    }

    // Extract topology: show in the side analysis panel
    function extractAndShowTopology(depth) {
      if (!selectedNode) return;
      const topoIds = extractTopology(depth);
      if (topoIds.size === 0) return;

      // Compute in-degree and out-degree for subgraph nodes
      const subNodes = activeNodes.filter((n) => topoIds.has(n.id));
      const inDeg = new Map(subNodes.map((n) => [n.id, 0]));
      const outDeg = new Map(subNodes.map((n) => [n.id, 0]));
      activeLinks.forEach((link) => {
        if (topoIds.has(link.source) && topoIds.has(link.target)) {
          outDeg.set(link.source, (outDeg.get(link.source) || 0) + 1);
          inDeg.set(link.target, (inDeg.get(link.target) || 0) + 1);
        }
      });
      const inSeq = subNodes.map((n) => inDeg.get(n.id) || 0).sort((a, b) => b - a).join(', ');
      const outSeq = subNodes.map((n) => outDeg.get(n.id) || 0).sort((a, b) => b - a).join(', ');

      renderSubgraphInPanel(topoIds, `${depth}阶拓扑子图`, `入度序列：[${inSeq}]<br>出度序列：[${outSeq}]`);
    }

    // Render a subgraph into the analysis side panel
    function renderSubgraphInPanel(nodeIds, title, extraInfo) {
      const subNodes = activeNodes.filter((n) => nodeIds.has(n.id));
      const subEdges = [];
      activeLinks.forEach((link) => {
        if (nodeIds.has(link.source) && nodeIds.has(link.target)) {
          subEdges.push({ source: link.source, target: link.target });
        }
      });

      const size = 240;
      const center = size / 2;
      analysisPanelSvg.innerHTML = '';

      if (subNodes.length === 0) {
        analysisPanelInfo.innerHTML = '无结果';
        return;
      }

      // Position nodes in circle then run mini force
      const positions = new Map();
      subNodes.forEach((node, i) => {
        const angle = (2 * Math.PI * i) / subNodes.length;
        const r = size * 0.32;
        positions.set(node.id, {
          x: center + Math.cos(angle) * r * (0.6 + Math.random() * 0.4),
          y: center + Math.sin(angle) * r * (0.6 + Math.random() * 0.4)
        });
      });

      for (let iter = 0; iter < 60; iter++) {
        subNodes.forEach((a) => {
          const pa = positions.get(a.id);
          subNodes.forEach((b) => {
            if (a.id === b.id) return;
            const pb = positions.get(b.id);
            const dx = pa.x - pb.x;
            const dy = pa.y - pb.y;
            const dist = Math.max(Math.hypot(dx, dy), 1);
            const force = 600 / (dist * dist);
            pa.x += (dx / dist) * force;
            pa.y += (dy / dist) * force;
          });
        });
        subEdges.forEach((e) => {
          const pa = positions.get(e.source);
          const pb = positions.get(e.target);
          if (!pa || !pb) return;
          const dx = pb.x - pa.x;
          const dy = pb.y - pa.y;
          const dist = Math.max(Math.hypot(dx, dy), 1);
          const force = (dist - 40) * 0.02;
          pa.x += (dx / dist) * force;
          pa.y += (dy / dist) * force;
          pb.x -= (dx / dist) * force;
          pb.y -= (dy / dist) * force;
        });
        subNodes.forEach((n) => {
          const p = positions.get(n.id);
          p.x += (center - p.x) * 0.03;
          p.y += (center - p.y) * 0.03;
        });
      }

      // Normalize to fit
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      positions.forEach((p) => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
      const span = Math.max(maxX - minX, maxY - minY, 1);
      const pad = 28;
      const scale = (size - pad * 2) / span;
      positions.forEach((p) => { p.x = pad + (p.x - minX) * scale; p.y = pad + (p.y - minY) * scale; });

      // Draw edges
      subEdges.forEach((e) => {
        const pa = positions.get(e.source);
        const pb = positions.get(e.target);
        if (!pa || !pb) return;
        analysisPanelSvg.appendChild(createSvgElement('line', { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, stroke: '#94a3b8', 'stroke-width': 1.2 }));
      });

      // Draw nodes
      subNodes.forEach((node) => {
        const p = positions.get(node.id);
        const isCenter = selectedNode && node.id === selectedNode.id;
        const r = isCenter ? 7 : 4.5;
        analysisPanelSvg.appendChild(createSvgElement('circle', { cx: p.x, cy: p.y, r, fill: isCenter ? '#e11d48' : '#176b87', stroke: '#fff', 'stroke-width': 1 }));
        const deg = subEdges.filter((e) => e.source === node.id || e.target === node.id).length;
        if (isCenter || deg >= 3 || subNodes.length <= 10) {
          const label = createSvgElement('text', { x: p.x, y: p.y - r - 3, 'text-anchor': 'middle', 'font-size': '7.5', fill: '#334155', 'font-weight': '600' });
          label.textContent = shorten(node.title, 16);
          analysisPanelSvg.appendChild(label);
        }
      });

      analysisPanelInfo.innerHTML = `<strong>${title}</strong><br>${subNodes.length} 节点，${subEdges.length} 条边<br>${extraInfo || ''}`;
      analysisPanel.hidden = false;
    }

    // Render dots (for cut vertices / dominating set)
    function renderDotsInPanel(nodeIds, title, extraInfo) {
      analysisPanelSvg.innerHTML = '';
      const items = activeNodes.filter((n) => nodeIds.has(n.id));
      const size = 260;
      const cols = Math.ceil(Math.sqrt(items.length));
      const cellSize = Math.min((size - 20) / (cols + 1), 28);

      items.forEach((node, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cx = cellSize + col * cellSize;
        const cy = cellSize + row * cellSize;
        const g = createSvgElement('g', { class: 'analysis-dot-group', style: 'cursor:pointer' });
        g.appendChild(createSvgElement('circle', { cx, cy, r: 6, fill: '#e11d48', stroke: '#fff', 'stroke-width': 1.2 }));
        const label = createSvgElement('text', { x: cx, y: cy + 14, 'text-anchor': 'middle', 'font-size': '6.5', fill: '#475569' });
        label.textContent = shorten(node.title, 14);
        g.appendChild(label);
        g.addEventListener('click', () => focusNode(node, 1.5));
        analysisPanelSvg.appendChild(g);
      });

      analysisPanelInfo.innerHTML = `<strong>${title}</strong><br>${items.length} 个节点<br><em style="font-size:10px;color:#94a3b8">点击圆点定位到图中</em>${extraInfo ? '<br>' + extraInfo : ''}`;
      analysisPanel.hidden = false;
    }

    // Render MST as a top-to-bottom tree sorted by year
    function renderMSTTreeInPanel(mstNodeIds, mstEdgeKeys) {
      analysisPanelSvg.innerHTML = '';
      const mstNodeList = activeNodes.filter((n) => mstNodeIds.has(n.id)).sort((a, b) => a.year - b.year);
      if (mstNodeList.length === 0) { analysisPanelInfo.innerHTML = '无结果'; analysisPanel.hidden = false; return; }

      // Build adjacency from MST edges only
      const adj = new Map(mstNodeList.map((n) => [n.id, []]));
      mstEdgeKeys.forEach((key) => {
        const [a, b] = key.split('|');
        if (adj.has(a) && adj.has(b)) { adj.get(a).push(b); adj.get(b).push(a); }
      });

      // BFS from root (selected node or earliest) to build tree levels
      const root = mstNodeIds.has(selectedNode?.id) ? selectedNode.id : mstNodeList[0].id;
      const levels = [];
      const visited = new Set([root]);
      const parentOf = new Map();
      let frontier = [root];
      while (frontier.length) {
        levels.push([...frontier]);
        const next = [];
        frontier.forEach((id) => {
          (adj.get(id) || []).forEach((nid) => {
            if (!visited.has(nid)) { visited.add(nid); parentOf.set(nid, id); next.push(nid); }
          });
        });
        frontier = next;
      }

      // Layout: levels top to bottom, nodes spread horizontally
      const size = 260;
      const padX = 20;
      const padY = 24;
      const levelHeight = Math.min(40, (size - padY * 2) / Math.max(levels.length - 1, 1));
      const positions = new Map();

      levels.forEach((level, li) => {
        const y = padY + li * levelHeight;
        const spacing = (size - padX * 2) / Math.max(level.length + 1, 2);
        level.forEach((id, ni) => {
          positions.set(id, { x: padX + spacing * (ni + 1), y });
        });
      });

      // Draw edges (parent -> child)
      parentOf.forEach((parentId, childId) => {
        const pp = positions.get(parentId);
        const cp = positions.get(childId);
        if (!pp || !cp) return;
        analysisPanelSvg.appendChild(createSvgElement('line', { x1: pp.x, y1: pp.y, x2: cp.x, y2: cp.y, stroke: '#94a3b8', 'stroke-width': 1.2 }));
      });

      // Draw nodes
      const nodeMap = new Map(mstNodeList.map((n) => [n.id, n]));
      positions.forEach((p, id) => {
        const node = nodeMap.get(id);
        if (!node) return;
        const isRoot = id === root;
        const r = isRoot ? 6 : 4;
        const g = createSvgElement('g', { style: 'cursor:pointer' });
        g.appendChild(createSvgElement('circle', { cx: p.x, cy: p.y, r, fill: isRoot ? '#e11d48' : '#176b87', stroke: '#fff', 'stroke-width': 1 }));
        // Show year + short title
        if (mstNodeList.length <= 20 || isRoot || levels.find((l) => l.length <= 3 && l.includes(id))) {
          const label = createSvgElement('text', { x: p.x + r + 3, y: p.y + 3, 'font-size': '6.5', fill: '#334155' });
          label.textContent = `${node.year} ${shorten(node.title, 12)}`;
          g.appendChild(label);
        }
        g.addEventListener('click', () => focusNode(node, 1.5));
        analysisPanelSvg.appendChild(g);
      });

      analysisPanelInfo.innerHTML = `<strong>最小生成树</strong><br>${mstNodeList.length} 节点，${mstEdgeKeys.size} 条边，${levels.length} 层<br>根节点：${shorten(nodeMap.get(root)?.title || '', 22)}<br><em style="font-size:10px;color:#94a3b8">点击节点定位到图中</em>`;
      analysisPanel.hidden = false;
    }

    // --- 2. Articulation points (cut vertices) ---
    function findCutVertices() {
      const adj = activeAdjacency();
      const ids = Array.from(adj.keys());
      const disc = new Map();
      const low = new Map();
      const parent = new Map();
      const ap = new Set();
      let timer = 0;

      function dfs(u) {
        disc.set(u, timer);
        low.set(u, timer);
        timer++;
        let children = 0;
        (adj.get(u) || []).forEach((v) => {
          if (!disc.has(v)) {
            children++;
            parent.set(v, u);
            dfs(v);
            low.set(u, Math.min(low.get(u), low.get(v)));
            if (!parent.has(u) && children > 1) ap.add(u);
            if (parent.has(u) && low.get(v) >= disc.get(u)) ap.add(u);
          } else if (v !== parent.get(u)) {
            low.set(u, Math.min(low.get(u), disc.get(v)));
          }
        });
      }

      ids.forEach((id) => { if (!disc.has(id)) dfs(id); });
      return ap;
    }

    // --- 3. Greedy minimum dominating set ---
    function findMinDominatingSet() {
      const adj = activeAdjacency();
      const dominated = new Set();
      const domSet = new Set();
      const remaining = new Set(activeNodes.map((n) => n.id));

      while (dominated.size < remaining.size) {
        let bestNode = null;
        let bestGain = -1;
        remaining.forEach((id) => {
          if (domSet.has(id)) return;
          let gain = dominated.has(id) ? 0 : 1;
          (adj.get(id) || []).forEach((nid) => {
            if (remaining.has(nid) && !dominated.has(nid)) gain++;
          });
          if (gain > bestGain) { bestGain = gain; bestNode = id; }
        });
        if (!bestNode || bestGain <= 0) break;
        domSet.add(bestNode);
        dominated.add(bestNode);
        (adj.get(bestNode) || []).forEach((nid) => {
          if (remaining.has(nid)) dominated.add(nid);
        });
      }
      return domSet;
    }

    // --- 4. Minimum spanning tree (Kruskal on connected component) ---
    function findMST() {
      if (!selectedNode || !activeNodeIds.has(selectedNode.id)) return { nodes: new Set(), edges: new Set() };
      const adj = activeAdjacency();

      // BFS to find connected component
      const component = new Set([selectedNode.id]);
      const queue = [selectedNode.id];
      while (queue.length) {
        const u = queue.shift();
        (adj.get(u) || []).forEach((v) => {
          if (!component.has(v)) { component.add(v); queue.push(v); }
        });
      }

      // Collect edges in component with weight = 1/(citations of target + source)
      const edges = [];
      const seen = new Set();
      activeLinks.forEach((link) => {
        if (!component.has(link.source) || !component.has(link.target)) return;
        const key = link.source < link.target ? `${link.source}|${link.target}` : `${link.target}|${link.source}`;
        if (seen.has(key)) return;
        seen.add(key);
        const sNode = nodeById.get(link.source);
        const tNode = nodeById.get(link.target);
        // Weight: prefer edges between high-citation nodes (lower weight = better)
        const weight = 1 / (Math.log10((sNode?.citations_count || 0) + 10) + Math.log10((tNode?.citations_count || 0) + 10));
        edges.push({ source: link.source, target: link.target, weight, key });
      });
      edges.sort((a, b) => a.weight - b.weight);

      // Union-Find
      const parentMap = new Map();
      function find(x) {
        if (!parentMap.has(x)) parentMap.set(x, x);
        if (parentMap.get(x) !== x) parentMap.set(x, find(parentMap.get(x)));
        return parentMap.get(x);
      }
      function union(a, b) { parentMap.set(find(a), find(b)); }

      const mstEdges = new Set();
      const mstNodes = new Set();
      edges.forEach((e) => {
        if (find(e.source) !== find(e.target)) {
          union(e.source, e.target);
          mstEdges.add(e.key);
          mstNodes.add(e.source);
          mstNodes.add(e.target);
        }
      });
      return { nodes: mstNodes, edges: mstEdges };
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
      nodeLimit.value = '80';
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

    // --- Graph Analysis Event Listeners ---
    topoDepthSelect.addEventListener('change', () => {
      const depth = Number(topoDepthSelect.value);
      topoExtractButton.disabled = depth === 0 || !selectedNode;
      if (depth === 0 && topoPresetSelect.value === 'none') { clearAnalysis(); applyGraphFilters(); }
    });

    topoPresetSelect.addEventListener('change', () => {
      const preset = topoPresetSelect.value;
      if (preset !== 'none') {
        topoDepthSelect.value = '0';
        topoExtractButton.disabled = true;
      }
    });

    topoExtractButton.addEventListener('click', () => {
      const depth = Number(topoDepthSelect.value);
      if (depth === 0 || !selectedNode) return;
      extractAndShowTopology(depth);
    });

    topoMatchButton.addEventListener('click', () => {
      const preset = topoPresetSelect.value;
      if (preset !== 'none') {
        // Use preset pattern
        findPresetMatches(preset);
      } else {
        // Use custom topology from selected node
        const depth = Number(topoDepthSelect.value);
        if (depth === 0 || !selectedNode) return;
        findIsomorphicSubgraphs(depth);
      }
    });

    cutVertexButton.addEventListener('click', () => {
      clearAnalysis();
      const cuts = findCutVertices();
      analysisHighlight = cuts;
      applyAnalysisHighlight(`割点（移除后图不连通）`);
      renderDotsInPanel(cuts, '割点', '移除这些节点后图将不连通');
    });

    dominatingButton.addEventListener('click', () => {
      clearAnalysis();
      const domSet = findMinDominatingSet();
      analysisHighlight = domSet;
      applyAnalysisHighlight(`贪心最小支配集`);
      renderDotsInPanel(domSet, '最小支配集', '每个节点都与支配集中至少一个节点相邻');
    });

    mstButton.addEventListener('click', () => {
      if (!selectedNode) { analysisPanelInfo.innerHTML = '请先选中一个节点'; return; }
      clearAnalysis();
      const { nodes: mstNodes, edges: mstEdgeKeys } = findMST();
      analysisHighlight = mstNodes;
      analysisEdges = mstEdgeKeys;
      applyAnalysisHighlight(`最小生成树`);
      renderMSTTreeInPanel(mstNodes, mstEdgeKeys);
    });

    analysisClearButton.addEventListener('click', () => {
      clearAnalysis();
      analysisPanelSvg.innerHTML = '';
      analysisPanelInfo.innerHTML = '选中节点后使用图分析工具';
      analysisPanel.hidden = true;
    });

    analysisPanelClose.addEventListener('click', () => {
      analysisPanel.hidden = true;
    });

    // Drag to move analysis panel
    {
      let dragging = false;
      let offsetX = 0;
      let offsetY = 0;
      const header = container.querySelector('.force-analysis-panel-header');
      header.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.force-analysis-panel-close')) return;
        dragging = true;
        const rect = analysisPanel.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        header.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      header.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const parent = analysisPanel.offsetParent || canvas;
        const parentRect = parent.getBoundingClientRect();
        const x = e.clientX - parentRect.left - offsetX;
        const y = e.clientY - parentRect.top - offsetY;
        analysisPanel.style.left = `${x}px`;
        analysisPanel.style.top = `${y}px`;
        analysisPanel.style.right = 'auto';
      });
      header.addEventListener('pointerup', () => { dragging = false; });
      header.addEventListener('pointercancel', () => { dragging = false; });
    }

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
