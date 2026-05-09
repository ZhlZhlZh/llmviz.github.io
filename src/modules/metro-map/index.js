import { loadJson } from '../../shared/data-loader.js';
import { getAppState, onAppStateChange, setAppState } from '../../shared/app-state.js';
import { createInteractiveTooltip, escapeHtml, paperLink } from '../../shared/interactive-tooltip.js';
import { paperMatchesTheme } from '../../shared/theme-filter.js';

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

const METRO_SCENARIOS = {
  transition: {
    label: '范式如何迁移',
    question: 'LLM 研究主线如何从表示学习走向 Transformer、规模化和智能体？',
    description: '按年份铺开高影响论文，把每条主题线视为一条研究路线，观察主线的出现、延展和交叉。',
    detail: '适合从宏观时间线解释研究范式如何一站一站迁移。'
  },
  transfer: {
    label: '哪里发生换乘',
    question: '哪些论文同时服务多个研究流派，成为主题换乘站？',
    description: '优先保留跨多个主题线的论文，突出多模态、对齐、高效架构等方向并入基础模型主线的位置。',
    detail: '换乘站越多，说明该论文越容易被多个方向共同借用。'
  },
  frontier: {
    label: '近期分化在哪',
    question: '2020 年后哪些新路线从主线中分化出来？',
    description: '提高近期论文权重，帮助定位 RAG、智能体、长上下文和高效架构等新支线的出现位置。',
    detail: '近期站点用于解释 LLM 从单一预训练主线扩展成多任务、多模态和工具调用生态。'
  }
};

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
      <p class="module-subtitle">把主题线当作研究路线，把跨主题论文当作换乘站，用来解释 LLM 研究主线如何分叉、汇合和再分化。</p>
      <div class="scenario-panel metro-scenario-panel">
        <div>
          <p class="scenario-kicker">问题场景</p>
          <h4 class="scenario-title metro-question-title"></h4>
          <p class="scenario-copy metro-question-copy"></p>
        </div>
        <div class="scenario-switch metro-scenario-switch" role="tablist" aria-label="地铁图问题场景">
          ${Object.entries(METRO_SCENARIOS).map(([id, scenario]) => `<button class="scenario-button metro-scenario" type="button" data-scenario="${id}">${scenario.label}</button>`).join('')}
        </div>
      </div>
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
  const canvas = container.querySelector('.metro-canvas');
  const scenarioButtons = Array.from(container.querySelectorAll('.metro-scenario'));
  const questionTitleEl = container.querySelector('.metro-question-title');
  const questionCopyEl = container.querySelector('.metro-question-copy');
  if (!yearSlider || !yearOutput || !limitInput || !statEl || !detailEl || !legendEl || !svg || !canvas || !questionTitleEl || !questionCopyEl) return;

  try {
    const [nodesData, edges] = await Promise.all([
      loadJson('./data/processed/nodes.json'),
      loadJson('./data/processed/edges.json')
    ]);

    const nodes = nodesData
      .map((node) => ({ ...node, lines: classify(node) }))
      .filter((node) => node.year >= 1986);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const tooltip = createInteractiveTooltip(canvas);
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
    let activeScenarioId = 'transition';

    function activeScenario() {
      return METRO_SCENARIOS[activeScenarioId] || METRO_SCENARIOS.transition;
    }

    function activeNodes() {
      const year = Number(yearSlider.value);
      const limit = Number(limitInput.value) || 56;
      const theme = getAppState().selectedTheme;
      return nodes
        .filter((node) => node.year <= year)
        .filter((node) => !theme || paperMatchesTheme(node, theme))
        .sort((a, b) => {
          const selectedBoost = a.id === getAppState().selectedPaperId ? -1 : b.id === getAppState().selectedPaperId ? 1 : 0;
          if (selectedBoost) return selectedBoost;
          if (activeScenarioId === 'transfer') {
            return b.lines.length - a.lines.length || (b.citations_count || 0) - (a.citations_count || 0);
          }
          if (activeScenarioId === 'frontier') {
            return b.year - a.year || (b.citations_count || 0) - (a.citations_count || 0);
          }
          return (b.citations_count || 0) - (a.citations_count || 0);
        })
        .slice(0, theme ? Math.max(limit, 96) : limit)
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

    function renderScenario() {
      const scenario = activeScenario();
      questionTitleEl.textContent = scenario.question;
      questionCopyEl.textContent = scenario.description;
      scenarioButtons.forEach((button) => {
        const active = button.dataset.scenario === activeScenarioId;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', String(active));
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
        group.appendChild(station);
        const url = paperLink(node);
        const lineText = node.lines.map((id) => lineById(id).label).join(' / ');
        const tooltipHtml = `<strong>${escapeHtml(node.title)}</strong><span>${escapeHtml(node.year)} · ${escapeHtml(lineText)}</span><span>引用 ${(node.citations_count || 0).toLocaleString()}</span>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">打开论文链接</a>` : ''}`;
        group.addEventListener('pointerenter', (event) => tooltip.show(event, tooltipHtml));
        group.addEventListener('pointermove', (event) => tooltip.move(event));
        group.addEventListener('pointerleave', () => tooltip.hideSoon());
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
      const theme = getAppState().selectedTheme;
      statEl.textContent = `${visible.length} 个站点 · ${transferCount} 个换乘站 · 截止 ${year}${theme ? ` · 主题：${theme}` : ''}`;
      renderScenario();
      detailEl.innerHTML = selected
        ? `<strong>${selected.title}</strong><br />${selected.year} · ${selected.lines.map((id) => lineById(id).label).join(' / ')}。${theme ? `当前正在查看“${theme}”主题。` : ''}${activeScenario().detail}`
        : '暂无可展示论文。';
      renderLegend();
    }

    yearSlider.addEventListener('input', () => {
      setAppState({ year: Number(yearSlider.value), yearRangeStart: minYear, yearRangeEnd: Number(yearSlider.value) }, 'metro-map');
      render();
    });
    limitInput.addEventListener('change', render);
    scenarioButtons.forEach((button) => {
      button.addEventListener('click', () => {
        activeScenarioId = button.dataset.scenario || 'transition';
        if (activeScenarioId === 'frontier') {
          yearSlider.value = String(maxYear);
          setAppState({ year: maxYear, yearRangeStart: Math.max(2020, minYear), yearRangeEnd: maxYear }, 'metro-map');
        }
        render();
      });
    });
    onAppStateChange(({ state, source }) => {
      if (source === 'metro-map') return;
      if (Number.isFinite(state.year)) yearSlider.value = String(Math.min(Math.max(state.year, minYear), maxYear));
      if (state.selectedTheme) limitInput.value = String(Math.max(Number(limitInput.value) || 56, 96));
      render();
    });
    render();
  } catch (error) {
    statEl.textContent = '数据加载失败，请检查 nodes.json 与 edges.json';
    svg.innerHTML = '';
  }
}
