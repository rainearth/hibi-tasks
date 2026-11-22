// 端末内（localStorage）へのデータ永続化・バックアップ入出力・初期サンプルデータ

import { toDateStr, addDays } from './dates.js';
import { createTask, DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from './model.js';

const STORAGE_KEY = 'hibi_tasks_state_v1';

/**
 * 初回起動時に入れる日本語のサンプルタスク
 */
export function buildSampleData(todayStr = toDateStr()) {
  const tomorrowStr = addDays(todayStr, 1);
  const in3DaysStr = addDays(todayStr, 3);

  const tasks = [
    createTask({
      id: 'sample-routine-1',
      title: '朝のストレッチ＆白湯を飲む',
      notes: '肩まわりと背筋を5分ほぐす。終わったらチェック！',
      dueDate: todayStr,
      priority: 'medium',
      categoryId: 'cat-life',
      recurrence: { type: 'daily' },
      streak: 3,
      subtasks: [
        { id: 'sub-1', title: 'コップ1杯の白湯を飲む', completed: true },
        { id: 'sub-2', title: '首と肩のストレッチ（5分）', completed: false },
      ],
    }),
    createTask({
      id: 'sample-routine-2',
      title: '燃えるゴミを出す',
      notes: '朝8:30までに集積所へ。前日の夜にまとめておくとラク。',
      dueDate: todayStr,
      priority: 'high',
      categoryId: 'cat-life',
      recurrence: { type: 'weekly', daysOfWeek: [1, 4] },
      streak: 2,
    }),
    createTask({
      id: 'sample-task-1',
      title: 'スーパーで買い出し',
      notes: 'エコバッグを忘れずに持っていく',
      dueDate: todayStr,
      priority: 'medium',
      categoryId: 'cat-shopping',
      subtasks: [
        { id: 'sub-3', title: '牛乳・卵', completed: false },
        { id: 'sub-4', title: '鶏むね肉', completed: false },
        { id: 'sub-5', title: 'ミニトマト・レタス', completed: false },
      ],
    }),
    createTask({
      id: 'sample-task-2',
      title: 'HibiをiPhoneのホーム画面に追加する',
      notes: 'Safari下の共有ボタン（□↑）→「ホーム画面に追加」を押すと、アプリのようにフルスクリーン＆オフラインで使えます。設定画面（右上の歯車）からいつでもバックアップできます。',
      dueDate: todayStr,
      priority: 'low',
      categoryId: 'cat-personal',
    }),
    createTask({
      id: 'sample-task-3',
      title: '英語リスニング 15分',
      notes: '通勤・移動中にポッドキャストを1エピソード聴く',
      dueDate: tomorrowStr,
      priority: 'medium',
      categoryId: 'cat-study',
      recurrence: { type: 'weekdays' },
      streak: 5,
    }),
    createTask({
      id: 'sample-task-4',
      title: '美容院を予約する',
      notes: '今週末の午前中で空きを確認',
      dueDate: in3DaysStr,
      priority: 'low',
      categoryId: 'cat-personal',
    }),
  ];

  return {
    version: 1,
    tasks,
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    settings: { ...DEFAULT_SETTINGS },
  };
}

/**
 * 端末内ストレージから状態を読み込む
 */
export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial = buildSampleData();
      saveState(initial);
      return initial;
    }
    const parsed = JSON.parse(raw);
    return sanitizeState(parsed);
  } catch {
    return buildSampleData();
  }
}

/**
 * 端末内ストレージに状態を保存する
 */
export function saveState(state) {
  try {
    const payload = {
      version: 1,
      tasks: state.tasks || [],
      categories: state.categories || DEFAULT_CATEGORIES,
      settings: { ...DEFAULT_SETTINGS, ...(state.settings || {}) },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/**
 * 読み込み / インポート時のデータ検証と正規化
 */
export function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('バックアップデータの形式が正しくありません。');
  }
  const categories = Array.isArray(raw.categories) && raw.categories.length > 0
    ? raw.categories
        .filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string' && c.name.trim() !== '')
        .map((c) => ({
          id: c.id,
          name: c.name.trim(),
          color: typeof c.color === 'string' ? c.color : '#2563eb',
        }))
    : DEFAULT_CATEGORIES.map((c) => ({ ...c }));

  const tasks = Array.isArray(raw.tasks)
    ? raw.tasks
        .filter((t) => t && typeof t.title === 'string' && t.title.trim() !== '')
        .map((t) => createTask(t, t.updatedAt || t.createdAt || new Date().toISOString()))
    : [];

  const settings = {
    ...DEFAULT_SETTINGS,
    ...(raw.settings && typeof raw.settings === 'object' ? raw.settings : {}),
  };

  return {
    version: 1,
    tasks,
    categories,
    settings,
  };
}

/**
 * JSONファイルとしてバックアップを書き出す
 */
export function exportStateAsJson(state) {
  const payload = {
    app: 'Hibi',
    exportedAt: new Date().toISOString(),
    version: 1,
    tasks: state.tasks,
    categories: state.categories,
    settings: state.settings,
  };
  return JSON.stringify(payload, null, 2);
}
