import { loadJson } from '../../shared/data-loader.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_HOP = 3;

function createSvgElement(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => {
    el.setAttribute(key, String(value));
  });
  return el;
}

function shortenText(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text || '';
  }
  return `${text.slice(0, maxLength - 1)}...`;
}

function phaseClassByYear(year) {
  if (year <= 2017) {
    return 'phase-foundation';
  }
  if (year <= 2022) {
    return 'phase-boom';
  }
  return 'phase-agentic';
}

function buildAdjacency(nodes, edges) {
  const adjacency = new Map();
  nodes.forEach((node) => adjacency.set(node.id, new Set()));

  edges.forEach((edge) => {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) {
      return;
    }
    // Use undirected neighbors so users can inspect bridge nodes between any two selected papers.
    adjacency.get(edge.source).add(edge.target);
    adjacency.get(edge.target).add(edge.source);
  });

  return adjacency;
}

function bfsDistances(adjacency, startId) {
  const dist = new Map();
  const queue = [startId];
  dist.set(startId, 0);

  while (queue.length) {
    const current = queue.shift();
    const nextDist = (dist.get(current) || 0) + 1;
    const neighbors = adjacency.get(current) || new Set();

    neighbors.forEach((neighbor) => {
      if (!dist.has(neighbor)) {
        dist.set(neighbor, nextDist);
        queue.push(neighbor);
      }
    });
  }

  return dist;
}

function shortestPath(adjacency, startId, endId, allowedSet) {
  if (!startId || !endId) {
    return [];
  }
  if (startId === endId) {
    return [startId];
  }

  const queue = [startId];
  const prev = new Map();
  const visited = new Set([startId]);

  while (queue.length) {
    const current = queue.shift();
    const neighbors = adjacency.get(current) || new Set();

    for (const neighbor of neighbors) {
      if (!allowedSet.has(neighbor) || visited.has(neighbor)) {
        continue;
      }
      visited.add(neighbor);
      prev.set(neighbor, current);

      if (neighbor === endId) {
        const path = [endId];
        let cursor = endId;
        while (prev.has(cursor)) {
          cursor = prev.get(cursor);
          path.push(cursor);
        }
        return path.reverse();
      }

      queue.push(neighbor);
    }
  }

  return [];
}

function edgeKey(a, b) {
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

export async function initButterflyPath(container) {
  if (!container) {
    return;
  }

  container.innerHTML = `
    <div class="module-shell">
      <p class="module-tag">Module 03</p>
      <h3 class="module-title">蝴蝶脉冲路径图</h3>
      <p class="module-subtitle">以某论文为中心展开局部网络，选择另一论文后高亮两者之间的路径节点。</p>
      <div class="chart-toolbar chart-toolbar-wrap">
        <label class="chart-control">
          中心论文
          <select class="chart-select butterfly-center-select"></select>
        </label>
        <label class="chart-control">
          目标论文
          <select class="chart-select butterfly-target-select"></select>
        </label>
        <div class="chart-stat" aria-live="polite">加载中...</div>
      </div>
      <div class="module-canvas chart-canvas">
        <svg class="chart-svg" viewBox="0 0 860 300" role="img" aria-label="Butterfly network path chart"></svg>
      </div>
      <div class="legend-row">
        <span class="legend-chip">中心节点</span>
        <span class="legend-chip">目标节点</span>
        <span class="legend-chip">高亮链路 = 两者之间路径</span>
      </div>
    </div>
  `;

  const centerSelectEl = container.querySelector('.butterfly-center-select');
  const targetSelectEl = container.querySelector('.butterfly-target-select');
  const statEl = container.querySelector('.chart-stat');
  const svg = container.querySelector('.chart-svg');

  if (!centerSelectEl || !targetSelectEl || !statEl || !svg) {
    return;
  }

  try {
    const [nodes, edges] = await Promise.all([
      loadJson('./data/processed/nodes.json'),
      loadJson('./data/processed/edges.json')
    ]);

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const adjacency = buildAdjacency(nodes, edges);

    const sortedNodes = nodes.slice().sort((a, b) => {
      if (a.year !== b.year) {
        return a.year - b.year;
      }
      return a.title.localeCompare(b.title);
    });

    sortedNodes.forEach((node) => {
      const option = document.createElement('option');
      option.value = node.id;
      option.textContent = `${node.year} | ${shortenText(node.title, 42)}`;
      centerSelectEl.appendChild(option);
    });

    const width = 860;
    const height = 300;
    const centerX = width / 2;
    const centerY = height / 2;

    const edgesLayer = createSvgElement('g');
    const nodesLayer = createSvgElement('g');
    const labelsLayer = createSvgElement('g');
    svg.appendChild(edgesLayer);
    svg.appendChild(nodesLayer);
    svg.appendChild(labelsLayer);

    function buildSubgraph(centerId) {
      const dist = bfsDistances(adjacency, centerId);
      const nodeIds = nodes
        .filter((node) => dist.has(node.id) && (dist.get(node.id) || 0) <= MAX_HOP)
        .map((node) => node.id);
      const idSet = new Set(nodeIds);
      const subEdges = edges.filter((edge) => idSet.has(edge.source) && idSet.has(edge.target));
      return { dist, nodeIds, idSet, subEdges };
    }

    function layoutNodes(centerId, nodeIds, distMap) {
      const layers = new Map();

      nodeIds.forEach((id) => {
        const depth = distMap.get(id) || 0;
        if (!layers.has(depth)) {
          layers.set(depth, []);
        }
        layers.get(depth).push(id);
      });

      const positions = new Map();
      positions.set(centerId, { x: centerX, y: centerY });

      Array.from(layers.keys())
        .filter((depth) => depth > 0)
        .sort((a, b) => a - b)
        .forEach((depth) => {
          const ids = layers.get(depth);
          const radius = 56 + depth * 44;

          ids.forEach((id, idx) => {
            const angle = (Math.PI * 2 * idx) / Math.max(ids.length, 1) + depth * 0.35;
            positions.set(id, {
              x: centerX + Math.cos(angle) * radius,
              y: centerY + Math.sin(angle) * radius
            });
          });
        });

      return positions;
    }

    function syncTargetOptions(centerId, subgraph) {
      const prevValue = targetSelectEl.value;
      targetSelectEl.innerHTML = '';

      const candidates = subgraph.nodeIds
        .filter((id) => id !== centerId)
        .map((id) => nodeById.get(id))
        .filter(Boolean)
        .sort((a, b) => {
          if (a.year !== b.year) {
            return a.year - b.year;
          }
          return a.title.localeCompare(b.title);
        });

      candidates.forEach((node) => {
        const option = document.createElement('option');
        option.value = node.id;
        option.textContent = `${node.year} | ${shortenText(node.title, 42)}`;
        targetSelectEl.appendChild(option);
      });

      if (candidates.some((node) => node.id === prevValue)) {
        targetSelectEl.value = prevValue;
      }
    }

    function renderNetwork(centerId, targetId) {
      const subgraph = buildSubgraph(centerId);
      syncTargetOptions(centerId, subgraph);

      const resolvedTargetId = targetSelectEl.value || targetId;
      const pathIds = shortestPath(adjacency, centerId, resolvedTargetId, subgraph.idSet);
      const pathSet = new Set(pathIds);

      const pathEdgeSet = new Set();
      for (let i = 0; i < pathIds.length - 1; i += 1) {
        pathEdgeSet.add(edgeKey(pathIds[i], pathIds[i + 1]));
      }

      const positions = layoutNodes(centerId, subgraph.nodeIds, subgraph.dist);

      edgesLayer.innerHTML = '';
      nodesLayer.innerHTML = '';
      labelsLayer.innerHTML = '';

      subgraph.subEdges.forEach((edge) => {
        const a = positions.get(edge.source);
        const b = positions.get(edge.target);
        if (!a || !b) {
          return;
        }

        const onPath = pathEdgeSet.has(edgeKey(edge.source, edge.target));
        const line = createSvgElement('line', {
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          class: onPath ? 'butterfly-network-link is-path' : 'butterfly-network-link'
        });
        edgesLayer.appendChild(line);
      });

      subgraph.nodeIds.forEach((id, index) => {
        const node = nodeById.get(id);
        const p = positions.get(id);
        if (!node || !p) {
          return;
        }

        const classList = ['butterfly-network-node', phaseClassByYear(node.year)];
        if (id === centerId) {
          classList.push('is-center');
        }
        if (id === resolvedTargetId) {
          classList.push('is-target');
        }
        if (pathSet.has(id)) {
          classList.push('is-path');
        }

        const circle = createSvgElement('circle', {
          cx: p.x,
          cy: p.y,
          r: id === centerId ? 9 : 6,
          class: classList.join(' '),
          'data-id': id
        });

        const title = createSvgElement('title');
        title.textContent = `${node.title} (${node.year})`;
        circle.appendChild(title);
        nodesLayer.appendChild(circle);

        const label = createSvgElement('text', {
          x: p.x,
          y: p.y + (index % 2 === 0 ? -10 : 16),
          'text-anchor': 'middle',
          class: pathSet.has(id)
            ? 'butterfly-network-label is-path'
            : 'butterfly-network-label'
        });
        label.textContent = shortenText(node.title, 14);
        labelsLayer.appendChild(label);
      });

      const centerNode = nodeById.get(centerId);
      const targetNode = nodeById.get(resolvedTargetId);
      if (pathIds.length) {
        statEl.textContent = `中心: ${centerNode ? centerNode.year : '?'} | 目标: ${targetNode ? targetNode.year : '?'} | 路径节点数: ${pathIds.length}`;
      } else {
        statEl.textContent = '当前中心与目标在该局部网络中无可达路径';
      }

      Array.from(nodesLayer.querySelectorAll('circle')).forEach((circle) => {
        circle.addEventListener('click', () => {
          const nodeId = circle.getAttribute('data-id');
          if (!nodeId || nodeId === centerId) {
            return;
          }
          targetSelectEl.value = nodeId;
          renderNetwork(centerId, nodeId);
        });
      });
    }

    const defaultCenter = sortedNodes.find((node) => node.id === 'p2017_transformer')
      || sortedNodes[0];
    if (!defaultCenter) {
      statEl.textContent = '没有可用节点数据';
      return;
    }

    centerSelectEl.value = defaultCenter.id;
    const initialSubgraph = buildSubgraph(defaultCenter.id);
    syncTargetOptions(defaultCenter.id, initialSubgraph);

    centerSelectEl.addEventListener('change', () => {
      renderNetwork(centerSelectEl.value, targetSelectEl.value);
    });
    targetSelectEl.addEventListener('change', () => {
      renderNetwork(centerSelectEl.value, targetSelectEl.value);
    });

    renderNetwork(defaultCenter.id, targetSelectEl.value);
  } catch (error) {
    statEl.textContent = '数据加载失败，请检查 nodes.json 与 edges.json';
    svg.innerHTML = '';
  }
}
