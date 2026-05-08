import { loadJson } from '../../shared/data-loader.js';
import { getAppState, onAppStateChange, setAppState } from '../../shared/app-state.js';
import { applyForceLayout } from '../../shared/force-layout.js';

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

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value) return [value];
  return [];
}

function overlapCount(a, b) {
  const setA = new Set(asArray(a).map((item) => String(item).toLowerCase()));
  return asArray(b).filter((item) => setA.has(String(item).toLowerCase())).length;
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

function paperSearchText(node) {
  return `${node.title} ${(node.authors || []).join(' ')} ${asArray(node.topic).join(' ')} ${asArray(node.institution).join(' ')}`.toLowerCase();
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
      <div class="knowledge-lab">
        <section class="knowledge-box" aria-label="Personal knowledge base builder">
          <div class="knowledge-box-head">
            <div>
              <h4>我的知识库</h4>
              <p>把左侧论文拖入空白框，或搜索添加，生成可复用的力导向知识子图。</p>
            </div>
            <button class="chart-button knowledge-clear-button" type="button">清空</button>
          </div>
          <div class="knowledge-search-row">
            <input class="chart-input knowledge-search" list="force-paper-list" placeholder="搜索论文标题 / 作者 / 机构" />
            <button class="chart-button knowledge-add-button" type="button">添加</button>
            <datalist id="force-paper-list"></datalist>
          </div>
          <svg class="knowledge-svg" viewBox="0 0 520 320" role="img" aria-label="Personal paper knowledge base"></svg>
        </section>
        <section class="knowledge-recommend-panel">
          <h4>今日相关 Paper</h4>
          <p>静态演示：按邻接、主题、作者/机构和引用影响力打分。</p>
          <div class="knowledge-recommend-list"></div>
        </section>
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
  const knowledgeBox = container.querySelector('.knowledge-box');
  const knowledgeSvg = container.querySelector('.knowledge-svg');
  const knowledgeSearch = container.querySelector('.knowledge-search');
  const knowledgeAddButton = container.querySelector('.knowledge-add-button');
  const knowledgeClearButton = container.querySelector('.knowledge-clear-button');
  const paperList = container.querySelector('#force-paper-list');
  const recommendList = container.querySelector('.knowledge-recommend-list');

  if (!startSlider || !endSlider || !startOutput || !endOutput || !authorInput || !authorList || !maxInput || !labelMode || !resetButton || !statEl || !detailEl || !svg || !knowledgeBox || !knowledgeSvg || !knowledgeSearch || !knowledgeAddButton || !knowledgeClearButton || !paperList || !recommendList) return;

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
    nodes.forEach((node) => {
      const option = document.createElement('option');
      option.value = `${node.title} | ${(node.authors || []).slice(0, 3).join(', ')} | ${asArray(node.institution).join(', ')}`;
      paperList.appendChild(option);
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
    let knowledgeIds = new Set(nodes.slice().sort((a, b) => b.citations_count - a.citations_count).slice(0, 3).map((node) => node.id));
    let knowledgeGraphById = new Map();
    let knowledgeSimNodes = [];
    let knowledgeSimLinks = [];
    let knowledgeViewport = null;
    let knowledgeTransform = { x: 0, y: 0, k: 1 };
    let draggingKnowledgeNode = null;
    let panningKnowledge = null;

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

    function findPaper(query) {
      const q = query.trim().toLowerCase();
      if (!q) return null;
      return nodes
        .filter((node) => paperSearchText(node).includes(q))
        .sort((a, b) => b.citations_count - a.citations_count)[0] || null;
    }

    function isPointerInsideKnowledgeBox(event) {
      const rect = knowledgeBox.getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    }

    function addKnowledgePaper(id) {
      if (!id || !nodeById.has(id)) return;
      knowledgeIds.add(id);
      renderKnowledgeBase();
    }

    function removeKnowledgePaper(id) {
      knowledgeIds.delete(id);
      knowledgeGraphById.delete(id);
      renderKnowledgeBase();
    }

    function scoreRecommendation(candidate, knowledgeNodes) {
      const neighborHits = knowledgeNodes.reduce((sum, paper) => sum + (adjacency.get(candidate.id)?.has(paper.id) ? 1 : 0), 0);
      const topicHits = knowledgeNodes.reduce((sum, paper) => sum + overlapCount(candidate.topic, paper.topic), 0);
      const authorHits = knowledgeNodes.reduce((sum, paper) => sum + overlapCount(candidate.authors, paper.authors), 0);
      const institutionHits = knowledgeNodes.reduce((sum, paper) => sum + overlapCount(candidate.institution, paper.institution), 0);
      const citationBoost = Math.log10((candidate.citations_count || 1) + 1) / 3;
      return neighborHits * 8 + topicHits * 2.4 + authorHits * 3 + institutionHits * 2.2 + citationBoost;
    }

    function relationScore(a, b) {
      return (adjacency.get(a.id)?.has(b.id) ? 8 : 0)
        + overlapCount(a.topic, b.topic) * 2.4
        + overlapCount(a.authors, b.authors) * 3
        + overlapCount(a.institution, b.institution) * 2.2;
    }

    function similarityScore(a, b) {
      return overlapCount(a.topic, b.topic) * 2.4
        + overlapCount(a.authors, b.authors) * 3
        + overlapCount(a.institution, b.institution) * 2.2;
    }

    function buildKnowledgeRelationLinks(knowledgeNodes, graphById) {
      const realLinks = [];
      const inferredLinks = [];
      for (let i = 0; i < knowledgeNodes.length; i += 1) {
        for (let j = i + 1; j < knowledgeNodes.length; j += 1) {
          const source = knowledgeNodes[i];
          const target = knowledgeNodes[j];
          const sourceNode = graphById.get(source.id);
          const targetNode = graphById.get(target.id);
          if (!sourceNode || !targetNode) continue;
          if (adjacency.get(source.id)?.has(target.id)) {
            realLinks.push({
              source,
              target,
              score: relationScore(source, target),
              inferred: false,
              sourceNode,
              targetNode
            });
            continue;
          }
          const score = similarityScore(source, target);
          if (score <= 0) continue;
          inferredLinks.push({
            source,
            target,
            score,
            inferred: true,
            sourceNode,
            targetNode
          });
        }
      }
      const inferredLimit = Math.max(knowledgeNodes.length + 1 - realLinks.length, 0);
      return [
        ...realLinks.sort((a, b) => b.score - a.score),
        ...inferredLinks.sort((a, b) => b.score - a.score).slice(0, inferredLimit)
      ];
    }

    function getRecommendations() {
      const knowledgeNodes = Array.from(knowledgeIds).map((id) => nodeById.get(id)).filter(Boolean);
      if (!knowledgeNodes.length) {
        return nodes.slice().sort((a, b) => b.citations_count - a.citations_count).slice(3, 9);
      }
      return nodes
        .filter((node) => !knowledgeIds.has(node.id))
        .map((node) => ({ node, score: scoreRecommendation(node, knowledgeNodes) }))
        .sort((a, b) => b.score - a.score || b.node.citations_count - a.node.citations_count)
        .slice(0, 6)
        .map((item) => item.node);
    }

    function createKnowledgeNode(node, index, total, recommended = false) {
      const existing = knowledgeGraphById.get(node.id);
      if (existing) {
        existing.data = node;
        existing.recommended = recommended;
        return existing;
      }
      const angle = (Math.PI * 2 * index) / Math.max(total, 1) - Math.PI / 2;
      const radius = recommended ? 128 : 68;
      const graphNode = {
        id: node.id,
        data: node,
        recommended,
        x: 260 + Math.cos(angle) * radius,
        y: 160 + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        fixed: false
      };
      if (!recommended) knowledgeGraphById.set(node.id, graphNode);
      return graphNode;
    }

    function bestRecommendationLink(recommendation, knowledgeNodes) {
      const candidates = knowledgeNodes
        .map((paper) => ({
          paper,
          score: (adjacency.get(recommendation.id)?.has(paper.id) ? 8 : 0)
            + overlapCount(recommendation.topic, paper.topic) * 2.4
            + overlapCount(recommendation.authors, paper.authors) * 3
            + overlapCount(recommendation.institution, paper.institution) * 2.2
        }))
        .sort((a, b) => b.score - a.score);
      return candidates[0]?.paper || knowledgeNodes[0];
    }

    function renderKnowledgeBase() {
      const knowledgeNodes = Array.from(knowledgeIds).map((id) => nodeById.get(id)).filter(Boolean);
      const recommendations = getRecommendations();
      knowledgeGraphById.forEach((_, id) => {
        if (!knowledgeIds.has(id)) knowledgeGraphById.delete(id);
      });
      const knowledgeGraphNodes = knowledgeNodes.map((node, index) => createKnowledgeNode(node, index, knowledgeNodes.length));
      const recommendationGraphNodes = recommendations.map((node, index) => createKnowledgeNode(node, index, recommendations.length, true));
      const graphById = new Map([...knowledgeGraphNodes, ...recommendationGraphNodes].map((node) => [node.id, node]));
      knowledgeSimNodes = [...knowledgeGraphNodes, ...recommendationGraphNodes];
      knowledgeSimLinks = [];
      knowledgeSvg.innerHTML = '';

      if (!knowledgeNodes.length) {
        const empty = createSvgElement('text', { x: 260, y: 158, class: 'knowledge-empty', 'text-anchor': 'middle' });
        empty.textContent = '拖入论文或搜索添加，开始搭建你的知识库。';
        knowledgeSvg.appendChild(empty);
      }

      buildKnowledgeRelationLinks(knowledgeNodes, graphById)
        .forEach((link) => {
          const line = createSvgElement('line', { class: link.inferred ? 'knowledge-link is-inferred' : 'knowledge-link' });
          knowledgeSvg.appendChild(line);
          knowledgeSimLinks.push({
            sourceNode: link.sourceNode,
            targetNode: link.targetNode,
            el: line,
            springLength: Math.max(60, 108 - link.score * 4),
            springStrength: link.inferred ? 0.002 : 0.0055
          });
        });

      recommendations.forEach((node) => {
        const recommendationGraphNode = graphById.get(node.id);
        const target = bestRecommendationLink(node, knowledgeNodes);
        const targetGraphNode = target ? graphById.get(target.id) : null;
        if (recommendationGraphNode && targetGraphNode) {
          const line = createSvgElement('line', { class: 'knowledge-link is-recommended' });
          knowledgeSvg.appendChild(line);
          knowledgeSimLinks.push({
            sourceNode: recommendationGraphNode,
            targetNode: targetGraphNode,
            el: line,
            springLength: 118,
            springStrength: 0.0025
          });
        }
      });

      recommendationGraphNodes.forEach((graphNode) => {
        const node = graphNode.data;
        const group = createSvgElement('g', { class: 'knowledge-node-group is-recommended', tabindex: '0', role: 'button' });
        const circle = createSvgElement('circle', { r: 12, class: 'knowledge-recommend-node' });
        const label = createSvgElement('text', { x: 16, y: 4, class: 'knowledge-node-label' });
        label.textContent = shorten(node.title, 26);
        group.append(circle, label);
        group.addEventListener('click', () => addKnowledgePaper(node.id));
        group.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            addKnowledgePaper(node.id);
          }
        });
        knowledgeSvg.appendChild(group);
        graphNode.el = group;
      });

      knowledgeGraphNodes.forEach((graphNode) => {
        const node = graphNode.data;
        const group = createSvgElement('g', { class: 'knowledge-node-group', tabindex: '0', role: 'button' });
        const circle = createSvgElement('circle', { r: 14, class: `knowledge-node ${phaseClassByYear(node.year)}` });
        const label = createSvgElement('text', { x: 18, y: -2, class: 'knowledge-node-label' });
        label.textContent = shorten(node.title, 28);
        const year = createSvgElement('text', { x: 18, y: 11, class: 'knowledge-node-year' });
        year.textContent = String(node.year);
        const title = createSvgElement('title');
        title.textContent = `${node.title}\n点击选中，双击移出知识库`;
        circle.appendChild(title);
        group.append(circle, label, year);
        group.addEventListener('click', () => setAppState({ selectedPaperId: node.id, year: node.year, yearRangeStart: node.year, yearRangeEnd: node.year }, 'paper-force'));
        group.addEventListener('dblclick', () => removeKnowledgePaper(node.id));
        knowledgeSvg.appendChild(group);
        graphNode.el = group;
      });

      recommendList.innerHTML = recommendations.map((node, index) => {
        const score = scoreRecommendation(node, knowledgeNodes).toFixed(1);
        return `<button class="knowledge-recommend-row" type="button" data-id="${node.id}"><span>${index + 1}</span><strong>${shorten(node.title, 58)}</strong><em>${node.year} · score ${score}</em></button>`;
      }).join('');
      recommendList.querySelectorAll('.knowledge-recommend-row').forEach((row) => {
        row.addEventListener('click', () => addKnowledgePaper(row.getAttribute('data-id')));
      });
      renderKnowledgePositions();
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
            lastY: event.clientY,
            moved: false
          };
          node.fixed = true;
          group.setPointerCapture(event.pointerId);
        });
        group.addEventListener('click', () => {
          if (node.suppressClick) {
            node.suppressClick = false;
            return;
          }
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
      applyForceLayout(visibleNodes, visibleLinks, {
        centerX,
        centerY,
        repulsion,
        springLength,
        bounds: { left: 20, right: width - 20, top: 20, bottom: height - 20 }
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

    function tickKnowledgeBase() {
      if (!knowledgeSimNodes.length) return;
      applyForceLayout(knowledgeSimNodes, knowledgeSimLinks, {
        centerX: 260,
        centerY: 160,
        repulsion: 620,
        springLength: 92,
        springStrength: 0.006,
        centerStrength: 0.0022,
        damping: 0.82,
        bounds: { left: 26, right: 494, top: 26, bottom: 294 }
      });
    }

    function renderKnowledgePositions() {
      knowledgeSimLinks.forEach((link) => {
        if (!link.el) return;
        link.el.setAttribute('x1', link.sourceNode.x);
        link.el.setAttribute('y1', link.sourceNode.y);
        link.el.setAttribute('x2', link.targetNode.x);
        link.el.setAttribute('y2', link.targetNode.y);
      });
      knowledgeSimNodes.forEach((node) => {
        if (!node.el) return;
        node.el.setAttribute('transform', `translate(${node.x} ${node.y})`);
      });
    }

    function animate() {
      tick();
      renderPositions();
      tickKnowledgeBase();
      renderKnowledgePositions();
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
        if (Math.abs(event.clientX - draggingNode.lastX) + Math.abs(event.clientY - draggingNode.lastY) > 2) {
          draggingNode.moved = true;
        }
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
    svg.addEventListener('pointerup', (event) => {
      if (draggingNode) {
        draggingNode.node.fixed = false;
        if (draggingNode.moved && isPointerInsideKnowledgeBox(event)) {
          addKnowledgePaper(draggingNode.node.id);
          draggingNode.node.suppressClick = true;
        }
      }
      draggingNode = null;
      panning = null;
    });
    svg.addEventListener('pointerleave', () => {
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
    knowledgeAddButton.addEventListener('click', () => {
      const node = findPaper(knowledgeSearch.value);
      if (!node) return;
      addKnowledgePaper(node.id);
      knowledgeSearch.value = '';
    });
    knowledgeSearch.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const node = findPaper(knowledgeSearch.value);
      if (!node) return;
      addKnowledgePaper(node.id);
      knowledgeSearch.value = '';
    });
    knowledgeClearButton.addEventListener('click', () => {
      knowledgeIds = new Set();
      knowledgeGraphById = new Map();
      knowledgeSimNodes = [];
      knowledgeSimLinks = [];
      renderKnowledgeBase();
    });
    onAppStateChange(({ state, source }) => {
      if (source === 'paper-force') {
        updateDetail();
        renderKnowledgeBase();
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
      renderKnowledgeBase();
    });

    resetView();
    renderGraph();
    renderKnowledgeBase();
    animate();
  } catch (error) {
    statEl.textContent = '数据加载失败，请检查 nodes.json 与 edges.json';
    svg.innerHTML = '';
  }
}
