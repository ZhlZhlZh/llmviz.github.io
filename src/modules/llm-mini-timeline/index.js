// Compact interactive LLM timeline rendered in the site header.
// Visual inspiration: https://llmtimeline.web.app/
// Data adapted from https://github.com/Michaelgathara/llm-timeline (MIT).

import { timelineBranches, timelineData } from './data.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  }
  return el;
}

function yearFraction(node) {
  const month = Number.isFinite(node.month) ? node.month : 6;
  return node.year + (month - 1) / 12;
}

function computeLanes() {
  // Keep canonical branch order but only include branches actually present.
  const present = new Set(timelineData.map((n) => n.branch));
  return timelineBranches.filter((b) => present.has(b.id));
}

function buildLayout(width, height) {
  const padding = { top: 18, right: 16, bottom: 16, left: 16 };
  const lanes = computeLanes();
  const laneIndex = new Map(lanes.map((b, i) => [b.id, i]));
  const branchById = new Map(timelineBranches.map((b) => [b.id, b]));

  const years = timelineData.map(yearFraction);
  const yMin = Math.floor(Math.min(...years));
  const yMax = Math.ceil(Math.max(...years));

  const innerW = Math.max(40, width - padding.left - padding.right);
  const innerH = Math.max(40, height - padding.top - padding.bottom);
  const laneStep = lanes.length > 1 ? innerH / (lanes.length - 1) : 0;

  function xFor(node) {
    const t = (yearFraction(node) - yMin) / Math.max(0.0001, yMax - yMin);
    return padding.left + t * innerW;
  }
  function yFor(node) {
    const i = laneIndex.get(node.branch) ?? 0;
    return padding.top + i * laneStep;
  }

  const nodes = timelineData.map((n) => ({
    ...n,
    branchColor: branchById.get(n.branch)?.color ?? '#999',
    branchName: branchById.get(n.branch)?.name ?? n.branch,
    cx: xFor(n),
    cy: yFor(n)
  }));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const links = [];
  for (const n of nodes) {
    if (!n.parentIds) continue;
    for (const pid of n.parentIds) {
      const p = nodeById.get(pid);
      if (p) links.push({ source: p, target: n });
    }
  }

  return { lanes, nodes, nodeById, links, yMin, yMax, padding, innerW, innerH };
}

function linkPath(src, tgt) {
  const dx = tgt.cx - src.cx;
  const mx = src.cx + dx * 0.5;
  return `M ${src.cx} ${src.cy} C ${mx} ${src.cy}, ${mx} ${tgt.cy}, ${tgt.cx} ${tgt.cy}`;
}

function ancestorSet(startId, nodeById) {
  const out = new Set();
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop();
    if (out.has(id)) continue;
    out.add(id);
    const node = nodeById.get(id);
    if (node?.parentIds) {
      for (const p of node.parentIds) stack.push(p);
    }
  }
  return out;
}

function descendantSet(startId, nodeById, nodes) {
  const children = new Map();
  for (const n of nodes) {
    if (!n.parentIds) continue;
    for (const p of n.parentIds) {
      if (!children.has(p)) children.set(p, []);
      children.get(p).push(n.id);
    }
  }
  const out = new Set();
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop();
    if (out.has(id)) continue;
    out.add(id);
    for (const c of children.get(id) ?? []) stack.push(c);
  }
  return out;
}

export function initLlmMiniTimeline(root) {
  if (!root) return;
  root.classList.add('llm-mini-timeline');
  root.innerHTML = '';

  const svgWrap = document.createElement('div');
  svgWrap.className = 'llm-mini-timeline__canvas';
  root.appendChild(svgWrap);

  const detail = document.createElement('div');
  detail.className = 'llm-mini-timeline__detail is-empty';
  detail.innerHTML = `
    <p class="llm-mini-timeline__detail-hint">点击圆点查看论文详情</p>
  `;
  root.appendChild(detail);

  const state = { selectedId: null, width: 0, height: 0 };
  let svg;
  let layout;
  let circlesById = new Map();
  let linksByEdge = [];

  function renderDetail() {
    if (!state.selectedId || !layout) {
      detail.classList.add('is-empty');
      detail.innerHTML = `<p class="llm-mini-timeline__detail-hint">点击圆点查看论文详情</p>`;
      return;
    }
    const node = layout.nodeById.get(state.selectedId);
    if (!node) return;
    detail.classList.remove('is-empty');
    const meta = [
      `${node.year}${node.month ? `·${String(node.month).padStart(2, '0')}` : ''}`,
      node.branchName,
      node.modelSize ? `${node.modelSize}` : null
    ].filter(Boolean).join(' · ');
    const link = node.link
      ? `<a class="llm-mini-timeline__detail-link" href="${node.link}" target="_blank" rel="noopener">查看资料 ↗</a>`
      : '';
    detail.innerHTML = `
      <div class="llm-mini-timeline__detail-row">
        <span class="llm-mini-timeline__detail-dot" style="background:${node.branchColor}"></span>
        <span class="llm-mini-timeline__detail-title">${node.title}</span>
      </div>
      <p class="llm-mini-timeline__detail-meta">${meta}</p>
      <p class="llm-mini-timeline__detail-desc">${node.description ?? ''}</p>
      ${link}
    `;
  }

  function applyHighlight() {
    if (!svg) return;
    const selectedId = state.selectedId;
    if (!selectedId) {
      svg.classList.remove('has-selection');
      circlesById.forEach((c) => {
        c.classList.remove('is-selected');
        c.classList.remove('is-connected');
      });
      linksByEdge.forEach(({ path }) => {
        path.classList.remove('is-highlighted');
      });
      return;
    }
    const ancestors = ancestorSet(selectedId, layout.nodeById);
    const descendants = descendantSet(selectedId, layout.nodeById, layout.nodes);
    const connected = new Set([...ancestors, ...descendants]);
    svg.classList.add('has-selection');
    circlesById.forEach((c, id) => {
      c.classList.toggle('is-selected', id === selectedId);
      c.classList.toggle('is-connected', connected.has(id) && id !== selectedId);
    });
    linksByEdge.forEach(({ path, source, target }) => {
      const onPath =
        (connected.has(source) && connected.has(target)) &&
        (source === selectedId || target === selectedId ||
          (ancestors.has(source) && ancestors.has(target)) ||
          (descendants.has(source) && descendants.has(target)));
      path.classList.toggle('is-highlighted', onPath);
    });
  }

  function selectNode(id) {
    state.selectedId = state.selectedId === id ? null : id;
    applyHighlight();
    renderDetail();
  }

  function render() {
    const rect = svgWrap.getBoundingClientRect();
    const width = Math.max(240, rect.width || 320);
    // Compact height, but grow a bit on wider panels.
    const height = Math.min(180, Math.max(140, width * 0.45));
    state.width = width;
    state.height = height;

    layout = buildLayout(width, height);
    svgWrap.innerHTML = '';
    circlesById = new Map();
    linksByEdge = [];

    svg = createSvg('svg', {
      class: 'llm-mini-timeline__svg',
      viewBox: `0 0 ${width} ${height}`,
      width: '100%',
      height: `${height}`,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': 'LLM 关键研究节点时间线'
    });

    // Year ticks (subtle, helps orient without clutter)
    const yearAxisY = height - 2;
    const yearStart = layout.yMin;
    const yearEnd = layout.yMax;
    for (let y = yearStart; y <= yearEnd; y += 1) {
      const t = (y - yearStart) / Math.max(0.0001, yearEnd - yearStart);
      const x = layout.padding.left + t * layout.innerW;
      const isMajor = y % 2 === (yearStart % 2);
      svg.appendChild(createSvg('line', {
        x1: x, x2: x, y1: layout.padding.top - 6, y2: height - layout.padding.bottom + 2,
        class: `llm-mini-timeline__grid${isMajor ? ' is-major' : ''}`
      }));
      const label = createSvg('text', {
        x, y: yearAxisY, class: 'llm-mini-timeline__year-label', 'text-anchor': 'middle'
      });
      label.textContent = String(y);
      svg.appendChild(label);
    }

    // Links group
    const linkLayer = createSvg('g', { class: 'llm-mini-timeline__links' });
    svg.appendChild(linkLayer);
    for (const { source, target } of layout.links) {
      const path = createSvg('path', {
        d: linkPath(source, target),
        class: 'llm-mini-timeline__link',
        stroke: target.branchColor
      });
      linkLayer.appendChild(path);
      linksByEdge.push({ path, source: source.id, target: target.id });
    }

    // Nodes group
    const nodeLayer = createSvg('g', { class: 'llm-mini-timeline__nodes' });
    svg.appendChild(nodeLayer);
    for (const n of layout.nodes) {
      const g = createSvg('g', { class: 'llm-mini-timeline__node', 'data-id': n.id });
      const halo = createSvg('circle', {
        cx: n.cx, cy: n.cy, r: 7.5,
        class: 'llm-mini-timeline__node-halo',
        fill: n.branchColor
      });
      const dot = createSvg('circle', {
        cx: n.cx, cy: n.cy, r: 3.4,
        class: 'llm-mini-timeline__node-dot',
        fill: n.branchColor
      });
      const hit = createSvg('circle', {
        cx: n.cx, cy: n.cy, r: 9,
        class: 'llm-mini-timeline__node-hit',
        fill: 'transparent'
      });
      const title = createSvg('title');
      title.textContent = `${n.title} · ${n.year}${n.month ? '-' + String(n.month).padStart(2, '0') : ''}`;
      g.appendChild(title);
      g.appendChild(halo);
      g.appendChild(dot);
      g.appendChild(hit);
      g.addEventListener('click', (ev) => {
        ev.stopPropagation();
        selectNode(n.id);
      });
      nodeLayer.appendChild(g);
      circlesById.set(n.id, g);
    }

    svg.addEventListener('click', () => {
      if (state.selectedId) {
        state.selectedId = null;
        applyHighlight();
        renderDetail();
      }
    });

    svgWrap.appendChild(svg);
    applyHighlight();
    renderDetail();
  }

  render();

  const ro = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => render())
    : null;
  if (ro) ro.observe(svgWrap);
  else window.addEventListener('resize', render, { passive: true });
}
