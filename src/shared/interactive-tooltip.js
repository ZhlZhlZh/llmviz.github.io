export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function paperLink(node) {
  if (!node) return '';
  if (node.link) return node.link;
  if (node.url) return node.url;
  if (node.doi) return `https://doi.org/${encodeURIComponent(node.doi)}`;
  if (node.openalex_id) return String(node.openalex_id).replace(/^https?:\/\/openalex\.org\//, 'https://openalex.org/');
  if (node.id) return `https://www.semanticscholar.org/paper/${encodeURIComponent(node.id)}`;
  return '';
}

export function institutionLink(item) {
  if (!item) return '';
  if (item.link) return item.link;
  if (item.url) return item.url;
  const query = [item.institution, item.city, item.country].filter(Boolean).join(' ');
  return query ? `https://www.google.com/search?q=${encodeURIComponent(query)}` : '';
}

export function createInteractiveTooltip(container) {
  const tooltip = document.createElement('div');
  tooltip.className = 'chart-node-tooltip';
  tooltip.hidden = true;
  container.appendChild(tooltip);

  let hideTimer = null;

  function clearHideTimer() {
    if (hideTimer) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function place(event) {
    const rect = container.getBoundingClientRect();
    const width = tooltip.offsetWidth || 240;
    const height = tooltip.offsetHeight || 120;
    const left = Math.min(Math.max(event.clientX - rect.left + 14, 8), Math.max(8, rect.width - width - 8));
    const top = Math.min(Math.max(event.clientY - rect.top + 12, 8), Math.max(8, rect.height - height - 8));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  tooltip.addEventListener('mouseenter', clearHideTimer);
  tooltip.addEventListener('mouseleave', () => {
    tooltip.hidden = true;
  });

  return {
    show(event, html) {
      clearHideTimer();
      tooltip.innerHTML = html;
      tooltip.hidden = false;
      place(event);
    },
    move(event) {
      if (!tooltip.hidden) place(event);
    },
    hideSoon() {
      clearHideTimer();
      hideTimer = window.setTimeout(() => {
        tooltip.hidden = true;
      }, 180);
    },
    hideNow() {
      clearHideTimer();
      tooltip.hidden = true;
    }
  };
}
