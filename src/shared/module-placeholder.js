export function renderModulePlaceholder(container, config) {
  if (!container) {
    return;
  }

  const { title, subtitle, notes, legend, sectionTag } = config;
  const notesList = Array.isArray(notes) ? notes : [];
  const legendList = Array.isArray(legend) ? legend : [];

  const notesHtml = notesList
    .map((item) => `<li>${item}</li>`)
    .join('');

  const legendHtml = legendList
    .map((item) => `<span class="legend-chip">${item}</span>`)
    .join('');

  const legendBlock = legendHtml
    ? `<div class="legend-row">${legendHtml}</div>`
    : '';

  const notesBlock = notesHtml
    ? `<ul class="module-notes">${notesHtml}</ul>`
    : '';

  container.innerHTML = `
    <div class="module-shell">
      <p class="module-tag">${sectionTag}</p>
      <h3 class="module-title">${title}</h3>
      <p class="module-subtitle">${subtitle}</p>
      <div class="module-canvas" aria-hidden="true">可视化画布区域（占位）</div>
      ${legendBlock}
      ${notesBlock}
    </div>
  `;
}
