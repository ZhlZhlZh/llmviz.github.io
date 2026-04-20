import { renderModulePlaceholder } from '../../shared/module-placeholder.js';

export function initAiHistoryPlaceholder(container) {
  renderModulePlaceholder(container, {
    sectionTag: 'Module 05',
    title: 'AI 简史生成器',
    subtitle: '当前阶段保留占位，后续生成探索路径叙事文本。',
    legend: ['探索记录', '叙事模板', '分享卡片'],
    notes: [
      '当前不开发核心功能，仅提供展示区域。',
      '待前四个模块完成后再接入。'
    ]
  });
}
