const DEFAULT_STATE = {
  year: 2026,
  yearRangeStart: 2013,
  yearRangeEnd: 2026,
  selectedPaperId: null,
  selectedInstitutionId: null,
  selectedTheme: null
};

const state = { ...DEFAULT_STATE };
const events = new EventTarget();

export function getAppState() {
  return { ...state };
}

export function setAppState(patch, source = 'app') {
  const next = { ...state, ...patch };
  const changed = Object.keys(next).some((key) => next[key] !== state[key]);

  if (!changed) {
    return getAppState();
  }

  const previous = { ...state };
  Object.assign(state, next);

  events.dispatchEvent(
    new CustomEvent('change', {
      detail: {
        state: getAppState(),
        previous,
        patch,
        source
      }
    })
  );

  return getAppState();
}

export function onAppStateChange(handler) {
  const listener = (event) => handler(event.detail);
  events.addEventListener('change', listener);
  return () => events.removeEventListener('change', listener);
}

export function phaseLabelByYear(year) {
  if (year <= 2017) {
    return '表示与序列建模';
  }
  if (year <= 2022) {
    return '预训练爆发';
  }
  return '对齐与智能体';
}
