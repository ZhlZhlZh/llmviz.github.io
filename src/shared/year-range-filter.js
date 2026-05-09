import { getAppState, onAppStateChange, setAppState } from './app-state.js';

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Shared dual-thumb year-range filter.
 *
 * Renders a compact labeled slider with a start/end handle, keeps start <= end,
 * publishes `{ yearRangeStart, yearRangeEnd, year: end }` to the global app
 * state under the caller's `source`, and listens for external changes so all
 * charts stay in sync.
 *
 * Returns the DOM element to mount and helpers:
 *   - getRange() -> { start, end }
 *   - setRange(start, end, { publish }) -> void
 *   - destroy() -> void
 *
 * The consumer should read `onChange({ start, end })` and re-render its chart.
 */
export function createYearRangeFilter(options = {}) {
  const {
    source,
    label = '年份',
    onChange,
    syncToGlobal = true
  } = options;

  const min = Number(options.min);
  const max = Number(options.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    throw new Error('createYearRangeFilter requires finite min <= max');
  }
  if (!source) {
    throw new Error('createYearRangeFilter requires a source string');
  }

  const appState = getAppState();
  const initialStartRaw = Number.isFinite(options.initialStart)
    ? options.initialStart
    : Number.isFinite(appState.yearRangeStart) ? appState.yearRangeStart : min;
  const initialEndRaw = Number.isFinite(options.initialEnd)
    ? options.initialEnd
    : Number.isFinite(appState.yearRangeEnd) ? appState.yearRangeEnd : max;

  let start = clamp(initialStartRaw, min, max);
  let end = clamp(initialEndRaw, min, max);
  if (start > end) [start, end] = [end, start];

  const root = document.createElement('div');
  root.className = 'year-range-filter chart-control';
  root.innerHTML = `
    <span class="year-range-filter__title">${label}</span>
    <div class="year-range-filter__slider">
      <div class="year-range-filter__track"></div>
      <div class="year-range-filter__fill"></div>
      <input type="range" class="year-range-filter__input year-range-filter__input--start" min="${min}" max="${max}" step="1" value="${start}" aria-label="起始年份" />
      <input type="range" class="year-range-filter__input year-range-filter__input--end" min="${min}" max="${max}" step="1" value="${end}" aria-label="结束年份" />
    </div>
    <output class="year-range-filter__badge year-badge"></output>
  `;

  const startEl = root.querySelector('.year-range-filter__input--start');
  const endEl = root.querySelector('.year-range-filter__input--end');
  const fillEl = root.querySelector('.year-range-filter__fill');
  const badgeEl = root.querySelector('.year-range-filter__badge');

  function updateVisuals() {
    const span = Math.max(max - min, 1);
    const leftPct = ((start - min) / span) * 100;
    const widthPct = Math.max(0, ((end - start) / span) * 100);
    fillEl.style.left = `${leftPct}%`;
    fillEl.style.width = `${widthPct}%`;
    badgeEl.textContent = start === end ? String(start) : `${start}—${end}`;
    if (startEl.value !== String(start)) startEl.value = String(start);
    if (endEl.value !== String(end)) endEl.value = String(end);
  }

  function emitChange(fromUser) {
    if (syncToGlobal && fromUser) {
      setAppState({
        yearRangeStart: start,
        yearRangeEnd: end,
        year: end
      }, source);
    }
    if (typeof onChange === 'function') {
      onChange({ start, end, source: fromUser ? source : 'external' });
    }
  }

  startEl.addEventListener('input', () => {
    let v = Number(startEl.value);
    if (!Number.isFinite(v)) return;
    if (v > end) v = end;
    start = clamp(v, min, max);
    updateVisuals();
    emitChange(true);
  });

  endEl.addEventListener('input', () => {
    let v = Number(endEl.value);
    if (!Number.isFinite(v)) return;
    if (v < start) v = start;
    end = clamp(v, min, max);
    updateVisuals();
    emitChange(true);
  });

  const off = onAppStateChange(({ state, source: src }) => {
    if (src === source) return;
    const rawStart = Number.isFinite(state.yearRangeStart) ? state.yearRangeStart : state.year;
    const rawEnd = Number.isFinite(state.yearRangeEnd) ? state.yearRangeEnd : state.year;
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return;
    const nextStart = clamp(Math.min(rawStart, rawEnd), min, max);
    const nextEnd = clamp(Math.max(rawStart, rawEnd), min, max);
    if (nextStart === start && nextEnd === end) return;
    start = nextStart;
    end = nextEnd;
    updateVisuals();
    emitChange(false);
  });

  updateVisuals();

  return {
    element: root,
    getRange() {
      return { start, end };
    },
    setRange(newStart, newEnd, { publish = false } = {}) {
      const s = clamp(Number(newStart), min, max);
      const e = clamp(Number(newEnd), min, max);
      const nextStart = Math.min(s, e);
      const nextEnd = Math.max(s, e);
      if (nextStart === start && nextEnd === end) {
        if (publish) emitChange(true);
        return;
      }
      start = nextStart;
      end = nextEnd;
      updateVisuals();
      emitChange(publish);
    },
    destroy: off
  };
}
