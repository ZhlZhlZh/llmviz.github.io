import { loadJson } from '../../shared/data-loader.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgElement(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => {
    el.setAttribute(key, String(value));
  });
  return el;
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

function radiusByCitations(citations, minCitations, maxCitations) {
  const safe = Math.max(citations, minCitations);
  const dMin = Math.sqrt(minCitations || 1);
  const dMax = Math.sqrt(maxCitations || 1);
  const t = (Math.sqrt(safe) - dMin) / Math.max(dMax - dMin, 1);
  return 4 + t * 8;
}

export async function initPaperForce(container) {
  if (!container) {
    return;
  }

  container.innerHTML = `
    <div class="module-shell">
      <p class="module-tag">Module 02</p>
      <h3 class="module-title">论文力导向图</h3>
      <p class="module-subtitle">节点表示论文、边表示引文，拖动时间可观察网络从稀疏到中心坍缩的变化。</p>
      <div class="chart-toolbar">
        <label class="chart-control">
          显示至年份
          <input class="chart-range" type="range" min="2013" max="2026" step="1" value="2026" />
        </label>
        <div class="chart-stat" aria-live="polite">加载中...</div>
      </div>
      <div class="module-canvas chart-canvas">
        <svg class="chart-svg" viewBox="0 0 860 360" role="img" aria-label="Paper force graph"></svg>
      </div>
      <div class="legend-row">
        <span class="legend-chip">节点大小 = citations_count</span>
        <span class="legend-chip">颜色 = 阶段</span>
        <span class="legend-chip">灰线 = 引文关系</span>
      </div>
    </div>
  `;

  const slider = container.querySelector('.chart-range');
  const statEl = container.querySelector('.chart-stat');
  const svg = container.querySelector('.chart-svg');

  if (!slider || !statEl || !svg) {
    return;
  }

  try {
    const [nodesData, edgesData] = await Promise.all([
      loadJson('./data/processed/nodes.json'),
      loadJson('./data/processed/edges.json')
    ]);

    const width = 860;
    const height = 360;
    const centerX = width / 2;
    const centerY = height / 2;

    const minCitations = Math.min(...nodesData.map((item) => item.citations_count));
    const maxCitations = Math.max(...nodesData.map((item) => item.citations_count));

    const nodes = nodesData.map((item, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(nodesData.length, 1);
      const baseRadius = 100 + (index % 6) * 18;
      return {
        ...item,
        x: centerX + Math.cos(angle) * baseRadius,
        y: centerY + Math.sin(angle) * baseRadius,
        vx: 0,
        vy: 0,
        r: radiusByCitations(item.citations_count, minCitations, maxCitations),
        active: true
      };
    });

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const links = edgesData
      .map((edge) => ({
        ...edge,
        sourceNode: nodeById.get(edge.source),
        targetNode: nodeById.get(edge.target),
        active: true
      }))
      .filter((edge) => edge.sourceNode && edge.targetNode);

    const edgesLayer = createSvgElement('g');
    const nodesLayer = createSvgElement('g');
    svg.appendChild(edgesLayer);
    svg.appendChild(nodesLayer);

    links.forEach((link) => {
      const line = createSvgElement('line', {
        class: 'force-link',
        x1: 0,
        y1: 0,
        x2: 0,
        y2: 0
      });
      edgesLayer.appendChild(line);
      link.el = line;
    });

    nodes.forEach((node) => {
      const circle = createSvgElement('circle', {
        class: `force-node ${phaseClassByYear(node.year)}`,
        cx: node.x,
        cy: node.y,
        r: node.r
      });

      const title = createSvgElement('title');
      title.textContent = `${node.title} (${node.year})`;
      circle.appendChild(title);

      nodesLayer.appendChild(circle);
      node.el = circle;
    });

    function applyYearFilter() {
      const activeYear = Number(slider.value);
      const activeNodeSet = new Set();

      nodes.forEach((node) => {
        node.active = node.year <= activeYear;
        if (node.active) {
          activeNodeSet.add(node.id);
        }
      });

      links.forEach((link) => {
        link.active = activeNodeSet.has(link.sourceNode.id) && activeNodeSet.has(link.targetNode.id);
      });

      const activeNodes = nodes.filter((node) => node.active).length;
      const activeLinks = links.filter((link) => link.active).length;
      statEl.textContent = `${activeYear}年：${activeNodes} 个节点，${activeLinks} 条引文边`;
    }

    function tick() {
      const repulsionStrength = 1200;
      const springLength = 78;
      const springStrength = 0.003;
      const centeringStrength = 0.0009;
      const damping = 0.9;

      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i];
        if (!a.active) {
          continue;
        }

        a.vx += (centerX - a.x) * centeringStrength;
        a.vy += (centerY - a.y) * centeringStrength;

        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j];
          if (!b.active) {
            continue;
          }
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distSq = dx * dx + dy * dy + 0.01;
          const dist = Math.sqrt(distSq);
          const force = repulsionStrength / distSq;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      }

      links.forEach((link) => {
        if (!link.active) {
          return;
        }
        const a = link.sourceNode;
        const b = link.targetNode;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const delta = dist - springLength;
        const force = delta * springStrength;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      });

      nodes.forEach((node) => {
        if (!node.active) {
          return;
        }
        node.vx *= damping;
        node.vy *= damping;
        node.x += node.vx;
        node.y += node.vy;

        const padding = node.r + 4;
        if (node.x < padding) {
          node.x = padding;
          node.vx *= -0.4;
        }
        if (node.x > width - padding) {
          node.x = width - padding;
          node.vx *= -0.4;
        }
        if (node.y < padding) {
          node.y = padding;
          node.vy *= -0.4;
        }
        if (node.y > height - padding) {
          node.y = height - padding;
          node.vy *= -0.4;
        }
      });
    }

    function render() {
      links.forEach((link) => {
        if (!link.el) {
          return;
        }
        link.el.classList.toggle('is-hidden', !link.active);
        if (link.active) {
          link.el.setAttribute('x1', String(link.sourceNode.x));
          link.el.setAttribute('y1', String(link.sourceNode.y));
          link.el.setAttribute('x2', String(link.targetNode.x));
          link.el.setAttribute('y2', String(link.targetNode.y));
        }
      });

      nodes.forEach((node) => {
        if (!node.el) {
          return;
        }
        node.el.classList.toggle('is-hidden', !node.active);
        if (node.active) {
          node.el.setAttribute('cx', String(node.x));
          node.el.setAttribute('cy', String(node.y));
        }
      });
    }

    function animate() {
      tick();
      render();
      requestAnimationFrame(animate);
    }

    slider.addEventListener('input', applyYearFilter);
    applyYearFilter();
    animate();
  } catch (error) {
    statEl.textContent = '数据加载失败，请检查 nodes.json 与 edges.json';
    svg.innerHTML = '';
  }
}
