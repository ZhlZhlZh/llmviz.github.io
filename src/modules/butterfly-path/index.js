import { renderModulePlaceholder } from '../../shared/module-placeholder.js';

export function initButterflyPath(container) {
  renderModulePlaceholder(container, {
    sectionTag: 'Module 03',
    title: '蝴蝶脉冲路径图',
    subtitle: '从早期论文出发，展示影响传播路径与关键变异节点。',
    legend: ['起点论文', '脉冲路径', '贡献值卡片'],
    notes: [
      '后续接入最短路径预计算结果。',
      '点击节点后在侧栏展示 contribution score。'
    ]
  });
}
