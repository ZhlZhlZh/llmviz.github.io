import { loadJson } from '../../shared/data-loader.js';
import { getAppState, onAppStateChange, setAppState } from '../../shared/app-state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

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

function phaseIdByYear(year) {
  if (year <= 2017) {
    return 'phase_foundation';
  }
  if (year <= 2022) {
    return 'phase_boom';
  }
  return 'phase_agentic';
}

function mapRange(value, domainMin, domainMax, rangeMin, rangeMax) {
  if (domainMin === domainMax) {
    return (rangeMin + rangeMax) / 2;
  }
  const t = (value - domainMin) / (domainMax - domainMin);
  return rangeMin + t * (rangeMax - rangeMin);
}

function buildRelations(nodes, edges) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const citedBy = new Map(nodes.map((node) => [node.id, []]));
  const cites = new Map(nodes.map((node) => [node.id, []]));

  edges.forEach((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) {
      return;
    }
    cites.get(source.id).push(target);
    citedBy.get(target.id).push(source);
  });

  return { nodeById, citedBy, cites };
}

export async function initAiHistory(container) {
  if (!container) {
    return;
  }

  container.innerHTML = `
    <div class="module-shell ai-history-shell">
      <p class="module-tag">Module 05</p>
      <h3 class="module-title">AI 研究简史生成器</h3>
      <p class="module-subtitle">把当前选中的论文放回阶段演化链条中，生成可用于课堂演示的简短解释。</p>
      <div class="chart-toolbar chart-toolbar-wrap">
        <label class="chart-control">
          叙事焦点
          <select class="chart-select history-paper-select"></select>
        </label>
        <div class="chart-stat" aria-live="polite">加载中...</div>
      </div>
      <div class="module-canvas chart-canvas ai-history-canvas">
        <svg class="chart-svg" viewBox="0 0 860 240" role="img" aria-label="AI paper history timeline"></svg>
      </div>
      <div class="history-cards">
        <article class="history-card history-summary"></article>
        <article class="history-card history-before"></article>
        <article class="history-card history-after"></article>
      </div>
    </div>
  `;

  const selectEl = container.querySelector('.history-paper-select');
  const statEl = container.querySelector('.chart-stat');
  const svg = container.querySelector('.chart-svg');
  const summaryEl = container.querySelector('.history-summary');
  const beforeEl = container.querySelector('.history-before');
  const afterEl = container.querySelector('.history-after');

  if (!selectEl || !statEl || !svg || !summaryEl || !beforeEl || !afterEl) {
    return;
  }

  try {
    const [nodes, edges, phases] = await Promise.all([
      loadJson('./data/processed/nodes.json'),
      loadJson('./data/processed/edges.json'),
      loadJson('./data/processed/phases.json')
    ]);

    const sortedNodes = nodes.slice().sort((a, b) => {
      if (a.year !== b.year) {
        return a.year - b.year;
      }
      return a.title.localeCompare(b.title);
    });
    const { nodeById, citedBy, cites } = buildRelations(sortedNodes, edges);
    const phaseById = new Map(phases.map((phase) => [phase.id, phase]));

    sortedNodes.forEach((node) => {
      const option = document.createElement('option');
      option.value = node.id;
      option.textContent = `${node.year} | ${shortenText(node.title, 46)}`;
      selectEl.appendChild(option);
    });

    const width = 860;
    const height = 240;
    const margin = { top: 34, right: 26, bottom: 36, left: 34 };
    const innerWidth = width - margin.left - margin.right;
    const minYear = Math.min(...sortedNodes.map((node) => node.year));
    const maxYear = Math.max(...sortedNodes.map((node) => node.year));
    const phaseRows = ['phase_foundation', 'phase_boom', 'phase_agentic'];
    const rowY = new Map([
      ['phase_foundation', 60],
      ['phase_boom', 122],
      ['phase_agentic', 184]
    ]);

    const root = createSvgElement('g', {
      transform: `translate(${margin.left}, ${margin.top})`
    });
    svg.appendChild(root);

    phaseRows.forEach((phaseId) => {
      const y = rowY.get(phaseId);
      const phase = phaseById.get(phaseId);
      const band = createSvgElement('line', {
        x1: 0,
        y1: y,
        x2: innerWidth,
        y2: y,
        class: `history-row ${phaseId}`
      });
      root.appendChild(band);

      const label = createSvgElement('text', {
        x: 0,
        y: y - 12,
        class: 'history-row-label'
      });
      label.textContent = phase ? phase.label : phaseId;
      root.appendChild(label);
    });

    for (let year = minYear; year <= maxYear; year += 1) {
      const x = mapRange(year, minYear, maxYear, 0, innerWidth);
      const tick = createSvgElement('line', {
        x1: x,
        y1: 26,
        x2: x,
        y2: 196,
        class: 'history-year-line'
      });
      root.appendChild(tick);

      if ((year - minYear) % 2 === 0 || year === maxYear) {
        const label = createSvgElement('text', {
          x,
          y: 214,
          'text-anchor': 'middle',
          class: 'chart-axis-label'
        });
        label.textContent = String(year);
        root.appendChild(label);
      }
    }

    const marks = new Map();
    sortedNodes.forEach((node) => {
      const x = mapRange(node.year, minYear, maxYear, 0, innerWidth);
      const y = rowY.get(phaseIdByYear(node.year));
      const mark = createSvgElement('circle', {
        cx: x,
        cy: y,
        r: 6,
        class: `history-node ${phaseIdByYear(node.year)}`,
        'data-id': node.id
      });
      const title = createSvgElement('title');
      title.textContent = `${node.title} (${node.year})`;
      mark.appendChild(title);
      mark.addEventListener('click', () => {
        setAppState({ selectedPaperId: node.id, year: node.year }, 'ai-history');
      });
      root.appendChild(mark);
      marks.set(node.id, mark);
    });

    function render(selectedId) {
      const node = nodeById.get(selectedId) || sortedNodes[0];
      if (!node) {
        return;
      }
      selectEl.value = node.id;

      marks.forEach((mark, id) => {
        mark.classList.toggle('is-selected', id === node.id);
        mark.classList.toggle('is-related', (citedBy.get(node.id) || []).some((item) => item.id === id)
          || (cites.get(node.id) || []).some((item) => item.id === id));
      });

      const phase = phaseById.get(phaseIdByYear(node.year));
      const prior = (cites.get(node.id) || []).slice().sort((a, b) => b.year - a.year).slice(0, 3);
      const later = (citedBy.get(node.id) || []).slice().sort((a, b) => a.year - b.year).slice(0, 3);

      statEl.textContent = `${node.year} · ${phase ? phase.label : '研究阶段'} · ${node.institution}`;
      summaryEl.innerHTML = `
        <h4>阶段定位</h4>
        <p><strong>${node.title}</strong> 位于 ${phase ? phase.label : node.year}。${node.abstract}</p>
        <p>它的可视化意义在于：把主题热度中的阶段变化，与引用网络中的结构位置连接起来。</p>
      `;
      beforeEl.innerHTML = `
        <h4>前置基础</h4>
        <ul>
          ${
            prior.length
              ? prior.map((item) => `<li>${item.year} · ${shortenText(item.title, 68)}</li>`).join('')
              : '<li>该节点在示例数据中没有更早的显式引用。</li>'
          }
        </ul>
      `;
      afterEl.innerHTML = `
        <h4>后续影响</h4>
        <ul>
          ${
            later.length
              ? later.map((item) => `<li>${item.year} · ${shortenText(item.title, 68)}</li>`).join('')
              : '<li>该节点位于较新的阶段，后续影响仍在形成。</li>'
          }
        </ul>
      `;
    }

    selectEl.value = getAppState().selectedPaperId;
    selectEl.addEventListener('change', () => {
      const node = nodeById.get(selectEl.value);
      setAppState(
        {
          selectedPaperId: selectEl.value,
          year: node ? node.year : getAppState().year
        },
        'ai-history'
      );
    });
    onAppStateChange(({ state }) => render(state.selectedPaperId));
    render(getAppState().selectedPaperId);
  } catch (error) {
    statEl.textContent = '数据加载失败，请检查 nodes.json、edges.json 与 phases.json';
    svg.innerHTML = '';
  }
}
