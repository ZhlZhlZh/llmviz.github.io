import { loadJson } from '../../shared/data-loader.js';
import { getAppState, onAppStateChange, setAppState } from '../../shared/app-state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgElement(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
  return el;
}

function shorten(text, maxLength) {
  if (!text || text.length <= maxLength) return text || '';
  return `${text.slice(0, maxLength - 1)}...`;
}

function phaseClassByYear(year) {
  if (year <= 2017) return 'phase-foundation';
  if (year <= 2022) return 'phase-boom';
  return 'phase-agentic';
}

function buildAdjacency(nodes, edges) {
  const adjacency = new Map(nodes.map((node) => [node.id, new Set()]));
  edges.forEach((edge) => {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) return;
    adjacency.get(edge.source).add(edge.target);
    adjacency.get(edge.target).add(edge.source);
  });
  return adjacency;
}

function shortestPath(adjacency, startId, endId, allowedSet) {
  if (!startId || !endId) return [];
  if (startId === endId) return [startId];
  const queue = [startId];
  const prev = new Map();
  const visited = new Set([startId]);

  while (queue.length) {
    const current = queue.shift();
    for (const next of adjacency.get(current) || []) {
      if (!allowedSet.has(next) || visited.has(next)) continue;
      visited.add(next);
      prev.set(next, current);
      if (next === endId) {
        const path = [endId];
        let cursor = endId;
        while (prev.has(cursor)) {
          cursor = prev.get(cursor);
          path.push(cursor);
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return [];
}

function collectNeighborhood(centerId, adjacency, maxNodes) {
  if (!centerId) return new Set();
  const selected = new Set([centerId]);
  const queue = [{ id: centerId, depth: 0 }];
  let cursor = 0;

  while (cursor < queue.length && selected.size < maxNodes) {
    const { id, depth } = queue[cursor];
    cursor += 1;
    if (depth >= 3) continue;
    Array.from(adjacency.get(id) || []).forEach((next) => {
      if (selected.size >= maxNodes || selected.has(next)) return;
      selected.add(next);
      queue.push({ id: next, depth: depth + 1 });
    });
  }
  return selected;
}

function edgeKey(a, b) {
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

function mapRange(value, domainMin, domainMax, rangeMin, rangeMax) {
  if (domainMin === domainMax) return (rangeMin + rangeMax) / 2;
  return rangeMin + ((value - domainMin) / (domainMax - domainMin)) * (rangeMax - rangeMin);
}

export async function initButterflyPath(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="module-shell">
      <p class="module-tag">Module 03</p>
      <h3 class="module-title">蝴蝶影响路径图</h3>
      <p class="module-subtitle">既可不选中心、按年份浏览全局论文空间，也可选择中心和目标论文来高亮最短影响路径；画布支持缩放、平移和节点拖动。</p>
      <div class="chart-toolbar chart-toolbar-wrap">
        <label class="chart-control">
          年份
          <input class="chart-range butterfly-year-range" type="range" min="2013" max="2026" step="1" value="2026" />
          <output class="year-badge butterfly-year-output">2026</output>
        </label>
        <label class="chart-control">
          中心论文
          <select class="chart-select butterfly-center-select"></select>
        </label>
        <label class="chart-control">
          搜索中心
          <input class="chart-input butterfly-center-search" list="butterfly-paper-list" placeholder="标题 / 作者 / 机构" />
        </label>
        <label class="chart-control">
          相关论文
          <select class="chart-select butterfly-target-select"></select>
        </label>
        <label class="chart-control">
          搜索相关
          <input class="chart-input butterfly-target-search" list="butterfly-paper-list" placeholder="标题 / 作者 / 机构" />
        </label>
        <label class="chart-control">
          最大节点
          <input class="chart-number butterfly-max-input" type="number" min="25" max="140" step="5" value="70" />
        </label>
        <button class="chart-button butterfly-clear-button" type="button">清除选择</button>
        <datalist id="butterfly-paper-list"></datalist>
        <div class="chart-stat" aria-live="polite">加载中...</div>
      </div>
      <div class="module-canvas chart-canvas butterfly-canvas">
        <svg class="chart-svg butterfly-svg" viewBox="0 0 900 500" role="img" aria-label="Butterfly network path chart"></svg>
      </div>
      <div class="chart-detail butterfly-detail"></div>
      <div class="legend-row">
        <span class="legend-chip">无中心 = 全局年份网络</span>
        <span class="legend-chip">中心 + 相关 = 路径高亮</span>
        <span class="legend-chip">点击节点 = 选择相关论文</span>
      </div>
    </div>
  `;

  const yearRange = container.querySelector('.butterfly-year-range');
  const yearOutput = container.querySelector('.butterfly-year-output');
  const centerSelect = container.querySelector('.butterfly-center-select');
  const targetSelect = container.querySelector('.butterfly-target-select');
  const centerSearch = container.querySelector('.butterfly-center-search');
  const targetSearch = container.querySelector('.butterfly-target-search');
  const paperList = container.querySelector('#butterfly-paper-list');
  const maxInput = container.querySelector('.butterfly-max-input');
  const clearButton = container.querySelector('.butterfly-clear-button');
  const statEl = container.querySelector('.chart-stat');
  const detailEl = container.querySelector('.butterfly-detail');
  const svg = container.querySelector('.butterfly-svg');

  if (!yearRange || !yearOutput || !centerSelect || !targetSelect || !centerSearch || !targetSearch || !paperList || !maxInput || !clearButton || !statEl || !detailEl || !svg) return;

  try {
    const [nodesData, edgesData] = await Promise.all([
      loadJson('./data/processed/nodes.json'),
      loadJson('./data/processed/edges.json')
    ]);

    const width = 900;
    const height = 500;
    const margin = { top: 28, right: 30, bottom: 40, left: 42 };
    const minYear = Math.min(...nodesData.map((node) => node.year));
    const maxYear = Math.max(...nodesData.map((node) => node.year));
    const topics = Array.from(new Set(nodesData.map((node) => node.topic || 'other'))).sort();
    const nodeById = new Map(nodesData.map((node) => [node.id, { ...node, x: 0, y: 0, fixed: false }]));
    const nodes = Array.from(nodeById.values());
    const adjacency = buildAdjacency(nodes, edgesData);
    const links = edgesData
      .map((edge) => ({ ...edge, sourceNode: nodeById.get(edge.source), targetNode: nodeById.get(edge.target) }))
      .filter((edge) => edge.sourceNode && edge.targetNode);

    let centerId = getAppState().selectedPaperId || '';
    let targetId = '';
    let visibleIds = new Set();
    let visibleLinks = [];
    let pathIds = [];
    let transform = { x: 0, y: 0, k: 1 };
    let draggingNode = null;
    let panning = null;

    const viewport = createSvgElement('g', { class: 'graph-viewport' });
    const edgeLayer = createSvgElement('g');
    const nodeLayer = createSvgElement('g');
    viewport.append(edgeLayer, nodeLayer);
    svg.appendChild(viewport);

    function applyTransform() {
      viewport.setAttribute('transform', `translate(${transform.x} ${transform.y}) scale(${transform.k})`);
    }

    function optionText(node) {
      return `${node.year} | ${shorten(node.title, 42)}`;
    }

    function fillSelect(select, includeNone = true) {
      select.innerHTML = '';
      if (includeNone) {
        const none = document.createElement('option');
        none.value = '';
        none.textContent = '不选择，显示全局网络';
        select.appendChild(none);
      }
      nodes
        .slice()
        .sort((a, b) => a.year - b.year || b.citations_count - a.citations_count)
        .forEach((node) => {
          const option = document.createElement('option');
          option.value = node.id;
          option.textContent = optionText(node);
          select.appendChild(option);
        });
    }

    fillSelect(centerSelect, true);
    fillSelect(targetSelect, true);
    nodes.forEach((node) => {
      const option = document.createElement('option');
      option.value = `${node.title} | ${(node.authors || []).join(', ')} | ${node.institution}`;
      paperList.appendChild(option);
    });

    function findPaper(query) {
      const q = query.trim().toLowerCase();
      if (!q) return null;
      return nodes
        .filter((node) => {
          const haystack = `${node.title} ${(node.authors || []).join(' ')} ${node.institution}`.toLowerCase();
          return haystack.includes(q);
        })
        .sort((a, b) => b.citations_count - a.citations_count)[0] || null;
    }

    function layout(ids) {
      const groupedByYear = new Map();
      Array.from(ids).forEach((id) => {
        const node = nodeById.get(id);
        if (!node) return;
        if (!groupedByYear.has(node.year)) groupedByYear.set(node.year, []);
        groupedByYear.get(node.year).push(node);
      });

      Array.from(groupedByYear.entries()).forEach(([year, group]) => {
        group.sort((a, b) => topics.indexOf(a.topic) - topics.indexOf(b.topic) || b.citations_count - a.citations_count);
        group.forEach((node, index) => {
          if (node.fixed) return;
          const topicIndex = Math.max(0, topics.indexOf(node.topic));
          const laneY = mapRange(topicIndex, 0, Math.max(topics.length - 1, 1), margin.top + 30, height - margin.bottom);
          node.x = mapRange(year, minYear, maxYear, margin.left, width - margin.right) + ((index % 3) - 1) * 18;
          node.y = laneY + (Math.floor(index / 3) % 5 - 2) * 14;
        });
      });
    }

    function buildVisibleIds() {
      const activeYear = Number(yearRange.value);
      const maxNodes = Number(maxInput.value) || 70;
      const eligible = nodes.filter((node) => node.year <= activeYear);
      const eligibleSet = new Set(eligible.map((node) => node.id));

      if (centerId && eligibleSet.has(centerId)) {
        const neighborhood = collectNeighborhood(centerId, adjacency, maxNodes * 2);
        const ids = Array.from(neighborhood)
          .map((id) => nodeById.get(id))
          .filter((node) => node && eligibleSet.has(node.id))
          .sort((a, b) => {
            if (a.id === centerId) return -1;
            if (b.id === centerId) return 1;
            return b.citations_count - a.citations_count;
          })
          .slice(0, maxNodes)
          .map((node) => node.id);
        return new Set(ids);
      }

      return new Set(
        eligible
          .slice()
          .sort((a, b) => b.citations_count - a.citations_count)
          .slice(0, maxNodes)
          .map((node) => node.id)
      );
    }

    function render() {
      yearOutput.textContent = yearRange.value;
      centerSelect.value = centerId;
      targetSelect.value = targetId;
      visibleIds = buildVisibleIds();
      if (targetId) visibleIds.add(targetId);
      if (centerId) visibleIds.add(centerId);
      layout(visibleIds);

      pathIds = centerId && targetId ? shortestPath(adjacency, centerId, targetId, visibleIds) : [];
      const pathSet = new Set(pathIds);
      const pathEdges = new Set();
      for (let i = 0; i < pathIds.length - 1; i += 1) pathEdges.add(edgeKey(pathIds[i], pathIds[i + 1]));
      visibleLinks = links.filter((link) => visibleIds.has(link.source) && visibleIds.has(link.target));

      edgeLayer.innerHTML = '';
      nodeLayer.innerHTML = '';

      visibleLinks.forEach((link) => {
        const onPath = pathEdges.has(edgeKey(link.source, link.target));
        const line = createSvgElement('line', {
          class: onPath ? 'butterfly-network-link is-path' : 'butterfly-network-link'
        });
        edgeLayer.appendChild(line);
        link.el = line;
      });

      Array.from(visibleIds).forEach((id) => {
        const node = nodeById.get(id);
        if (!node) return;
        const group = createSvgElement('g', {
          class: [
            'butterfly-network-node-group',
            phaseClassByYear(node.year),
            node.id === centerId ? 'is-center' : '',
            node.id === targetId ? 'is-target' : '',
            pathSet.has(node.id) ? 'is-path' : ''
          ].filter(Boolean).join(' '),
          'data-id': node.id
        });
        const circle = createSvgElement('circle', { r: node.id === centerId ? 9 : 6, class: 'butterfly-network-node' });
        const label = createSvgElement('text', { x: 10, y: -4, class: 'butterfly-network-label' });
        label.textContent = shorten(node.title, 26);
        const sub = createSvgElement('text', { x: 10, y: 9, class: 'butterfly-network-sublabel' });
        sub.textContent = `${node.year} · ${node.topic}`;
        const title = createSvgElement('title');
        title.textContent = `${node.title}\n${(node.authors || []).join(', ')}`;
        circle.appendChild(title);
        group.append(circle, label, sub);
        group.addEventListener('pointerdown', (event) => {
          event.stopPropagation();
          draggingNode = { node, lastX: event.clientX, lastY: event.clientY };
          node.fixed = true;
          group.setPointerCapture(event.pointerId);
        });
        group.addEventListener('click', () => {
          if (!centerId) {
            centerId = node.id;
            setAppState({ selectedPaperId: node.id, year: node.year }, 'butterfly-path');
          } else if (node.id !== centerId) {
            targetId = node.id;
          }
          render();
        });
        nodeLayer.appendChild(group);
        node.el = group;
      });

      if (pathIds.length) {
        detailEl.innerHTML = pathIds.map((id, index) => {
          const node = nodeById.get(id);
          const prefix = index === 0 ? '中心' : index === pathIds.length - 1 ? '目标' : `桥梁 ${index}`;
          return `<strong>${prefix}</strong>：${node.year} · ${shorten(node.title, 80)}`;
        }).join('<br />');
      } else if (centerId && targetId) {
        detailEl.textContent = '当前渲染范围内没有找到中心到目标的可达路径，可以提高最大节点数或放宽年份。';
      } else if (centerId) {
        const center = nodeById.get(centerId);
        detailEl.innerHTML = `<strong>${center.title}</strong> 的局部引用网络。点击其他节点可设为相关论文并高亮路径。`;
      } else {
        detailEl.textContent = '当前为全局年份网络：横向按年份排列，纵向按主题分布，可拖动画布探索密集区域。';
      }
      statEl.textContent = `${visibleIds.size} 个节点，${visibleLinks.length} 条边${pathIds.length ? `，路径 ${pathIds.length} 步` : ''}`;
      updatePositions();
    }

    function updatePositions() {
      visibleLinks.forEach((link) => {
        if (!link.el) return;
        link.el.setAttribute('x1', link.sourceNode.x);
        link.el.setAttribute('y1', link.sourceNode.y);
        link.el.setAttribute('x2', link.targetNode.x);
        link.el.setAttribute('y2', link.targetNode.y);
      });
      Array.from(visibleIds).forEach((id) => {
        const node = nodeById.get(id);
        if (!node?.el) return;
        node.el.setAttribute('transform', `translate(${node.x} ${node.y})`);
      });
    }

    function pickSearch(input, role) {
      const node = findPaper(input.value);
      if (!node) return;
      if (role === 'center') {
        centerId = node.id;
        setAppState({ selectedPaperId: node.id, year: Math.max(Number(yearRange.value), node.year) }, 'butterfly-path');
      } else {
        targetId = node.id;
      }
      render();
    }

    yearRange.value = String(getAppState().year);
    yearRange.addEventListener('input', () => {
      setAppState({ year: Number(yearRange.value) }, 'butterfly-path');
      render();
    });
    centerSelect.addEventListener('change', () => {
      centerId = centerSelect.value;
      const node = nodeById.get(centerId);
      if (node) setAppState({ selectedPaperId: centerId, year: Math.max(Number(yearRange.value), node.year) }, 'butterfly-path');
      render();
    });
    targetSelect.addEventListener('change', () => {
      targetId = targetSelect.value;
      render();
    });
    centerSearch.addEventListener('change', () => pickSearch(centerSearch, 'center'));
    targetSearch.addEventListener('change', () => pickSearch(targetSearch, 'target'));
    maxInput.addEventListener('change', render);
    clearButton.addEventListener('click', () => {
      centerId = '';
      targetId = '';
      centerSearch.value = '';
      targetSearch.value = '';
      render();
    });
    onAppStateChange(({ state, source }) => {
      if (source === 'butterfly-path') return;
      yearRange.value = String(state.year);
      if (state.selectedPaperId && nodeById.has(state.selectedPaperId)) centerId = state.selectedPaperId;
      render();
    });

    svg.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const px = ((event.clientX - rect.left) / rect.width) * width;
      const py = ((event.clientY - rect.top) / rect.height) * height;
      const nextK = Math.max(0.45, Math.min(3.4, transform.k * (event.deltaY > 0 ? 0.9 : 1.1)));
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
      if (draggingNode) {
        draggingNode.node.x += (event.clientX - draggingNode.lastX) / transform.k;
        draggingNode.node.y += (event.clientY - draggingNode.lastY) / transform.k;
        draggingNode.lastX = event.clientX;
        draggingNode.lastY = event.clientY;
        updatePositions();
        return;
      }
      if (panning) {
        transform.x += event.clientX - panning.lastX;
        transform.y += event.clientY - panning.lastY;
        panning.lastX = event.clientX;
        panning.lastY = event.clientY;
        applyTransform();
      }
    });
    svg.addEventListener('pointerup', () => {
      if (draggingNode) draggingNode.node.fixed = false;
      draggingNode = null;
      panning = null;
    });
    svg.addEventListener('pointerleave', () => {
      if (draggingNode) draggingNode.node.fixed = false;
      draggingNode = null;
      panning = null;
    });

    applyTransform();
    render();
  } catch (error) {
    statEl.textContent = '数据加载失败，请检查 nodes.json 与 edges.json';
    svg.innerHTML = '';
  }
}
