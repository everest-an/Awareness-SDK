/**
 * Pure state machine for the side panel (F-109).
 *
 * Kept DOM-free so the four user-visible states — idle / loading / ready /
 * empty / error / unauthorized — are unit-testable without a browser.
 */

export const TABS = ['search', 'cards', 'timeline'];

export function initialState() {
  return {
    tab: 'cards',
    status: 'idle',
    items: [],
    error: '',
    query: '',
    selected: null,
  };
}

export function reduce(state, action) {
  switch (action?.type) {
    case 'SET_TAB':
      if (!TABS.includes(action.tab)) return state;
      return { ...state, tab: action.tab, selected: null, error: '', status: state.items.length ? state.status : 'idle' };
    case 'LOAD_START':
      return { ...state, status: 'loading', error: '', selected: null };
    case 'LOAD_OK': {
      const items = Array.isArray(action.items) ? action.items : [];
      return { ...state, status: items.length ? 'ready' : 'empty', items, error: '' };
    }
    case 'LOAD_ERR':
      return { ...state, status: 'error', error: action.error || 'unknown', items: [] };
    case 'UNAUTHORIZED':
      return { ...state, status: 'unauthorized', error: '', items: [] };
    case 'SELECT':
      return { ...state, selected: action.item || null };
    case 'CLEAR_SELECT':
      return { ...state, selected: null };
    case 'RESET':
      return { ...initialState(), tab: state.tab };
    default:
      return state;
  }
}

/** Human-readable empty/error copy, kept out of the renderer for testability. */
export function messageFor(state) {
  switch (state.status) {
    case 'idle': return '在下方搜索，或切换到「卡片 / 时间线」。';
    case 'loading': return '加载中…';
    case 'empty': return state.tab === 'search' ? '没有找到相关记忆。' : '这个记忆库还是空的。';
    case 'unauthorized': return '先连接 Awareness，侧边栏才能读取云端记忆。';
    case 'error': return `加载失败：${state.error}`;
    default: return '';
  }
}
