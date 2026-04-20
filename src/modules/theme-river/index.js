import { renderModulePlaceholder } from '../../shared/module-placeholder.js';

export function initThemeRiver(container) {
  renderModulePlaceholder(container, {
    sectionTag: 'Module 01',
    title: '主题河流图',
    subtitle: '展示核心关键词在 2013-2026 的热度演化与阶段峰值。',
    legend: ['关键词流层', '年度高亮', '阶段注释'],
    notes: [
      '后续接入按年聚合的 keyword trends 数据。',
      '与全局时间轴联动，支持 brushing。'
    ]
  });
}
