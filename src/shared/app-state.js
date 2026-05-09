const DEFAULT_STATE = {
  year: 2023,
  yearRangeStart: 1993,
  yearRangeEnd: 2023,
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
  if (year <= 2005) {
    return '经典AI与符号方法';
  }
  if (year <= 2015) {
    return '统计学习与深度学习兴起';
  }
  return '大模型与通用智能';
}
