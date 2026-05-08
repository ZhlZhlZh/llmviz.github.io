import { loadJson } from '../../shared/data-loader.js';
import { getAppState, onAppStateChange, setAppState } from '../../shared/app-state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const LINES = [
  { id: 'representation', label: '表示学习', color: '#64748b', test: /representation|word|embedding|glove|dropout|back-propagating|neural networks/i },
  { id: 'transformer', label: 'Transformer', color: '#176b87', test: /attention|transformer|bert|t5|roberta|gpt|language model/i },
  { id: 'scaling', label: '规模化预训练', color: '#d97706', test: /scaling|few-shot|palm|switch|llama|opt|mistral|falcon|gemma|gpt-4|gemini/i },
  { id: 'alignment', label: '对齐与偏好', color: '#dc2626', test: /instruction|feedback|preference|dpo|constitutional|harmless|alignment|rlhf/i },
  { id: 'multimodal', label: '多模态', color: '#7c3aed', test: /image|visual|vision|clip|diffusion|multimodal|alphafold|gemini/i },
  { id: 'retrieval-agent', label: '检索与智能体', color: '#16a34a', test: /retrieval|rag|agent|tool|reasoning|codex|knowledge/i },
  { id: 'efficient', label: '高效架构', color: '#0f766e', test: /mamba|lora|qlora|flashattention|pagedattention|efficient|quantized|state space/i }
];

function createSvgElement(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
  return el;
}

function shorten(text, maxLength) {
  if (!text || text.length <= maxLength) return text || '';
  return `${text.slice(0, maxLength - 1)}...`;
}

function classify(node) {
  const haystack = `${node.title} ${node.abstract || ''} ${(node.topic || []).join(' ')}`;
  const matched = LINES.filter((line) => line.test.test(haystack)).map((line) => line.id);
  if (!matched.length) return ['transformer'];
  return Array.from(new Set(matched)).slice(0, 3);
}

function lineById(id) {
  return LINES.find((line) => line.id === id) || LINES[1];
}

function mapRange(value, domainMin, domainMax, rangeMin, rangeMax) {
  if (domainMin === domainMax) return (rangeMin + rangeMax) / 2;
  return rangeMin + ((value - domainMin) / (domainMax - domainMin)) * (rangeMax - rangeMin);
}

export async function initMetroMap(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="module-shell">
      <p class="module-tag">Module 05</p>
      <h3 class="module-title">主题流派地铁图</h3>
      <p class="module-subtitle">同一研究流派固定在同一条直线上；论文如果同时属于多个流派，就作为换乘站显示。</p>
      <div class="chart-toolbar chart-toolbar-wrap">
        <label class="chart-control">
          年份
          <input class="chart-range metro-year" type="range" min="1986" max="2026" step="1" value="2026" />
          <output class="year-badge metro-year-output">2026</output>
        </label>
        <label class="chart-control">
          展示数量
          <input class="chart-number metro-limit" type="number" min="24" max="96" step="8" value="56" />
        </label>
        <div class="chart-stat" aria-live="polite">加载中...</div>
      </div>
      <div class="module-canvas chart-canvas metro-canvas">
        <svg class="chart-svg metro-svg" viewBox="0 0 900 520" role="img" aria-label="Topic school metro map"></svg>
      </div>
      <div class="chart-detail metro-detail"></div>
      <div class="legend-row metro-legend"></div>
    </div>
  `;

  const yearSlider = container.querySelector('.metro-year');
  const yearOutput = container.querySelector('.metro-year-output');
  const limitInput = container.querySelector('.metro-limit');
  const statEl = container.querySelector('.chart-stat');
  const detailEl = container.querySelector('.metro-detail');
  const legendEl = container.querySelector('.metro-legend');
  const svg = container.querySelector('.metro-svg');
  if (!yearSlider || !yearOutput || !limitInput || !statEl || !detailEl || !legendEl || !svg) return;

  try {
    const [nodesData, edges] = await Promise.all([
      loadJson('./data/processed/nodes.json'),
      loadJson('./data/processed/edges.json')
    ]);

    const nodes = nodesData
      .map((node) => ({ ...node, lines: classify(node) }))
      .filter((node) => node.year >= 1986);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const minYear = Math.min(...nodes.map((node) => node.year));
    const maxYear = Math.max(...nodes.map((node) => node.year));
    yearSlider.min = String(minYear);
    yearSlider.max = String(maxYear);
    yearSlider.value = String(getAppState().year || maxYear);

    const width = 900;
    const height = 520;
    const margin = { top: 48, right: 34, bottom: 46, left: 118 };
    const lineGap = (height - margin.top - margin.bottom) / (LINES.length - 1);
    const yByLine = new Map(LINES.map((line, index) => [line.id, margin.top + index * lineGap]));

    function activeNodes() {
      const year = Number(yearSlider.value);
      const limit = Number(limitInput.value) || 56;
      return nodes
        .filter((node) => node.year <= year)
        .sort((a, b) => {
          const selectedBoost = a.id === getAppState().selectedPaperId ? -1 : b.id === getAppState().selectedPaperId ? 1 : 0;
          return selectedBoost || (b.citations_count || 0) - (a.citations_count || 0);
        })
        .slice(0, limit)
        .sort((a, b) => a.year - b.year || (b.citations_count || 0) - (a.citations_count || 0));
    }

    function stationPoint(node) {
      const x = mapRange(node.year, minYear, maxYear, margin.left, width - margin.right);
      const primary = node.lines[0];
      return { x, y: yByLine.get(primary), primary };
    }

    function renderLegend() {
      legendEl.innerHTML = '';
      LINES.forEach((line) => {
        const chip = document.createElement('span');
        chip.className = 'legend-chip';
        chip.innerHTML = `<span class="legend-swatch" style="background:${line.color}"></span>${line.label}`;
        legendEl.appendChild(chip);
      });
    }

    function render() {
      const year = Number(yearSlider.value);
      yearOutput.textContent = String(year);
      svg.innerHTML = '';
      const visible = activeNodes();
      const visibleIds = new Set(visible.map((node) => node.id));
      const points = new Map(visible.map((node) => [node.id, stationPoint(node)]));

      LINES.forEach((line) => {
        const y = yByLine.get(line.id);
        svg.appendChild(createSvgElement('line', {
          x1: margin.left - 18,
          y1: y,
          x2: width - margin.right,
          y2: y,
          class: 'metro-line-track',
          stroke: line.color
        }));
        const label = createSvgElement('text', { x: 18, y: y + 4, class: 'metro-line-label' });
        label.textContent = line.label;
        svg.appendChild(label);
      });

      edges.forEach((edge) => {
        if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) return;
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        const a = points.get(edge.source);
        const b = points.get(edge.target);
        if (!source || !target || !a || !b) return;
        const shared = source.lines.find((line) => target.lines.includes(line));
        if (shared && a.primary === b.primary) return;
        svg.appendChild(createSvgElement('line', {
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          class: 'metro-transfer-link'
        }));
      });

      visible.forEach((node) => {
        const point = points.get(node.id);
        const group = createSvgElement('g', {
          class: [
            'metro-station-group',
            node.lines.length > 1 ? 'is-transfer' : '',
            node.id === getAppState().selectedPaperId ? 'is-selected' : ''
          ].filter(Boolean).join(' '),
          transform: `translate(${point.x} ${point.y})`,
          tabindex: '0',
          role: 'button'
        });
        const station = createSvgElement('circle', {
          r: node.lines.length > 1 ? 7.5 : 5.2,
          class: 'metro-station',
          fill: lineById(point.primary).color
        });
        const title = createSvgElement('title');
        title.textContent = `${node.title}\n${node.year}\n${node.lines.map((id) => lineById(id).label).join(' / ')}`;
        station.appendChild(title);
        group.appendChild(station);
        if (node.lines.length > 1 || node.id === getAppState().selectedPaperId || (node.citations_count || 0) > 25000) {
          const label = createSvgElement('text', { x: 9, y: -7, class: 'metro-station-label' });
          label.textContent = shorten(node.title, 28);
          group.appendChild(label);
        }
        group.addEventListener('click', () => setAppState({ selectedPaperId: node.id, year: node.year, yearRangeStart: minYear, yearRangeEnd: node.year }, 'metro-map'));
        group.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setAppState({ selectedPaperId: node.id, year: node.year, yearRangeStart: minYear, yearRangeEnd: node.year }, 'metro-map');
          }
        });
        svg.appendChild(group);
      });

      const selected = nodeById.get(getAppState().selectedPaperId) || visible.find((node) => node.lines.length > 1) || visible[0];
      const transferCount = visible.filter((node) => node.lines.length > 1).length;
      statEl.textContent = `${visible.length} 个站点 · ${transferCount} 个换乘站 · 截止 ${year}`;
      detailEl.innerHTML = selected
        ? `<strong>${selected.title}</strong><br />${selected.year} · ${selected.lines.map((id) => lineById(id).label).join(' / ')}。换乘站代表它同时被多个研究流派借用，常见于跨模态、对齐或高效训练进入基础模型主线的节点。`
        : '暂无可展示论文。';
      renderLegend();
    }

    yearSlider.addEventListener('input', () => {
      setAppState({ year: Number(yearSlider.value), yearRangeStart: minYear, yearRangeEnd: Number(yearSlider.value) }, 'metro-map');
      render();
    });
    limitInput.addEventListener('change', render);
    onAppStateChange(({ state, source }) => {
      if (source === 'metro-map') return;
      if (Number.isFinite(state.year)) yearSlider.value = String(Math.min(Math.max(state.year, minYear), maxYear));
      render();
    });
    render();
  } catch (error) {
    statEl.textContent = '数据加载失败，请检查 nodes.json 与 edges.json';
    svg.innerHTML = '';
  }
}
