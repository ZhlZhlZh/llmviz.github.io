import { renderModulePlaceholder } from '../../shared/module-placeholder.js';

export function initPaperForce(container) {
  renderModulePlaceholder(container, {
    sectionTag: 'Module 02',
    title: '论文力导向图',
    subtitle: '展示论文节点、引文边与结构中心性。',
    legend: ['论文节点', '引文连线', '中心性编码'],
    notes: [
      '后续接入 nodes/edges 并配置 force simulation。',
      '与河流图共享年份筛选条件。'
    ]
  });
}
