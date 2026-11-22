// タスク・ルーティン・カテゴリ・設定のデータモデルとビジネスロジック

import { toDateStr, addDays, getNextOccurrenceDate, parseDateStr } from './dates.js';

export const PRIORITY_ORDER = {
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

export const PRIORITY_LABELS = {
  none: 'なし',
  low: '低',
  medium: '中',
  high: '高',
};

export const ACCENT_PRESETS = [
  { id: 'blue', name: 'オーシャン', color: '#2563eb', soft: 'rgba(37, 99, 235, 0.14)' },
  { id: 'indigo', name: 'インディゴ', color: '#4f46e5', soft: 'rgba(79, 70, 229, 0.14)' },
  { id: 'emerald', name: 'エメラルド', color: '#059669', soft: 'rgba(5, 150, 105, 0.14)' },
  { id: 'coral', name: 'コーラル', color: '#e11d48', soft: 'rgba(225, 29, 72, 0.14)' },
  { id: 'violet', name: 'バイオレット', color: '#7c3aed', soft: 'rgba(124, 58, 237, 0.14)' },
];

export const CATEGORY_COLORS = [
  '#2563eb',
  '#059669',
  '#d97706',
  '#e11d48',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#64748b',
];

export const DEFAULT_CATEGORIES = [
  { id: 'cat-personal', name: '個人', color: '#2563eb' },
  { id: 'cat-life', name: '生活', color: '#059669' },
  { id: 'cat-work', name: '仕事', color: '#7c3aed' },
  { id: 'cat-shopping', name: '買い物', color: '#d97706' },
  { id: 'cat-study', name: '学習', color: '#0891b2' },
];

export const DEFAULT_SETTINGS = {
  theme: 'system', // 'system' | 'light' | 'dark'
  accent: 'blue',
};

export function createId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 繰り返しタスクかどうかを判定
 */
export function isRecurring(task) {
  return Boolean(task && task.recurrence && task.recurrence.type && task.recurrence.type !== 'none');
}

/**
 * 新しいタスクオブジェクトを生成
 */
export function createTask(input = {}, nowIso = new Date().toISOString()) {
  const title = (input.title || '').trim();
  const recurrence = normalizeRecurrence(input.recurrence, input.dueDate);
  let dueDate = input.dueDate || null;

  // 繰り返しタスクに期限が未設定の場合は今日を初期期限にする
  if (recurrence.type !== 'none' && !dueDate) {
    dueDate = toDateStr();
  }

  const subtasks = Array.isArray(input.subtasks)
    ? input.subtasks
        .filter((s) => s && typeof s.title === 'string' && s.title.trim() !== '')
        .map((s) => ({
          id: s.id || createId('sub'),
          title: s.title.trim(),
          completed: Boolean(s.completed),
        }))
    : [];

  return {
    id: input.id || createId('task'),
    title,
    notes: typeof input.notes === 'string' ? input.notes : '',
    completed: Boolean(input.completed),
    completedAt: input.completedAt || null,
    dueDate,
    priority: ['none', 'low', 'medium', 'high'].includes(input.priority) ? input.priority : 'none',
    categoryId: input.categoryId || null,
    recurrence,
    streak: Number.isFinite(input.streak) ? input.streak : 0,
    lastCompletedDate: input.lastCompletedDate || null,
    lastCompletionSnapshot: input.lastCompletionSnapshot || null,
    subtasks,
    createdAt: input.createdAt || nowIso,
    updatedAt: nowIso,
  };
}

/**
 * 繰り返し設定の正規化
 */
export function normalizeRecurrence(rec, dueDate = null) {
  if (!rec || !rec.type || rec.type === 'none') {
    return { type: 'none' };
  }
  if (rec.type === 'weekly') {
    const fallbackDow = dueDate && parseDateStr(dueDate) ? parseDateStr(dueDate).getDay() : new Date().getDay();
    const days = Array.isArray(rec.daysOfWeek) && rec.daysOfWeek.length > 0
      ? [...new Set(rec.daysOfWeek.map(Number).filter((n) => n >= 0 && n <= 6))].sort((a, b) => a - b)
      : [fallbackDow];
    return { type: 'weekly', daysOfWeek: days };
  }
  if (rec.type === 'monthly') {
    const fallbackDay = dueDate && parseDateStr(dueDate) ? parseDateStr(dueDate).getDate() : new Date().getDate();
    const day = Number(rec.dayOfMonth) >= 1 && Number(rec.dayOfMonth) <= 31 ? Number(rec.dayOfMonth) : fallbackDay;
    return { type: 'monthly', dayOfMonth: day };
  }
  if (rec.type === 'daily' || rec.type === 'weekdays') {
    return { type: rec.type };
  }
  return { type: 'none' };
}

/**
 * タスクの完了状態をトグルする（繰り返しタスクは次回予定日へ自動更新＋巻き戻し対応）
 * @returns {{ task: object, action: 'completed' | 'uncompleted' | 'routine-completed' | 'routine-uncompleted' }}
 */
export function toggleTaskCompletion(task, todayStr = toDateStr(), nowIso = new Date().toISOString()) {
  if (isRecurring(task)) {
    // 今日すでに完了済みのルーティンをチェック解除 -> 直前の状態へ完璧に巻き戻す
    if (task.lastCompletedDate === todayStr && task.lastCompletionSnapshot) {
      const snap = task.lastCompletionSnapshot;
      return {
        action: 'routine-uncompleted',
        task: {
          ...task,
          dueDate: snap.dueDate,
          streak: snap.streak,
          lastCompletedDate: snap.lastCompletedDate,
          subtasks: snap.subtasks.map((s) => ({ ...s })),
          lastCompletionSnapshot: null,
          updatedAt: nowIso,
        },
      };
    }

    // ルーティンを今日完了 -> 次回予定日を算出し、連続記録を更新、サブタスクを次回用にリセット
    const snapshot = {
      dueDate: task.dueDate,
      streak: task.streak || 0,
      lastCompletedDate: task.lastCompletedDate || null,
      subtasks: (task.subtasks || []).map((s) => ({ ...s })),
    };

    const nextDueDate = getNextOccurrenceDate(task.dueDate, task.recurrence, todayStr);
    const nextStreak = (task.streak || 0) + 1;

    return {
      action: 'routine-completed',
      task: {
        ...task,
        completed: false,
        dueDate: nextDueDate,
        streak: nextStreak,
        lastCompletedDate: todayStr,
        lastCompletionSnapshot: snapshot,
        subtasks: (task.subtasks || []).map((s) => ({ ...s, completed: false })),
        updatedAt: nowIso,
      },
    };
  }

  // 通常タスクの完了 / 未完了トグル
  const nextCompleted = !task.completed;
  return {
    action: nextCompleted ? 'completed' : 'uncompleted',
    task: {
      ...task,
      completed: nextCompleted,
      completedAt: nextCompleted ? nowIso : null,
      lastCompletedDate: nextCompleted ? todayStr : null,
      updatedAt: nowIso,
    },
  };
}

/**
 * サブタスクの完了トグル
 */
export function toggleSubtask(task, subtaskId, nowIso = new Date().toISOString()) {
  return {
    ...task,
    subtasks: (task.subtasks || []).map((s) =>
      s.id === subtaskId ? { ...s, completed: !s.completed } : s
    ),
    updatedAt: nowIso,
  };
}

/**
 * 期限切れの未完了タスクをすべて今日の日付にリスケする
 */
export function rescheduleOverdueToToday(tasks, todayStr = toDateStr(), nowIso = new Date().toISOString()) {
  let count = 0;
  const updated = tasks.map((task) => {
    if (!task.completed && task.dueDate && task.dueDate < todayStr) {
      count++;
      return { ...task, dueDate: todayStr, updatedAt: nowIso };
    }
    return task;
  });
  return { tasks: updated, count };
}

/**
 * タスク並び替え用の比較関数
 */
export function sortTasks(tasks, sortBy = 'due') {
  return [...tasks].sort((a, b) => {
    if (sortBy === 'priority') {
      const pDiff = (PRIORITY_ORDER[b.priority] || 0) - (PRIORITY_ORDER[a.priority] || 0);
      if (pDiff !== 0) return pDiff;
      return compareDueDates(a.dueDate, b.dueDate);
    }
    if (sortBy === 'created') {
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    }
    // デフォルト: 期限順 -> 優先度高順 -> 作成順
    const dDiff = compareDueDates(a.dueDate, b.dueDate);
    if (dDiff !== 0) return dDiff;
    const pDiff = (PRIORITY_ORDER[b.priority] || 0) - (PRIORITY_ORDER[a.priority] || 0);
    if (pDiff !== 0) return pDiff;
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });
}

function compareDueDates(a, b) {
  if (a && b) return a.localeCompare(b);
  if (a && !b) return -1;
  if (!a && b) return 1;
  return 0;
}

/**
 * 「今日」ビュー用にタスクを分類して返す
 */
export function getTodayBuckets(tasks, todayStr = toDateStr()) {
  const overdue = [];
  const todayRoutines = [];
  const todayTasks = [];
  const completedToday = [];

  for (const task of tasks) {
    if (isRecurring(task)) {
      if (task.lastCompletedDate === todayStr) {
        completedToday.push(task);
      } else if (task.dueDate && task.dueDate < todayStr) {
        overdue.push(task);
      } else if (task.dueDate === todayStr) {
        todayRoutines.push(task);
      }
    } else {
      if (task.completed) {
        if (task.lastCompletedDate === todayStr || (task.completedAt && task.completedAt.startsWith(todayStr))) {
          completedToday.push(task);
        }
      } else if (task.dueDate && task.dueDate < todayStr) {
        overdue.push(task);
      } else if (task.dueDate === todayStr) {
        todayTasks.push(task);
      }
    }
  }

  const remainingCount = overdue.length + todayRoutines.length + todayTasks.length;
  const doneCount = completedToday.length;
  const totalCount = remainingCount + doneCount;

  return {
    overdue: sortTasks(overdue, 'due'),
    todayRoutines: sortTasks(todayRoutines, 'priority'),
    todayTasks: sortTasks(todayTasks, 'priority'),
    completedToday: completedToday.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')),
    stats: {
      remainingCount,
      doneCount,
      totalCount,
      progress: totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100),
    },
  };
}

/**
 * 「予定」ビュー用にタスクを期間別グループ分けする
 */
export function getUpcomingBuckets(tasks, todayStr = toDateStr()) {
  const tomorrowStr = addDays(todayStr, 1);
  const weekEndStr = addDays(todayStr, 7);

  const overdue = [];
  const today = [];
  const tomorrow = [];
  const thisWeek = [];
  const later = [];
  const noDate = [];

  for (const task of tasks) {
    if (task.completed) continue;
    if (!task.dueDate) {
      noDate.push(task);
    } else if (task.dueDate < todayStr) {
      overdue.push(task);
    } else if (task.dueDate === todayStr) {
      today.push(task);
    } else if (task.dueDate === tomorrowStr) {
      tomorrow.push(task);
    } else if (task.dueDate <= weekEndStr) {
      thisWeek.push(task);
    } else {
      later.push(task);
    }
  }

  return {
    overdue: sortTasks(overdue, 'due'),
    today: sortTasks(today, 'priority'),
    tomorrow: sortTasks(tomorrow, 'priority'),
    thisWeek: sortTasks(thisWeek, 'due'),
    later: sortTasks(later, 'due'),
    noDate: sortTasks(noDate, 'priority'),
  };
}

/**
 * 「すべて」ビューの検索・フィルタ・ソート
 */
export function filterAllTasks(tasks, filters = {}) {
  const query = (filters.query || '').trim().toLowerCase();
  const categoryId = filters.categoryId || 'all';
  const priority = filters.priority || 'all';
  const showCompleted = Boolean(filters.showCompleted);
  const sortBy = filters.sortBy || 'due';

  const filtered = tasks.filter((task) => {
    if (!showCompleted && task.completed) return false;
    if (categoryId !== 'all') {
      if (categoryId === 'uncategorized') {
        if (task.categoryId) return false;
      } else if (task.categoryId !== categoryId) {
        return false;
      }
    }
    if (priority !== 'all' && task.priority !== priority) return false;
    if (query) {
      const inTitle = task.title.toLowerCase().includes(query);
      const inNotes = (task.notes || '').toLowerCase().includes(query);
      const inSubtasks = (task.subtasks || []).some((s) => s.title.toLowerCase().includes(query));
      if (!inTitle && !inNotes && !inSubtasks) return false;
    }
    return true;
  });

  // 未完了を上に、完了済みを下に
  const active = sortTasks(filtered.filter((t) => !t.completed), sortBy);
  const done = filtered
    .filter((t) => t.completed)
    .sort((a, b) => (b.completedAt || b.updatedAt || '').localeCompare(a.completedAt || a.updatedAt || ''));

  return [...active, ...done];
}
