import { renderModulePlaceholder } from '../../shared/module-placeholder.js';

export function initInstitutionMap(container) {
  renderModulePlaceholder(container, {
    sectionTag: 'Module 04',
    title: '机构影响力世界地图',
    subtitle: '在世界底图上对比机构影响力、社区属性与合作结构。',
    legend: ['点大小=影响力', '点颜色=社区类型', '点形状=机构类型'],
    notes: [
      '后续接入 geocoded institution 数据。',
      '支持高校/企业、中英文社区维度切换。'
    ]
  });
}
