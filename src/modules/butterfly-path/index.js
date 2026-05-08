import { loadJson } from '../../shared/data-loader.js';
import { getAppState, onAppStateChange, setAppState } from '../../shared/app-state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const PRESET_DEFINITIONS = [
  {
    label: 'Transformer -> GPT-3',
    start: 'Attention is All you Need',
    end: 'Language Models are Few-Shot Learners',
    note: '从注意力架构到大规模自回归语言模型，展示“结构创新如何变成规模化范式”。'
  },
  {
    label: 'GPT-1 -> GPT-3',
    start: 'Improving Language Understanding by Generative Pre-Training',
    end: 'Language Models are Few-Shot Learners',
    note: '从生成式预训练到少样本学习，解释 GPT 路线如何把预训练模型推向通用接口。'
  },
  {
    label: 'BERT -> RoBERTa',
    start: 'BERT: Pre-training of Deep Bidirectional Transformers',
    end: 'RoBERTa',
    note: '同一预训练流派内部的优化路径，突出目标函数、数据和训练策略的迭代。'
  },
  {
    label: 'RAG -> GPT-4',
    start: 'Retrieval-Augmented Generation',
    end: 'GPT-4 Technical Report',
    note: '从外部知识注入到通用模型能力，观察检索增强与大模型推理之间的连接。'
  },
  {
    label: 'CLIP -> Gemini 1.5',
    start: 'Learning Transferable Visual Models From Natural Language Supervision',
    end: 'Gemini 1.5',
    note: '从图文对齐到长上下文多模态，说明视觉-语言表示如何进入基础模型主线。'
  },
  {
    label: 'InstructGPT -> DPO',
    start: 'Training language models to follow instructions with human feedback',
    end: 'Direct Preference Optimization',
    note: '从人类反馈强化学习到直接偏好优化，展示对齐方法从复杂管线走向轻量训练目标。'
  },
  {
    label: 'Mamba -> 长上下文模型',
    start: 'Mamba: Linear-Time Sequence Modeling',
    end: 'Gemini 1.5',
    note: '把高效序列建模放到长上下文问题中，比较注意力替代路线与主流基础模型需求。'
  }
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

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value) return [value];
  return [];
}

function primaryTopic(node) {
  const topics = asArray(node.topic);
  if (topics.some((topic) => /linguistics/i.test(topic))) return '语言';
  if (topics.some((topic) => /medicine|biology/i.test(topic))) return '应用';
  if (topics.some((topic) => /mathematics/i.test(topic))) return '方法';
  return '计算';
}

function phaseLabel(year) {
  if (year <= 2017) return '基础机制';
  if (year <= 2022) return '预训练扩展';
  return '对齐与智能体';
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

function shortestPath(adjacency, startId, endId, maxDepth = 9) {
  if (!startId || !endId) return [];
  if (startId === endId) return [startId];
  const queue = [{ id: startId, depth: 0 }];
  const prev = new Map();
  const visited = new Set([startId]);

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const { id, depth } = queue[cursor];
    if (depth >= maxDepth) continue;
    for (const next of adjacency.get(id) || []) {
      if (visited.has(next)) continue;
      visited.add(next);
      prev.set(next, id);
      if (next === endId) {
        const path = [endId];
        let current = endId;
        while (prev.has(current)) {
          current = prev.get(current);
          path.push(current);
        }
        return path.reverse();
      }
      queue.push({ id: next, depth: depth + 1 });
    }
  }
  return [];
}

function findByTitle(nodes, query) {
  const q = query.toLowerCase();
  return nodes
    .filter((node) => node.title.toLowerCase().includes(q))
    .sort((a, b) => (b.citations_count || 0) - (a.citations_count || 0))[0] || null;
}

function optionText(node) {
  return `${node.year} | ${shorten(node.title, 64)}`;
}

function summarizePath(pathNodes, fallbackNote) {
  if (!pathNodes.length) return '请选择起点和终点论文，系统会只展示两者之间的可达路径。';
  const start = pathNodes[0];
  const end = pathNodes[pathNodes.length - 1];
  const topics = Array.from(new Set(pathNodes.map(primaryTopic)));
  const institutions = Array.from(
    new Set(pathNodes.flatMap((node) => asArray(node.institution)).slice(0, 12))
  );
  const bridge = pathNodes.slice(1, -1).sort((a, b) => (b.citations_count || 0) - (a.citations_count || 0))[0];
  const bridgeText = bridge ? `中间最像桥梁的是《${shorten(bridge.title, 42)}》，它把 ${phaseLabel(start.year)} 的问题带到 ${phaseLabel(end.year)}。` : '这是一条直接连接。';
  const instText = institutions.length ? `涉及机构包括 ${institutions.slice(0, 5).join('、')}。` : '这条路径的机构数据仍需继续补齐。';
  return `${fallbackNote || `这条路径连接《${shorten(start.title, 32)}》与《${shorten(end.title, 32)}》。`} ${bridgeText} 主题跨度：${topics.join(' / ')}。${instText}`;
}

export async function initButterflyPath(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="module-shell">
      <p class="module-tag">Module 03</p>
      <h3 class="module-title">蝴蝶影响路径图</h3>
      <p class="module-subtitle">把局部网络改成“路径解释器”：选择一条预设路线，或手动指定起点与终点，只保留路径相关论文。</p>
      <div class="chart-toolbar chart-toolbar-wrap">
        <label class="chart-control">
          预设路径
          <select class="chart-select butterfly-preset-select"></select>
        </label>
        <label class="chart-control">
          起点论文
          <select class="chart-select butterfly-start-select"></select>
        </label>
        <label class="chart-control">
          终点论文
          <select class="chart-select butterfly-end-select"></select>
        </label>
        <label class="chart-control">
          搜索论文
          <input class="chart-input butterfly-search" list="butterfly-paper-list" placeholder="标题 / 作者 / 机构" />
        </label>
        <button class="chart-button butterfly-use-search-start" type="button">设为起点</button>
        <button class="chart-button butterfly-use-search-end" type="button">设为终点</button>
        <datalist id="butterfly-paper-list"></datalist>
        <div class="chart-stat" aria-live="polite">加载中...</div>
      </div>
      <div class="module-canvas chart-canvas butterfly-canvas">
        <svg class="chart-svg butterfly-svg" viewBox="0 0 900 460" role="img" aria-label="Hierarchical influence path chart"></svg>
      </div>
      <div class="butterfly-explain-grid">
        <div class="chart-detail butterfly-detail"></div>
        <ol class="butterfly-step-list"></ol>
      </div>
      <div class="legend-row">
        <span class="legend-chip">横向 = 路径顺序</span>
        <span class="legend-chip">纵向 = 论文主要领域</span>
        <span class="legend-chip">虚线 = 跨领域影响</span>
      </div>
    </div>
  `;

  const presetSelect = container.querySelector('.butterfly-preset-select');
  const startSelect = container.querySelector('.butterfly-start-select');
  const endSelect = container.querySelector('.butterfly-end-select');
  const searchInput = container.querySelector('.butterfly-search');
  const useSearchStart = container.querySelector('.butterfly-use-search-start');
  const useSearchEnd = container.querySelector('.butterfly-use-search-end');
  const paperList = container.querySelector('#butterfly-paper-list');
  const statEl = container.querySelector('.chart-stat');
  const detailEl = container.querySelector('.butterfly-detail');
  const stepList = container.querySelector('.butterfly-step-list');
  const svg = container.querySelector('.butterfly-svg');

  if (!presetSelect || !startSelect || !endSelect || !searchInput || !useSearchStart || !useSearchEnd || !paperList || !statEl || !detailEl || !stepList || !svg) return;

  try {
    const [nodesData, edgesData] = await Promise.all([
      loadJson('./data/processed/nodes.json'),
      loadJson('./data/processed/edges.json')
    ]);

    const nodes = nodesData.map((node) => ({ ...node }));
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const adjacency = buildAdjacency(nodes, edgesData);
    const width = 900;
    const height = 460;
    const margin = { top: 56, right: 42, bottom: 54, left: 78 };
    const laneLabels = ['计算', '语言', '方法', '应用'];
    const laneY = new Map(laneLabels.map((label, index) => [
      label,
      margin.top + index * ((height - margin.top - margin.bottom) / Math.max(laneLabels.length - 1, 1))
    ]));

    let activeNote = '';
    let startId = getAppState().selectedPaperId || '';
    let endId = '';
    let activePath = [];

    function fillPaperSelect(select) {
      select.innerHTML = '';
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '请选择论文';
      select.appendChild(empty);
      nodes
        .slice()
        .sort((a, b) => a.year - b.year || (b.citations_count || 0) - (a.citations_count || 0))
        .forEach((node) => {
          const option = document.createElement('option');
          option.value = node.id;
          option.textContent = optionText(node);
          select.appendChild(option);
        });
    }

    function findSearchPaper() {
      const q = searchInput.value.trim().toLowerCase();
      if (!q) return null;
      return nodes
        .filter((node) => {
          const haystack = `${node.title} ${(node.authors || []).join(' ')} ${asArray(node.institution).join(' ')}`.toLowerCase();
          return haystack.includes(q);
        })
        .sort((a, b) => (b.citations_count || 0) - (a.citations_count || 0))[0] || null;
    }

    fillPaperSelect(startSelect);
    fillPaperSelect(endSelect);
    nodes.forEach((node) => {
      const option = document.createElement('option');
      option.value = `${node.title} | ${(node.authors || []).slice(0, 3).join(', ')} | ${asArray(node.institution).join(', ')}`;
      paperList.appendChild(option);
    });

    const presets = PRESET_DEFINITIONS
      .map((preset) => {
        const start = findByTitle(nodes, preset.start);
        const end = findByTitle(nodes, preset.end);
        if (!start || !end) return null;
        const path = shortestPath(adjacency, start.id, end.id);
        return path.length ? { ...preset, startId: start.id, endId: end.id, path } : null;
      })
      .filter(Boolean)
      .slice(0, 8);

    presetSelect.innerHTML = '';
    presets.forEach((preset, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = preset.label;
      presetSelect.appendChild(option);
    });
    const custom = document.createElement('option');
    custom.value = 'custom';
    custom.textContent = '手动选择起点和终点';
    presetSelect.appendChild(custom);

    if (!startId && presets[0]) {
      startId = presets[0].startId;
      endId = presets[0].endId;
      activeNote = presets[0].note;
    }

    function nodePoint(node, index, total) {
      const x = total <= 1
        ? width / 2
        : margin.left + index * ((width - margin.left - margin.right) / (total - 1));
      return { x, y: laneY.get(primaryTopic(node)) || laneY.get('计算') };
    }

    function renderAxis() {
      laneLabels.forEach((label) => {
        const y = laneY.get(label);
        svg.appendChild(createSvgElement('line', {
          x1: margin.left - 18,
          y1: y,
          x2: width - margin.right + 14,
          y2: y,
          class: 'butterfly-lane-line'
        }));
        const text = createSvgElement('text', { x: 16, y: y + 4, class: 'butterfly-lane-label' });
        text.textContent = label;
        svg.appendChild(text);
      });
    }

    function render() {
      startSelect.value = startId;
      endSelect.value = endId;
      activePath = shortestPath(adjacency, startId, endId);
      svg.innerHTML = '';
      renderAxis();

      const pathNodes = activePath.map((id) => nodeById.get(id)).filter(Boolean);
      const points = pathNodes.map((node, index) => nodePoint(node, index, pathNodes.length));

      points.slice(0, -1).forEach((point, index) => {
        const next = points[index + 1];
        const isCross = primaryTopic(pathNodes[index]) !== primaryTopic(pathNodes[index + 1]);
        svg.appendChild(createSvgElement('line', {
          x1: point.x,
          y1: point.y,
          x2: next.x,
          y2: next.y,
          class: isCross ? 'butterfly-path-link is-cross' : 'butterfly-path-link'
        }));
      });

      pathNodes.forEach((node, index) => {
        const point = points[index];
        const group = createSvgElement('g', {
          class: [
            'butterfly-path-node-group',
            phaseClassByYear(node.year),
            index === 0 ? 'is-start' : '',
            index === pathNodes.length - 1 ? 'is-end' : ''
          ].filter(Boolean).join(' '),
          transform: `translate(${point.x} ${point.y})`,
          tabindex: '0',
          role: 'button'
        });
        const circle = createSvgElement('circle', { r: index === 0 || index === pathNodes.length - 1 ? 10 : 7, class: 'butterfly-path-node' });
        const label = createSvgElement('text', {
          x: 0,
          y: point.y > height * 0.68 ? -18 : 24,
          class: 'butterfly-path-label',
          'text-anchor': 'middle'
        });
        label.textContent = shorten(node.title, 24);
        const year = createSvgElement('text', {
          x: 0,
          y: 4,
          class: 'butterfly-path-year',
          'text-anchor': 'middle'
        });
        year.textContent = node.year;
        const title = createSvgElement('title');
        title.textContent = `${node.title}\n${phaseLabel(node.year)}\n${asArray(node.institution).join(', ') || '机构待补齐'}`;
        circle.appendChild(title);
        group.append(circle, year, label);
        group.addEventListener('click', () => {
          setAppState({ selectedPaperId: node.id, year: node.year, yearRangeStart: node.year, yearRangeEnd: node.year }, 'butterfly-path');
        });
        group.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setAppState({ selectedPaperId: node.id, year: node.year, yearRangeStart: node.year, yearRangeEnd: node.year }, 'butterfly-path');
          }
        });
        svg.appendChild(group);
      });

      if (!pathNodes.length && startId && endId) {
        const empty = createSvgElement('text', { x: width / 2, y: height / 2, class: 'butterfly-empty', 'text-anchor': 'middle' });
        empty.textContent = '当前图数据中没有找到可达路径，可以换一组起点和终点。';
        svg.appendChild(empty);
      }

      detailEl.textContent = summarizePath(pathNodes, activeNote);
      stepList.innerHTML = pathNodes.map((node, index) => {
        const institutions = asArray(node.institution);
        return `<li><strong>${index + 1}. ${node.year}</strong><span>${shorten(node.title, 72)}</span><em>${phaseLabel(node.year)} · ${primaryTopic(node)} · ${institutions[0] || '机构待补齐'}</em></li>`;
      }).join('');
      statEl.textContent = pathNodes.length
        ? `${pathNodes.length} 个路径节点，${Math.max(pathNodes.length - 1, 0)} 段影响连接`
        : '请选择起点和终点';
    }

    presetSelect.addEventListener('change', () => {
      const preset = presets[Number(presetSelect.value)];
      if (!preset) {
        activeNote = '';
        render();
        return;
      }
      startId = preset.startId;
      endId = preset.endId;
      activeNote = preset.note;
      setAppState({ selectedPaperId: startId, year: nodeById.get(startId)?.year }, 'butterfly-path');
      render();
    });
    startSelect.addEventListener('change', () => {
      presetSelect.value = 'custom';
      startId = startSelect.value;
      activeNote = '';
      const node = nodeById.get(startId);
      if (node) setAppState({ selectedPaperId: node.id, year: node.year, yearRangeStart: node.year, yearRangeEnd: node.year }, 'butterfly-path');
      render();
    });
    endSelect.addEventListener('change', () => {
      presetSelect.value = 'custom';
      endId = endSelect.value;
      activeNote = '';
      render();
    });
    useSearchStart.addEventListener('click', () => {
      const node = findSearchPaper();
      if (!node) return;
      presetSelect.value = 'custom';
      startId = node.id;
      activeNote = '';
      setAppState({ selectedPaperId: node.id, year: node.year, yearRangeStart: node.year, yearRangeEnd: node.year }, 'butterfly-path');
      render();
    });
    useSearchEnd.addEventListener('click', () => {
      const node = findSearchPaper();
      if (!node) return;
      presetSelect.value = 'custom';
      endId = node.id;
      activeNote = '';
      render();
    });
    onAppStateChange(({ state, source }) => {
      if (source === 'butterfly-path') return;
      if (state.selectedPaperId && nodeById.has(state.selectedPaperId)) {
        presetSelect.value = 'custom';
        startId = state.selectedPaperId;
        activeNote = '';
        render();
      }
    });

    if (presets[0]) presetSelect.value = '0';
    render();
  } catch (error) {
    statEl.textContent = '数据加载失败，请检查 nodes.json 与 edges.json';
    svg.innerHTML = '';
  }
}
