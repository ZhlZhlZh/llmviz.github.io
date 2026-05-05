import { loadJson } from '../../shared/data-loader.js';
import { getAppState, onAppStateChange, setAppState } from '../../shared/app-state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgElement(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
  return el;
}

function phaseClassByYear(year) {
  if (year <= 2017) return 'phase-foundation';
  if (year <= 2022) return 'phase-boom';
  return 'phase-agentic';
}

function radiusByCitations(citations, minCitations, maxCitations) {
  const dMin = Math.sqrt(minCitations || 1);
  const dMax = Math.sqrt(maxCitations || 1);
  const t = (Math.sqrt(citations || 1) - dMin) / Math.max(dMax - dMin, 1);
  return 5 + t * 12;
}

function shorten(text, maxLength) {
  if (!text || text.length <= maxLength) return text || '';
  return `${text.slice(0, maxLength - 1)}...`;
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

function collectNeighborhood(seedIds, adjacency, maxNodes) {
  const selected = new Set(seedIds);
  const queue = seedIds.map((id) => ({ id, depth: 0 }));
  let cursor = 0;

  while (cursor < queue.length && selected.size < maxNodes) {
    const { id, depth } = queue[cursor];
    cursor += 1;
    if (depth >= 3) continue;

    const neighbors = Array.from(adjacency.get(id) || []);
    neighbors.forEach((neighbor) => {
      if (selected.size >= maxNodes) return;
      if (!selected.has(neighbor)) {
        selected.add(neighbor);
        queue.push({ id: neighbor, depth: depth + 1 });
      }
    });
  }

  return selected;
}

export async function initPaperForce(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="module-shell">
      <p class="module-tag">Module 02</p>
      <h3 class="module-title">论文力导向图</h3>
      <p class="module-subtitle">搜索作者后，以该作者最高引用论文为中心，递归保留最相关的引用和被引用论文；画布支持滚轮缩放、拖拽平移和节点拖动。</p>
      <div class="chart-toolbar chart-toolbar-wrap">
        <label class="chart-control">
          起始年份
          <input class="chart-range force-year-start" type="range" min="2013" max="2026" step="1" value="2013" />
          <output class="year-badge force-year-start-output">2013</output>
        </label>
        <label class="chart-control">
          结束年份
          <input class="chart-range force-year-end" type="range" min="2013" max="2026" step="1" value="2026" />
          <output class="year-badge force-year-end-output">2026</output>
        </label>
        <label class="chart-control">
          作者搜索
          <input class="chart-input force-author-input" list="force-author-list" placeholder="例如 Alec Radford" />
          <datalist id="force-author-list"></datalist>
        </label>
        <label class="chart-control">
          最大节点
          <input class="chart-number force-max-input" type="number" min="20" max="120" step="5" value="55" />
        </label>
        <label class="chart-control">
          显示信息
          <select class="chart-select force-label-mode">
            <option value="full">完整</option>
            <option value="brief">简略</option>
            <option value="dots">仅圆点</option>
          </select>
        </label>
        <button class="chart-button force-reset-button" type="button">重置视图</button>
        <div class="chart-stat" aria-live="polite">加载中...</div>
      </div>
      <div class="module-canvas chart-canvas force-canvas">
        <svg class="chart-svg force-svg" viewBox="0 0 900 500" role="img" aria-label="Paper force graph"></svg>
      </div>
      <div class="chart-detail force-detail"></div>
      <div class="legend-row">
        <span class="legend-chip">圆大小 = 引用量</span>
        <span class="legend-chip">颜色 = 研究阶段</span>
        <span class="legend-chip">搜索作者 = 作者中心网络</span>
        <span class="legend-chip">滚轮/拖拽 = 缩放与平移</span>
      </div>
    </div>
  `;

  const startSlider = container.querySelector('.force-year-start');
  const endSlider = container.querySelector('.force-year-end');
  const startOutput = container.querySelector('.force-year-start-output');
  const endOutput = container.querySelector('.force-year-end-output');
  const authorInput = container.querySelector('.force-author-input');
  const authorList = container.querySelector('#force-author-list');
  const maxInput = container.querySelector('.force-max-input');
  const labelMode = container.querySelector('.force-label-mode');
  const resetButton = container.querySelector('.force-reset-button');
  const statEl = container.querySelector('.chart-stat');
  const detailEl = container.querySelector('.force-detail');
  const svg = container.querySelector('.force-svg');

  if (!startSlider || !endSlider || !startOutput || !endOutput || !authorInput || !authorList || !maxInput || !labelMode || !resetButton || !statEl || !detailEl || !svg) return;

  try {
    const [nodesData, edgesData] = await Promise.all([
      loadJson('./data/processed/nodes.json'),
      loadJson('./data/processed/edges.json')
    ]);

    const width = 900;
    const height = 500;
    const centerX = width / 2;
    const centerY = height / 2;
    const minCitations = Math.min(...nodesData.map((item) => item.citations_count));
    const maxCitations = Math.max(...nodesData.map((item) => item.citations_count));
    const minYear = Math.min(...nodesData.map((item) => item.year));
    const maxYear = Math.max(...nodesData.map((item) => item.year));

    startSlider.min = String(minYear);
    startSlider.max = String(maxYear);
    endSlider.min = String(minYear);
    endSlider.max = String(maxYear);

    const nodes = nodesData.map((item, index) => {
      const angle = (Math.PI * 2 * index) / nodesData.length;
      const ring = 120 + (index % 9) * 20;
      return {
        ...item,
        x: centerX + Math.cos(angle) * ring,
        y: centerY + Math.sin(angle) * ring,
        vx: 0,
        vy: 0,
        fixed: false,
        r: radiusByCitations(item.citations_count, minCitations, maxCitations)
      };
    });
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const adjacency = buildAdjacency(nodes, edgesData);
    const links = edgesData
      .map((edge) => ({
        ...edge,
        sourceNode: nodeById.get(edge.source),
        targetNode: nodeById.get(edge.target)
      }))
      .filter((edge) => edge.sourceNode && edge.targetNode);

    const authors = Array.from(new Set(nodes.flatMap((node) => node.authors || []))).sort();
    authors.forEach((author) => {
      const option = document.createElement('option');
      option.value = author;
      authorList.appendChild(option);
    });

    const viewport = createSvgElement('g', { class: 'graph-viewport' });
    const edgeLayer = createSvgElement('g', { class: 'force-edge-layer' });
    const nodeLayer = createSvgElement('g', { class: 'force-node-layer' });
    viewport.append(edgeLayer, nodeLayer);
    svg.appendChild(viewport);

    let transform = { x: 0, y: 0, k: 1 };
    let visibleNodeIds = new Set();
    let visibleLinks = [];
    let centerId = getAppState().selectedPaperId;
    let draggingNode = null;
    let panning = null;

    function normalizeYearRange(start, end) {
      const safeStart = Number.isFinite(start) ? start : minYear;
      const safeEnd = Number.isFinite(end) ? end : maxYear;
      const clampedStart = Math.min(Math.max(safeStart, minYear), maxYear);
      const clampedEnd = Math.min(Math.max(safeEnd, minYear), maxYear);
      return {
        start: Math.min(clampedStart, clampedEnd),
        end: Math.max(clampedStart, clampedEnd)
      };
    }

    function syncYearRangeInputs(start, end) {
      startSlider.value = String(start);
      endSlider.value = String(end);
      startOutput.textContent = String(start);
      endOutput.textContent = String(end);
    }

    function getActiveYearRange() {
      return normalizeYearRange(Number(startSlider.value), Number(endSlider.value));
    }

    function expandRangeForYear(range, year) {
      if (!Number.isFinite(year)) return range;
      return normalizeYearRange(Math.min(range.start, year), Math.max(range.end, year));
    }

    function publishYearRange() {
      const range = getActiveYearRange();
      syncYearRangeInputs(range.start, range.end);
      setAppState({ year: range.end, yearRangeStart: range.start, yearRangeEnd: range.end }, 'paper-force');
      return range;
    }

    const initialRange = normalizeYearRange(
      Number.isFinite(getAppState().yearRangeStart) ? getAppState().yearRangeStart : minYear,
      Number.isFinite(getAppState().yearRangeEnd) ? getAppState().yearRangeEnd : getAppState().year
    );
    syncYearRangeInputs(initialRange.start, initialRange.end);

    function applyTransform() {
      viewport.setAttribute('transform', `translate(${transform.x} ${transform.y}) scale(${transform.k})`);
    }

    function resetView() {
      transform = { x: 0, y: 0, k: 1 };
      applyTransform();
    }

    function selectedAuthorsQuery() {
      return authorInput.value.trim().toLowerCase();
    }

    function buildVisibleSet() {
      const { start, end } = getActiveYearRange();
      const maxNodes = Number(maxInput.value) || 55;
      const eligible = nodes.filter((node) => node.year >= start && node.year <= end);
      const eligibleSet = new Set(eligible.map((node) => node.id));
      const query = selectedAuthorsQuery();

      if (query) {
        const authorPapers = eligible.filter((node) =>
          (node.authors || []).some((author) => author.toLowerCase().includes(query))
        );
        if (authorPapers.length) {
          const sortedAuthorPapers = authorPapers.slice().sort((a, b) => b.citations_count - a.citations_count);
          centerId = sortedAuthorPapers[0].id;
          const neighborhood = collectNeighborhood(sortedAuthorPapers.map((node) => node.id), adjacency, maxNodes * 2);
          return new Set(
            Array.from(neighborhood)
              .map((id) => nodeById.get(id))
              .filter((node) => node && eligibleSet.has(node.id))
              .sort((a, b) => {
                const aAuthor = sortedAuthorPapers.some((paper) => paper.id === a.id) ? 1 : 0;
                const bAuthor = sortedAuthorPapers.some((paper) => paper.id === b.id) ? 1 : 0;
                if (aAuthor !== bAuthor) return bAuthor - aAuthor;
                return b.citations_count - a.citations_count;
              })
              .slice(0, maxNodes)
              .map((node) => node.id)
          );
        }
      }

      const selectedId = getAppState().selectedPaperId;
      const top = eligible.slice().sort((a, b) => b.citations_count - a.citations_count).slice(0, maxNodes);
      const ids = new Set(top.map((node) => node.id));
      if (eligibleSet.has(selectedId)) ids.add(selectedId);
      centerId = ids.has(selectedId) ? selectedId : top[0]?.id;
      return ids;
    }

    function updateDetail() {
      let selected = nodeById.get(getAppState().selectedPaperId);
      if (!selected || !visibleNodeIds.has(selected.id)) {
        selected = nodeById.get(centerId);
      }
      if (!selected) {
        detailEl.textContent = '没有可显示的论文。';
        return;
      }
      const authorText = (selected.authors || []).join(', ');
      detailEl.innerHTML = `<strong>${selected.title}</strong> (${selected.year}) · ${selected.venue} · ${selected.institution}<br />作者：${authorText}<br />引用数 ${selected.citations_count.toLocaleString()}；主题 ${selected.topic}。${selected.abstract}`;
    }

    function renderGraph() {
      const range = getActiveYearRange();
      syncYearRangeInputs(range.start, range.end);
      const labelModeValue = labelMode.value;
      visibleNodeIds = buildVisibleSet();
      visibleLinks = links.filter((link) => visibleNodeIds.has(link.source) && visibleNodeIds.has(link.target));

      edgeLayer.innerHTML = '';
      nodeLayer.innerHTML = '';

      visibleLinks.forEach((link) => {
        const line = createSvgElement('line', { class: 'force-link' });
        edgeLayer.appendChild(line);
        link.el = line;
      });

      Array.from(visibleNodeIds).forEach((id) => {
        const node = nodeById.get(id);
        if (!node) return;

        const group = createSvgElement('g', {
          class: `force-node-group ${node.id === centerId ? 'is-center' : ''}`,
          'data-id': node.id
        });
        const circle = createSvgElement('circle', {
          class: `force-node ${phaseClassByYear(node.year)}`,
          r: node.r
        });
        const title = createSvgElement('title');
        title.textContent = `${node.title}\n${node.year} · ${(node.authors || []).join(', ')}`;
        circle.appendChild(title);

        group.appendChild(circle);
        const showLabels = labelModeValue !== 'dots';
        const showSubLabel = labelModeValue === 'full';
        if (showLabels) {
          const label = createSvgElement('text', {
            class: 'force-node-label',
            x: node.r + 5,
            y: -2
          });
          const labelLimit = labelModeValue === 'brief' ? 22 : 34;
          label.textContent = `${node.year} · ${shorten(node.title, labelLimit)}`;
          group.appendChild(label);
        }
        if (showSubLabel) {
          const subLabel = createSvgElement('text', {
            class: 'force-node-sublabel',
            x: node.r + 5,
            y: 12
          });
          subLabel.textContent = shorten((node.authors || []).slice(0, 2).join(', '), 36);
          group.appendChild(subLabel);
        }
        group.addEventListener('pointerdown', (event) => {
          event.stopPropagation();
          draggingNode = {
            node,
            pointerId: event.pointerId,
            lastX: event.clientX,
            lastY: event.clientY
          };
          node.fixed = true;
          group.setPointerCapture(event.pointerId);
        });
        group.addEventListener('click', () => {
          const currentRange = getActiveYearRange();
          const nextRange = expandRangeForYear(currentRange, node.year);
          if (nextRange.start !== currentRange.start || nextRange.end !== currentRange.end) {
            syncYearRangeInputs(nextRange.start, nextRange.end);
            renderGraph();
          }
          setAppState(
            {
              selectedPaperId: node.id,
              year: nextRange.end,
              yearRangeStart: nextRange.start,
              yearRangeEnd: nextRange.end
            },
            'paper-force'
          );
        });
        nodeLayer.appendChild(group);
        node.el = group;
      });

      const rangeLabel = range.start === range.end ? String(range.end) : `${range.start}-${range.end}`;
      statEl.textContent = selectedAuthorsQuery()
        ? `作者中心网络：${visibleNodeIds.size} 篇论文，${visibleLinks.length} 条边 · 年份 ${rangeLabel}`
        : `高影响论文网络：${visibleNodeIds.size} 篇论文，${visibleLinks.length} 条边 · 年份 ${rangeLabel}`;
      updateDetail();
    }

    function tick() {
      const visibleNodes = Array.from(visibleNodeIds).map((id) => nodeById.get(id)).filter(Boolean);
      const repulsion = visibleNodes.length > 60 ? 800 : 1200;
      const springLength = visibleNodes.length > 60 ? 58 : 82;
      const centerNode = nodeById.get(centerId);

      visibleNodes.forEach((a, i) => {
        if (!a.fixed) {
          a.vx += ((centerNode && a.id === centerNode.id ? centerX : centerX) - a.x) * 0.0008;
          a.vy += ((centerNode && a.id === centerNode.id ? centerY : centerY) - a.y) * 0.0008;
        }
        for (let j = i + 1; j < visibleNodes.length; j += 1) {
          const b = visibleNodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distSq = dx * dx + dy * dy + 0.1;
          const dist = Math.sqrt(distSq);
          const force = repulsion / distSq;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          if (!a.fixed) {
            a.vx += fx;
            a.vy += fy;
          }
          if (!b.fixed) {
            b.vx -= fx;
            b.vy -= fy;
          }
        }
      });

      visibleLinks.forEach((link) => {
        const a = link.sourceNode;
        const b = link.targetNode;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - springLength) * 0.004;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        if (!a.fixed) {
          a.vx += fx;
          a.vy += fy;
        }
        if (!b.fixed) {
          b.vx -= fx;
          b.vy -= fy;
        }
      });

      visibleNodes.forEach((node) => {
        if (!node.fixed) {
          node.vx *= 0.86;
          node.vy *= 0.86;
          node.x += node.vx;
          node.y += node.vy;
        }
      });
    }

    function renderPositions() {
      visibleLinks.forEach((link) => {
        if (!link.el) return;
        link.el.setAttribute('x1', link.sourceNode.x);
        link.el.setAttribute('y1', link.sourceNode.y);
        link.el.setAttribute('x2', link.targetNode.x);
        link.el.setAttribute('y2', link.targetNode.y);
      });

      Array.from(visibleNodeIds).forEach((id) => {
        const node = nodeById.get(id);
        if (!node?.el) return;
        node.el.setAttribute('transform', `translate(${node.x} ${node.y})`);
        node.el.classList.toggle('is-selected', node.id === getAppState().selectedPaperId);
      });
    }

    function animate() {
      tick();
      renderPositions();
      requestAnimationFrame(animate);
    }

    svg.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const px = ((event.clientX - rect.left) / rect.width) * width;
      const py = ((event.clientY - rect.top) / rect.height) * height;
      const nextK = Math.max(0.45, Math.min(3.2, transform.k * (event.deltaY > 0 ? 0.9 : 1.1)));
      transform.x = px - ((px - transform.x) / transform.k) * nextK;
      transform.y = py - ((py - transform.y) / transform.k) * nextK;
      transform.k = nextK;
      applyTransform();
    }, { passive: false });

    svg.addEventListener('pointerdown', (event) => {
      panning = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
      svg.setPointerCapture(event.pointerId);
    });
    svg.addEventListener('pointermove', (event) => {
      if (draggingNode) {
        const dx = (event.clientX - draggingNode.lastX) / transform.k;
        const dy = (event.clientY - draggingNode.lastY) / transform.k;
        draggingNode.node.x += dx;
        draggingNode.node.y += dy;
        draggingNode.node.vx = 0;
        draggingNode.node.vy = 0;
        draggingNode.lastX = event.clientX;
        draggingNode.lastY = event.clientY;
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

    const handleRangeInput = () => {
      publishYearRange();
      renderGraph();
    };
    startSlider.addEventListener('input', handleRangeInput);
    endSlider.addEventListener('input', handleRangeInput);
    authorInput.addEventListener('input', () => {
      renderGraph();
      const node = nodeById.get(centerId);
      if (selectedAuthorsQuery() && node) {
        const currentRange = getActiveYearRange();
        const nextRange = expandRangeForYear(currentRange, node.year);
        if (nextRange.start !== currentRange.start || nextRange.end !== currentRange.end) {
          syncYearRangeInputs(nextRange.start, nextRange.end);
          renderGraph();
        }
        setAppState(
          {
            selectedPaperId: node.id,
            year: nextRange.end,
            yearRangeStart: nextRange.start,
            yearRangeEnd: nextRange.end
          },
          'paper-force'
        );
      }
    });
    maxInput.addEventListener('change', renderGraph);
    labelMode.addEventListener('change', renderGraph);
    resetButton.addEventListener('click', resetView);
    onAppStateChange(({ state, source }) => {
      if (source === 'paper-force') {
        updateDetail();
        return;
      }
      const nextStart = Number.isFinite(state.yearRangeStart) ? state.yearRangeStart : state.year;
      const nextEnd = Number.isFinite(state.yearRangeEnd) ? state.yearRangeEnd : state.year;
      const normalized = normalizeYearRange(nextStart, nextEnd);
      const needsUpdate = Number(startSlider.value) !== normalized.start || Number(endSlider.value) !== normalized.end;
      if (needsUpdate) {
        syncYearRangeInputs(normalized.start, normalized.end);
        renderGraph();
      } else {
        updateDetail();
      }
    });

    resetView();
    renderGraph();
    animate();
  } catch (error) {
    statEl.textContent = '数据加载失败，请检查 nodes.json 与 edges.json';
    svg.innerHTML = '';
  }
}
