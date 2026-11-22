// Hibi - iPhone向け個人用タスク＆ルーティン管理アプリ メインコントローラ

import {
  toDateStr,
  addDays,
  getNextWeekendStr,
  getNextMondayStr,
  formatDueDateLabel,
  formatHeaderDate,
  formatRecurrenceLabel,
  WEEKDAY_JA,
} from './dates.js';
import {
  ACCENT_PRESETS,
  CATEGORY_COLORS,
  PRIORITY_LABELS,
  createId,
  createTask,
  isRecurring,
  toggleTaskCompletion,
  toggleSubtask,
  rescheduleOverdueToToday,
  getTodayBuckets,
  getUpcomingBuckets,
  filterAllTasks,
} from './model.js';
import {
  loadState,
  saveState,
  sanitizeState,
  exportStateAsJson,
  buildSampleData,
} from './storage.js';
import { icons } from './icons.js';

// HTMLエスケープ（XSS防止）
function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// メモ内の最初のURLを抽出（安全な http/https のみ）
function extractUrls(text) {
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s<>"']+/g);
  return matches ? [...new Set(matches)].slice(0, 3) : [];
}

// アプリ状態
let state = loadState();
let todayStr = toDateStr();

const ui = {
  activeTab: 'today', // 'today' | 'upcoming' | 'routines' | 'all'
  completedCollapsed: false,
  routineFilter: 'all', // 'all' | 'daily' | 'weekdays' | 'weekly' | 'monthly'
  allFilters: {
    query: '',
    categoryId: 'all',
    priority: 'all',
    showCompleted: false,
    sortBy: 'due',
  },
  modal: null, // null | { type: 'task', mode: 'create'|'edit', draft: object } | { type: 'settings' }
  toast: null, // { message: string, undoSnapshot?: object }
  toastTimer: null,
  newCatName: '',
  newCatColor: CATEGORY_COLORS[0],
  expandedTaskIds: new Set(),
};

const appRoot = document.getElementById('app');

// テーマ・アクセントカラーの適用
function isEffectiveDark() {
  const { theme } = state.settings;
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function applyThemeAndAccent() {
  const { theme, accent } = state.settings;
  const root = document.documentElement;
  const dark = isEffectiveDark();

  if (theme === 'dark' || theme === 'light') {
    root.dataset.theme = theme;
  } else {
    delete root.dataset.theme;
  }

  const preset = ACCENT_PRESETS.find((p) => p.id === accent) || ACCENT_PRESETS[0];
  root.style.setProperty('--accent', dark ? preset.color : preset.lightColor);
  root.style.setProperty('--on-accent', dark ? preset.onColor : preset.lightOnColor);
  root.style.setProperty('--accent-soft', dark ? preset.soft : preset.lightSoft);

  // iOS Safariのステータスバー/テーマカラーを同期
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', dark ? '#09090b' : '#fafaf9');
  }
}

function persistAndRender() {
  saveState(state);
  applyThemeAndAccent();
  render();
}

function showToast(message, undoSnapshot = null) {
  if (ui.toastTimer) clearTimeout(ui.toastTimer);
  ui.toast = { message, undoSnapshot };
  renderToast();
  ui.toastTimer = setTimeout(() => {
    ui.toast = null;
    renderToast();
  }, 4200);
}

function cloneStateSnapshot() {
  return JSON.parse(JSON.stringify({ tasks: state.tasks, categories: state.categories }));
}

function getCategoryById(id) {
  return state.categories.find((c) => c.id === id) || null;
}

// =====================================
// タスク操作アクション
// =====================================

function handleQuickAdd(title) {
  const trimmed = title.trim();
  if (!trimmed) return;

  const dueDate = ui.activeTab === 'today' ? todayStr : null;
  const recurrence = ui.activeTab === 'routines' ? { type: 'daily' } : { type: 'none' };
  const newTask = createTask({
    title: trimmed,
    dueDate: recurrence.type !== 'none' ? todayStr : dueDate,
    recurrence,
  });

  state.tasks.unshift(newTask);
  persistAndRender();
  showToast('タスクを追加しました');
}

function handleToggleTask(taskId) {
  const idx = state.tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return;

  const snapshot = cloneStateSnapshot();
  const current = state.tasks[idx];
  const { task: updated, action } = toggleTaskCompletion(current, todayStr);
  state.tasks[idx] = updated;

  persistAndRender();

  if (action === 'routine-completed') {
    const nextLabel = formatDueDateLabel(updated.dueDate, todayStr);
    showToast(`ルーティン完了！次回は${nextLabel}（${updated.streak}回連続）`, snapshot);
  } else if (action === 'routine-uncompleted') {
    showToast('ルーティンを未完了に戻しました');
  } else if (action === 'completed') {
    showToast('タスクを完了しました', snapshot);
  } else {
    showToast('未完了に戻しました');
  }
}

function handleToggleSubtaskInline(taskId, subtaskId) {
  const idx = state.tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return;
  state.tasks[idx] = toggleSubtask(state.tasks[idx], subtaskId);
  persistAndRender();
}

function handleRescheduleOverdue() {
  const snapshot = cloneStateSnapshot();
  const { tasks, count } = rescheduleOverdueToToday(state.tasks, todayStr);
  if (count === 0) return;
  state.tasks = tasks;
  persistAndRender();
  showToast(`期限切れの${count}件を今日に変更しました`, snapshot);
}

function handleDeleteTask(taskId) {
  const target = state.tasks.find((t) => t.id === taskId);
  if (!target) return;
  const snapshot = cloneStateSnapshot();
  state.tasks = state.tasks.filter((t) => t.id !== taskId);
  ui.modal = null;
  persistAndRender();
  showToast(`「${target.title}」を削除しました`, snapshot);
}

function openCreateTaskModal(overrides = {}) {
  const defaultDue = ui.activeTab === 'today' || ui.activeTab === 'routines' ? todayStr : null;
  const defaultRecurrence = ui.activeTab === 'routines' ? { type: 'daily' } : { type: 'none' };
  const draft = {
    id: null,
    title: '',
    notes: '',
    dueDate: overrides.dueDate !== undefined ? overrides.dueDate : defaultDue,
    priority: 'none',
    categoryId: null,
    recurrence: overrides.recurrence || defaultRecurrence,
    subtasks: [],
    ...overrides,
  };
  ui.modal = { type: 'task', mode: 'create', draft };
  renderModal();
  requestAnimationFrame(() => {
    const input = document.getElementById('modal-task-title');
    if (input) input.focus();
  });
}

function openEditTaskModal(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const draft = JSON.parse(JSON.stringify(task));
  ui.modal = { type: 'task', mode: 'edit', draft };
  renderModal();
}

function openSettingsModal() {
  ui.modal = { type: 'settings' };
  renderModal();
}

function closeModal() {
  ui.modal = null;
  renderModal();
}

function saveTaskDraft() {
  if (!ui.modal || ui.modal.type !== 'task') return;
  const draft = ui.modal.draft;
  const title = (draft.title || '').trim();
  if (!title) {
    const input = document.getElementById('modal-task-title');
    if (input) {
      input.classList.add('input-error');
      input.focus();
      setTimeout(() => input.classList.remove('input-error'), 600);
    }
    return;
  }

  if (ui.modal.mode === 'create') {
    const created = createTask(draft);
    state.tasks.unshift(created);
    ui.modal = null;
    persistAndRender();
    showToast(isRecurring(created) ? 'ルーティンを作成しました' : 'タスクを作成しました');
  } else {
    const idx = state.tasks.findIndex((t) => t.id === draft.id);
    if (idx !== -1) {
      const merged = createTask({ ...state.tasks[idx], ...draft, id: draft.id });
      state.tasks[idx] = merged;
    }
    ui.modal = null;
    persistAndRender();
    showToast('変更を保存しました');
  }
}

// =====================================
// HTMLテンプレート描画
// =====================================

function renderHeader() {
  const buckets = getTodayBuckets(state.tasks, todayStr);
  const { doneCount, totalCount, progress } = buckets.stats;

  const titles = {
    today: '今日',
    upcoming: '予定',
    routines: 'ルーティン',
    all: 'すべて',
  };

  const subtitles = {
    today: formatHeaderDate(todayStr),
    upcoming: 'UPCOMING',
    routines: `ROUTINES · ${state.tasks.filter((t) => isRecurring(t)).length}`,
    all: `ALL TASKS · 残り ${state.tasks.filter((t) => !t.completed).length}`,
  };

  const progressLineHtml =
    ui.activeTab === 'today' && totalCount > 0
      ? `
        <div class="hero-progress" aria-label="今日の進捗 ${doneCount}/${totalCount}">
          <div class="hero-progress-track">
            <div class="hero-progress-fill" style="width:${progress}%"></div>
          </div>
          <span class="hero-progress-label">${doneCount} / ${totalCount}</span>
        </div>
      `
      : '';

  return `
    <header class="app-header">
      <div class="header-top">
        <div class="header-left">
          <p class="header-subtitle">${escapeHtml(subtitles[ui.activeTab])}</p>
          <h1 class="header-title">${escapeHtml(titles[ui.activeTab])}</h1>
        </div>
        <div class="header-right">
          <button type="button" class="icon-btn" data-action="open-settings" aria-label="設定を開く">
            ${icons.settings(19)}
          </button>
        </div>
      </div>
      ${progressLineHtml}
    </header>
  `;
}

function renderTaskCard(task, options = {}) {
  const { isDoneView = false } = options;
  const recurring = isRecurring(task);
  const checked = isDoneView || (!recurring && task.completed) || (recurring && task.lastCompletedDate === todayStr);
  const category = getCategoryById(task.categoryId);
  const isOverdue = !checked && task.dueDate && task.dueDate < todayStr;
  const subtasks = task.subtasks || [];
  const subDone = subtasks.filter((s) => s.completed).length;
  const expanded = ui.expandedTaskIds.has(task.id);

  // 引き算の繊細なインライン・メタ情報
  const metaItems = [];

  if (task.dueDate) {
    const dueClass = isOverdue ? 'meta-item is-danger' : 'meta-item';
    const label = recurring && checked ? `次回 ${formatDueDateLabel(task.dueDate, todayStr)}` : formatDueDateLabel(task.dueDate, todayStr);
    // 今日タブの「今日」は冗長なので期限切れや翌日以降、ルーティン次回日のみスッキリ表示
    if (!(ui.activeTab === 'today' && !isOverdue && !checked && task.dueDate === todayStr)) {
      metaItems.push(`<span class="${dueClass}">${icons.calendar(12)} ${escapeHtml(label)}</span>`);
    }
  }

  if (recurring) {
    metaItems.push(`<span class="meta-item is-routine">${icons.repeat(12)} ${escapeHtml(formatRecurrenceLabel(task.recurrence))}</span>`);
    if (task.streak > 0) {
      metaItems.push(`<span class="meta-item is-streak">${icons.flame(12)} ${task.streak}</span>`);
    }
  }

  if (category) {
    metaItems.push(
      `<span class="meta-item">
        <span class="cat-dot" style="background:${escapeHtml(category.color)}"></span>
        ${escapeHtml(category.name)}
      </span>`
    );
  }

  if (task.priority === 'high') {
    metaItems.push(`<span class="meta-item is-danger">${icons.flag(11)} 高</span>`);
  } else if (task.priority === 'medium') {
    metaItems.push(`<span class="meta-item is-warning">${icons.flag(11)} 中</span>`);
  }

  if (subtasks.length > 0) {
    metaItems.push(
      `<button type="button" class="meta-sub-btn ${subDone === subtasks.length ? 'is-all-done' : ''}" data-action="toggle-expand" data-id="${escapeHtml(task.id)}" aria-label="サブタスクを開閉">
        ${icons.subtasks(11)} ${subDone}/${subtasks.length}
      </button>`
    );
  }

  if (task.notes && task.notes.trim() !== '') {
    metaItems.push(`<span class="meta-item" title="メモあり">${icons.note(12)}</span>`);
  }

  // 展開時のサブタスクインラインチェックリスト
  let subtasksDrawerHtml = '';
  if (expanded && subtasks.length > 0) {
    subtasksDrawerHtml = `
      <div class="card-subtasks">
        ${subtasks
          .map(
            (sub) => `
          <label class="inline-subtask ${sub.completed ? 'is-done' : ''}">
            <input type="checkbox" ${sub.completed ? 'checked' : ''} data-action="toggle-subtask-inline" data-task-id="${escapeHtml(task.id)}" data-sub-id="${escapeHtml(sub.id)}" />
            <span class="inline-subtask-box">${icons.check(10)}</span>
            <span class="inline-subtask-title">${escapeHtml(sub.title)}</span>
          </label>
        `
          )
          .join('')}
      </div>
    `;
  }

  return `
    <article class="task-row ${checked ? 'is-completed' : ''}" data-task-id="${escapeHtml(task.id)}">
      <div class="task-row-main">
        <button
          type="button"
          class="check-circle priority-${task.priority} ${checked ? 'is-checked' : ''}"
          data-action="toggle-task"
          data-id="${escapeHtml(task.id)}"
          aria-label="${checked ? '未完了に戻す' : '完了にする'}"
          aria-pressed="${checked}"
        >
          ${icons.check(13)}
        </button>
        <div class="task-body" data-action="edit-task" data-id="${escapeHtml(task.id)}">
          <div class="task-title">${escapeHtml(task.title)}</div>
          ${metaItems.length > 0 ? `<div class="task-meta">${metaItems.join('<span class="meta-sep" aria-hidden="true">·</span>')}</div>` : ''}
        </div>
      </div>
      ${subtasksDrawerHtml}
    </article>
  `;
}

function renderQuickAddBar(placeholder) {
  return `
    <form class="quick-add-form" data-form="quick-add">
      <span class="quick-add-icon">${icons.plus(18)}</span>
      <input
        type="text"
        class="quick-add-input"
        name="title"
        placeholder="${escapeHtml(placeholder)}"
        autocomplete="off"
        enterkeyhint="done"
      />
      <button type="submit" class="quick-add-btn">追加</button>
    </form>
  `;
}

function renderTodayView() {
  const { overdue, todayRoutines, todayTasks, completedToday, stats } = getTodayBuckets(state.tasks, todayStr);

  const sections = [];

  // クイック追加バー
  sections.push(renderQuickAddBar('今日のタスクをすばやく追加…'));

  // 全完了のお祝いカード
  if (stats.totalCount > 0 && stats.remainingCount === 0) {
    sections.push(`
      <div class="celebration-card">
        <div class="celebration-icon">${icons.sparkles(26)}</div>
        <div>
          <div class="celebration-title">今日のタスクをすべて達成しました！</div>
          <div class="celebration-desc">${stats.doneCount}件のタスクをクリア。おつかれさまでした！</div>
        </div>
      </div>
    `);
  }

  // 期限切れ
  if (overdue.length > 0) {
    sections.push(`
      <section class="task-section">
        <div class="section-header">
          <h2 class="section-title is-danger">期限切れ <span class="count-pill is-danger">${overdue.length}</span></h2>
          <button type="button" class="text-btn" data-action="reschedule-overdue">すべて今日にする</button>
        </div>
        <div class="task-list">
          ${overdue.map((t) => renderTaskCard(t)).join('')}
        </div>
      </section>
    `);
  }

  // 今日のルーティン
  if (todayRoutines.length > 0) {
    sections.push(`
      <section class="task-section">
        <div class="section-header">
          <h2 class="section-title">今日のルーティン <span class="count-pill">${todayRoutines.length}</span></h2>
        </div>
        <div class="task-list">
          ${todayRoutines.map((t) => renderTaskCard(t)).join('')}
        </div>
      </section>
    `);
  }

  // 今日のタスク
  if (todayTasks.length > 0) {
    sections.push(`
      <section class="task-section">
        <div class="section-header">
          <h2 class="section-title">今日のタスク <span class="count-pill">${todayTasks.length}</span></h2>
        </div>
        <div class="task-list">
          ${todayTasks.map((t) => renderTaskCard(t)).join('')}
        </div>
      </section>
    `);
  }

  // 何もないときの空状態
  if (stats.totalCount === 0) {
    sections.push(`
      <div class="empty-state">
        <div class="empty-icon">${icons.sun(36)}</div>
        <p class="empty-title">今日の予定はまだありません</p>
        <p class="empty-desc">上の入力欄や右下の「＋」からタスクや毎日のルーティンを追加してみましょう。</p>
      </div>
    `);
  }

  // 今日完了したもの（折りたたみ可能）
  if (completedToday.length > 0) {
    sections.push(`
      <section class="task-section">
        <button type="button" class="section-toggle" data-action="toggle-completed-section" aria-expanded="${!ui.completedCollapsed}">
          <span class="section-title">今日完了 <span class="count-pill">${completedToday.length}</span></span>
          <span class="chevron">${ui.completedCollapsed ? icons.chevronRight(18) : icons.chevronDown(18)}</span>
        </button>
        ${
          ui.completedCollapsed
            ? ''
            : `<div class="task-list">${completedToday.map((t) => renderTaskCard(t, { isDoneView: true })).join('')}</div>`
        }
      </section>
    `);
  }

  return sections.join('');
}

function renderUpcomingView() {
  const buckets = getUpcomingBuckets(state.tasks, todayStr);
  const groups = [
    { key: 'overdue', title: '期限切れ', items: buckets.overdue, danger: true },
    { key: 'today', title: '今日', items: buckets.today },
    { key: 'tomorrow', title: '明日', items: buckets.tomorrow },
    { key: 'thisWeek', title: '今週（7日以内）', items: buckets.thisWeek },
    { key: 'later', title: '来週以降', items: buckets.later },
    { key: 'noDate', title: '期限なし', items: buckets.noDate },
  ].filter((g) => g.items.length > 0);

  if (groups.length === 0) {
    return `
      <div class="empty-state">
        <div class="empty-icon">${icons.calendar(36)}</div>
        <p class="empty-title">予定されているタスクはありません</p>
        <p class="empty-desc">右下の「＋」ボタンから期限つきのタスクを追加できます。</p>
      </div>
    `;
  }

  return groups
    .map(
      (g) => `
    <section class="task-section">
      <div class="section-header">
        <h2 class="section-title ${g.danger ? 'is-danger' : ''}">${g.title} <span class="count-pill ${g.danger ? 'is-danger' : ''}">${g.items.length}</span></h2>
        ${g.danger ? '<button type="button" class="text-btn" data-action="reschedule-overdue">すべて今日にする</button>' : ''}
      </div>
      <div class="task-list">
        ${g.items.map((t) => renderTaskCard(t)).join('')}
      </div>
    </section>
  `
    )
    .join('');
}

function renderRoutinesView() {
  const allRoutines = state.tasks.filter((t) => isRecurring(t));
  const filterOptions = [
    { id: 'all', label: 'すべて' },
    { id: 'daily', label: '毎日' },
    { id: 'weekdays', label: '平日' },
    { id: 'weekly', label: '毎週' },
    { id: 'monthly', label: '毎月' },
  ];

  const filtered =
    ui.routineFilter === 'all'
      ? allRoutines
      : allRoutines.filter((t) => t.recurrence.type === ui.routineFilter);

  const chipHtml = `
    <div class="chip-scroll">
      ${filterOptions
        .map(
          (f) => `
        <button type="button" class="filter-chip ${ui.routineFilter === f.id ? 'is-active' : ''}" data-action="routine-filter" data-value="${f.id}">
          ${f.label}
        </button>
      `
        )
        .join('')}
    </div>
  `;

  if (filtered.length === 0) {
    return `
      ${chipHtml}
      <div class="empty-state">
        <div class="empty-icon">${icons.repeat(36)}</div>
        <p class="empty-title">繰り返しタスクがありません</p>
        <p class="empty-desc">朝の習慣・ゴミ出し・毎週の振り返りなどを登録しておくと、完了するたびに次回の予定が自動で更新されます。</p>
        <button type="button" class="primary-btn" data-action="open-create-routine">ルーティンを作成する</button>
      </div>
    `;
  }

  // 今日未完了のものを上に、今日完了済みを下に
  const pending = filtered.filter((t) => t.lastCompletedDate !== todayStr);
  const doneToday = filtered.filter((t) => t.lastCompletedDate === todayStr);

  return `
    ${renderQuickAddBar('毎日のルーティンをすばやく追加…')}
    ${chipHtml}
    ${
      pending.length > 0
        ? `<section class="task-section">
            <div class="section-header"><h2 class="section-title">アクティブ <span class="count-pill">${pending.length}</span></h2></div>
            <div class="task-list">${pending.map((t) => renderTaskCard(t)).join('')}</div>
          </section>`
        : ''
    }
    ${
      doneToday.length > 0
        ? `<section class="task-section">
            <div class="section-header"><h2 class="section-title">今日達成済み <span class="count-pill">${doneToday.length}</span></h2></div>
            <div class="task-list">${doneToday.map((t) => renderTaskCard(t, { isDoneView: true })).join('')}</div>
          </section>`
        : ''
    }
  `;
}

function renderAllView() {
  const { query, categoryId, priority, showCompleted, sortBy } = ui.allFilters;
  const tasks = filterAllTasks(state.tasks, ui.allFilters);

  const controlsHtml = `
    <div class="search-box">
      <span class="search-icon">${icons.search(18)}</span>
      <input
        type="search"
        id="all-search-input"
        class="search-input"
        placeholder="タスク・メモ・サブタスクを検索…"
        value="${escapeHtml(query)}"
        autocomplete="off"
      />
      ${query ? `<button type="button" class="search-clear" data-action="clear-search" aria-label="検索をクリア">${icons.x(16)}</button>` : ''}
    </div>

    <div class="chip-scroll">
      <button type="button" class="filter-chip ${categoryId === 'all' ? 'is-active' : ''}" data-action="filter-category" data-value="all">すべて</button>
      ${state.categories
        .map(
          (c) => `
        <button type="button" class="filter-chip ${categoryId === c.id ? 'is-active' : ''}" data-action="filter-category" data-value="${escapeHtml(c.id)}">
          <span class="cat-dot" style="background:${escapeHtml(c.color)}"></span>
          ${escapeHtml(c.name)}
        </button>
      `
        )
        .join('')}
      <button type="button" class="filter-chip ${categoryId === 'uncategorized' ? 'is-active' : ''}" data-action="filter-category" data-value="uncategorized">未分類</button>
    </div>

    <div class="all-toolbar">
      <div class="toolbar-selects">
        <select class="mini-select" data-action="filter-priority" aria-label="優先度で絞り込み">
          <option value="all" ${priority === 'all' ? 'selected' : ''}>優先度: すべて</option>
          <option value="high" ${priority === 'high' ? 'selected' : ''}>優先度: 高</option>
          <option value="medium" ${priority === 'medium' ? 'selected' : ''}>優先度: 中</option>
          <option value="low" ${priority === 'low' ? 'selected' : ''}>優先度: 低</option>
          <option value="none" ${priority === 'none' ? 'selected' : ''}>優先度: なし</option>
        </select>
        <select class="mini-select" data-action="sort-tasks" aria-label="並び替え">
          <option value="due" ${sortBy === 'due' ? 'selected' : ''}>期限順</option>
          <option value="priority" ${sortBy === 'priority' ? 'selected' : ''}>優先度順</option>
          <option value="created" ${sortBy === 'created' ? 'selected' : ''}>新しい順</option>
        </select>
      </div>
      <label class="toggle-inline">
        <input type="checkbox" ${showCompleted ? 'checked' : ''} data-action="toggle-show-completed" />
        <span>完了も表示</span>
      </label>
    </div>
  `;

  if (tasks.length === 0) {
    return `
      ${controlsHtml}
      <div class="empty-state">
        <div class="empty-icon">${icons.layers(36)}</div>
        <p class="empty-title">条件に合うタスクがありません</p>
        <p class="empty-desc">検索キーワードや絞り込み条件を変えてみてください。</p>
      </div>
    `;
  }

  return `
    ${controlsHtml}
    <div class="task-list">
      ${tasks.map((t) => renderTaskCard(t)).join('')}
    </div>
  `;
}

function renderTabBar() {
  const buckets = getTodayBuckets(state.tasks, todayStr);
  const badgeCount = buckets.stats.remainingCount;
  const tabs = [
    { id: 'today', label: '今日', icon: icons.sun(20), badge: badgeCount > 0 ? badgeCount : null },
    { id: 'upcoming', label: '予定', icon: icons.calendar(20) },
    { id: 'routines', label: 'ルーティン', icon: icons.repeat(20) },
    { id: 'all', label: 'すべて', icon: icons.layers(20) },
  ];

  return `
    <div class="bottom-dock">
      <nav class="tab-bar" aria-label="メインメニュー">
        ${tabs
          .map(
            (t) => `
          <button type="button" class="tab-item ${ui.activeTab === t.id ? 'is-active' : ''}" data-action="switch-tab" data-tab="${t.id}">
            <span class="tab-icon-wrap">
              ${t.icon}
              ${t.badge ? `<span class="tab-badge">${t.badge > 99 ? '99+' : t.badge}</span>` : ''}
            </span>
            <span class="tab-label">${t.label}</span>
          </button>
        `
          )
          .join('')}
      </nav>
      <button type="button" class="fab" data-action="open-create-task" aria-label="新しいタスクを追加">
        ${icons.plus(24)}
      </button>
    </div>
  `;
}

// =====================================
// ボトムシート（タスク追加・編集 / 設定）
// =====================================

function renderTaskModal(modal) {
  const { mode, draft } = modal;
  const tomorrowStr = addDays(todayStr, 1);
  const weekendStr = getNextWeekendStr(todayStr);
  const nextMonStr = getNextMondayStr(todayStr);
  const recType = draft.recurrence?.type || 'none';
  const recDays = draft.recurrence?.daysOfWeek || [];
  const recDayOfMonth = draft.recurrence?.dayOfMonth || Number((draft.dueDate || todayStr).slice(8, 10));
  const urls = extractUrls(draft.notes);

  return `
    <div class="sheet-backdrop" data-action="close-modal">
      <div class="bottom-sheet" role="dialog" aria-modal="true" aria-label="${mode === 'create' ? '新しいタスク' : 'タスクを編集'}">
        <div class="sheet-handle-wrap"><div class="sheet-handle"></div></div>
        <div class="sheet-header">
          <button type="button" class="text-btn muted" data-action="close-modal">キャンセル</button>
          <h2 class="sheet-title">${mode === 'create' ? '新しいタスク' : 'タスクを編集'}</h2>
          <button type="button" class="text-btn strong" data-action="save-task">保存</button>
        </div>

        <div class="sheet-body">
          <!-- タイトル -->
          <div class="field-group">
            <input
              type="text"
              id="modal-task-title"
              class="title-input"
              placeholder="やることを入力…"
              value="${escapeHtml(draft.title)}"
              data-draft-field="title"
              autocomplete="off"
            />
          </div>

          <!-- 期限 -->
          <div class="field-group">
            <label class="field-label">期限</label>
            <div class="preset-row">
              <button type="button" class="preset-chip ${draft.dueDate === todayStr ? 'is-active' : ''}" data-action="set-due" data-value="${todayStr}">今日</button>
              <button type="button" class="preset-chip ${draft.dueDate === tomorrowStr ? 'is-active' : ''}" data-action="set-due" data-value="${tomorrowStr}">明日</button>
              <button type="button" class="preset-chip ${draft.dueDate === weekendStr ? 'is-active' : ''}" data-action="set-due" data-value="${weekendStr}">今週末</button>
              <button type="button" class="preset-chip ${draft.dueDate === nextMonStr ? 'is-active' : ''}" data-action="set-due" data-value="${nextMonStr}">来週</button>
              <button type="button" class="preset-chip ${!draft.dueDate ? 'is-active' : ''}" data-action="set-due" data-value="">なし</button>
            </div>
            <input
              type="date"
              class="date-input"
              value="${escapeHtml(draft.dueDate || '')}"
              data-draft-field="dueDate"
              aria-label="期限の日付を指定"
            />
          </div>

          <!-- 繰り返し（ルーティン） -->
          <div class="field-group">
            <label class="field-label">繰り返し（ルーティン）</label>
            <div class="preset-row">
              ${[
                { id: 'none', label: 'なし' },
                { id: 'daily', label: '毎日' },
                { id: 'weekdays', label: '平日' },
                { id: 'weekly', label: '毎週' },
                { id: 'monthly', label: '毎月' },
              ]
                .map(
                  (r) => `
                <button type="button" class="preset-chip ${recType === r.id ? 'is-active' : ''}" data-action="set-recurrence-type" data-value="${r.id}">
                  ${r.label}
                </button>
              `
                )
                .join('')}
            </div>

            ${
              recType === 'weekly'
                ? `
              <div class="weekday-picker">
                ${WEEKDAY_JA.map(
                  (label, idx) => `
                  <button type="button" class="weekday-btn ${recDays.includes(idx) ? 'is-active' : ''}" data-action="toggle-rec-weekday" data-day="${idx}">
                    ${label}
                  </button>
                `
                ).join('')}
              </div>
            `
                : ''
            }

            ${
              recType === 'monthly'
                ? `
              <div class="monthly-picker">
                <span>毎月</span>
                <select class="mini-select" data-action="set-rec-month-day">
                  ${Array.from({ length: 31 }, (_, i) => i + 1)
                    .map((d) => `<option value="${d}" ${recDayOfMonth === d ? 'selected' : ''}>${d}日</option>`)
                    .join('')}
                </select>
                <span>に繰り返す</span>
              </div>
            `
                : ''
            }
          </div>

          <!-- 優先度 -->
          <div class="field-group">
            <label class="field-label">優先度</label>
            <div class="segmented-control">
              ${['none', 'low', 'medium', 'high']
                .map(
                  (p) => `
                <button type="button" class="segment-btn priority-seg-${p} ${draft.priority === p ? 'is-active' : ''}" data-action="set-priority" data-value="${p}">
                  ${PRIORITY_LABELS[p]}
                </button>
              `
                )
                .join('')}
            </div>
          </div>

          <!-- カテゴリ -->
          <div class="field-group">
            <label class="field-label">カテゴリ</label>
            <div class="preset-row">
              <button type="button" class="preset-chip ${!draft.categoryId ? 'is-active' : ''}" data-action="set-category" data-value="">なし</button>
              ${state.categories
                .map(
                  (c) => `
                <button type="button" class="preset-chip ${draft.categoryId === c.id ? 'is-active' : ''}" data-action="set-category" data-value="${escapeHtml(c.id)}">
                  <span class="cat-dot" style="background:${escapeHtml(c.color)}"></span>
                  ${escapeHtml(c.name)}
                </button>
              `
                )
                .join('')}
            </div>
          </div>

          <!-- サブタスク -->
          <div class="field-group">
            <label class="field-label">サブタスク（チェックリスト）</label>
            <div class="subtask-editor-list">
              ${(draft.subtasks || [])
                .map(
                  (sub) => `
                <div class="subtask-editor-item ${sub.completed ? 'is-done' : ''}">
                  <button type="button" class="sub-check-btn ${sub.completed ? 'is-checked' : ''}" data-action="draft-toggle-subtask" data-sub-id="${escapeHtml(sub.id)}" aria-label="サブタスク完了切替">
                    ${icons.check(12)}
                  </button>
                  <span class="subtask-editor-title">${escapeHtml(sub.title)}</span>
                  <button type="button" class="sub-del-btn" data-action="draft-delete-subtask" data-sub-id="${escapeHtml(sub.id)}" aria-label="サブタスクを削除">
                    ${icons.x(15)}
                  </button>
                </div>
              `
                )
                .join('')}
            </div>
            <div class="subtask-add-row">
              <input
                type="text"
                id="draft-subtask-input"
                class="subtask-input"
                placeholder="サブタスクを追加…"
                autocomplete="off"
                enterkeyhint="done"
              />
              <button type="button" class="subtask-add-btn" data-action="draft-add-subtask">追加</button>
            </div>
          </div>

          <!-- メモ -->
          <div class="field-group">
            <label class="field-label" for="modal-task-notes">メモ</label>
            <textarea
              id="modal-task-notes"
              class="notes-textarea"
              rows="4"
              placeholder="詳しい内容・持ち物・リンクなどをメモ…"
              data-draft-field="notes"
            >${escapeHtml(draft.notes || '')}</textarea>
            ${
              urls.length > 0
                ? `<div class="note-links">
                    ${urls
                      .map(
                        (u) => `<a class="note-link-pill" href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer">${icons.externalLink(13)} ${escapeHtml(u.replace(/^https?:\/\//, '').slice(0, 34))}</a>`
                      )
                      .join('')}
                  </div>`
                : ''
            }
          </div>

          ${
            mode === 'edit'
              ? `
            <div class="danger-zone">
              <button type="button" class="danger-btn" data-action="delete-task" data-id="${escapeHtml(draft.id)}">
                ${icons.trash(17)} このタスクを削除
              </button>
            </div>
          `
              : ''
          }
        </div>
      </div>
    </div>
  `;
}

function renderSettingsModal() {
  const { theme, accent } = state.settings;
  const completedCount = state.tasks.filter((t) => !isRecurring(t) && t.completed).length;

  return `
    <div class="sheet-backdrop" data-action="close-modal">
      <div class="bottom-sheet" role="dialog" aria-modal="true" aria-label="設定">
        <div class="sheet-handle-wrap"><div class="sheet-handle"></div></div>
        <div class="sheet-header">
          <span class="header-spacer"></span>
          <h2 class="sheet-title">設定</h2>
          <button type="button" class="text-btn strong" data-action="close-modal">完了</button>
        </div>

        <div class="sheet-body">
          <!-- 外観テーマ -->
          <div class="field-group">
            <label class="field-label">外観テーマ</label>
            <div class="segmented-control">
              ${[
                { id: 'dark', label: 'ダーク' },
                { id: 'light', label: 'ライト' },
                { id: 'system', label: '自動' },
              ]
                .map(
                  (opt) => `
                <button type="button" class="segment-btn ${theme === opt.id ? 'is-active' : ''}" data-action="set-theme" data-value="${opt.id}">
                  ${opt.label}
                </button>
              `
                )
                .join('')}
            </div>
          </div>

          <!-- アクセントカラー -->
          <div class="field-group">
            <label class="field-label">アクセント</label>
            <div class="accent-row">
              ${ACCENT_PRESETS.map((p) => {
                const dark = isEffectiveDark();
                const bg = dark ? p.color : p.lightColor;
                const fg = dark ? p.onColor : p.lightOnColor;
                return `
                <button
                  type="button"
                  class="accent-swatch ${accent === p.id ? 'is-active' : ''}"
                  style="background:${bg};color:${fg}"
                  data-action="set-accent"
                  data-value="${p.id}"
                  aria-label="${p.name}"
                  title="${p.name}"
                >
                  ${accent === p.id ? icons.check(15) : ''}
                </button>
              `;
              }).join('')}
            </div>
          </div>

          <!-- カテゴリ管理 -->
          <div class="field-group">
            <label class="field-label">カテゴリ管理</label>
            <div class="cat-manage-list">
              ${state.categories
                .map(
                  (c) => `
                <div class="cat-manage-item">
                  <span class="cat-dot large" style="background:${escapeHtml(c.color)}"></span>
                  <span class="cat-manage-name">${escapeHtml(c.name)}</span>
                  <button type="button" class="sub-del-btn" data-action="delete-category" data-id="${escapeHtml(c.id)}" aria-label="${escapeHtml(c.name)}を削除">
                    ${icons.trash(15)}
                  </button>
                </div>
              `
                )
                .join('')}
            </div>
            <div class="cat-add-box">
              <div class="color-picker-row">
                ${CATEGORY_COLORS.map(
                  (color) => `
                  <button type="button" class="color-dot-btn ${ui.newCatColor === color ? 'is-active' : ''}" style="background:${color}" data-action="pick-new-cat-color" data-color="${color}" aria-label="色を選択"></button>
                `
                ).join('')}
              </div>
              <div class="subtask-add-row">
                <input type="text" id="new-category-input" class="subtask-input" placeholder="新しいカテゴリ名…" value="${escapeHtml(ui.newCatName)}" autocomplete="off" />
                <button type="button" class="subtask-add-btn" data-action="add-category">追加</button>
              </div>
            </div>
          </div>

          <!-- バックアップとデータ管理 -->
          <div class="field-group">
            <label class="field-label">データ管理（iPhone端末内に保存中）</label>
            <p class="helper-text">ログイン不要・完全無料のため、データはご利用のブラウザ内に保存されます。機種変更や万が一に備えてJSONバックアップができます。</p>
            <div class="action-stack">
              <button type="button" class="secondary-btn" data-action="export-json">
                ${icons.download(17)} バックアップを書き出す（JSON）
              </button>
              <label class="secondary-btn file-btn">
                ${icons.upload(17)} バックアップから復元する
                <input type="file" id="import-json-input" accept="application/json,.json" hidden />
              </label>
              ${
                completedCount > 0
                  ? `<button type="button" class="secondary-btn warn" data-action="clear-completed">
                      ${icons.trash(17)} 完了済みタスクをすべて整理（${completedCount}件）
                    </button>`
                  : ''
              }
              <button type="button" class="secondary-btn muted" data-action="load-sample">
                サンプルタスクを再読み込み
              </button>
            </div>
          </div>

          <!-- iPhoneホーム画面追加ガイド -->
          <div class="field-group">
            <label class="field-label">iPhoneでアプリのように使う方法</label>
            <div class="ios-guide-card">
              <div class="ios-guide-step">
                <span class="step-num">1</span>
                <span>Safariで開いて、画面下の共有ボタン ${icons.share(15)} をタップ</span>
              </div>
              <div class="ios-guide-step">
                <span class="step-num">2</span>
                <span>メニューを下にスクロールして<strong>「ホーム画面に追加」</strong>をタップ</span>
              </div>
              <div class="ios-guide-step">
                <span class="step-num">3</span>
                <span>右上の<strong>「追加」</strong>を押すと、ホーム画面からフルスクリーン＆オフラインで起動できます！</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderModal() {
  const host = document.getElementById('modal-root');
  if (!host) return;
  if (!ui.modal) {
    host.innerHTML = '';
    document.body.classList.remove('modal-open');
    return;
  }
  document.body.classList.add('modal-open');
  if (ui.modal.type === 'task') {
    host.innerHTML = renderTaskModal(ui.modal);
  } else if (ui.modal.type === 'settings') {
    host.innerHTML = renderSettingsModal();
  }
}

function renderToast() {
  const host = document.getElementById('toast-root');
  if (!host) return;
  if (!ui.toast) {
    host.innerHTML = '';
    return;
  }
  host.innerHTML = `
    <div class="toast" role="status" aria-live="polite">
      <span class="toast-msg">${escapeHtml(ui.toast.message)}</span>
      ${ui.toast.undoSnapshot ? `<button type="button" class="toast-undo" data-action="undo-toast">元に戻す</button>` : ''}
    </div>
  `;
}

function render() {
  let contentHtml = '';
  if (ui.activeTab === 'today') contentHtml = renderTodayView();
  else if (ui.activeTab === 'upcoming') contentHtml = renderUpcomingView();
  else if (ui.activeTab === 'routines') contentHtml = renderRoutinesView();
  else contentHtml = renderAllView();

  appRoot.innerHTML = `
    <div class="app-shell">
      ${renderHeader()}
      <main class="app-main">
        ${contentHtml}
      </main>
      ${renderTabBar()}
    </div>
    <div id="modal-root"></div>
    <div id="toast-root"></div>
  `;

  renderModal();
  renderToast();
}

// =====================================
// イベント委譲（クリック・入力・送信）
// =====================================

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;

  const action = el.dataset.action;

  // バックドロップ直接クリックのみ閉じる
  if (action === 'close-modal') {
    if (el.classList.contains('sheet-backdrop') && e.target !== el) return;
    closeModal();
    return;
  }

  switch (action) {
    case 'switch-tab':
      ui.activeTab = el.dataset.tab;
      render();
      window.scrollTo({ top: 0, behavior: 'instant' });
      break;

    case 'open-create-task':
      openCreateTaskModal();
      break;

    case 'open-create-routine':
      openCreateTaskModal({ dueDate: todayStr, recurrence: { type: 'daily' } });
      break;

    case 'open-settings':
      openSettingsModal();
      break;

    case 'toggle-task':
      e.stopPropagation();
      handleToggleTask(el.dataset.id);
      break;

    case 'edit-task':
      openEditTaskModal(el.dataset.id);
      break;

    case 'toggle-expand':
      e.stopPropagation();
      if (ui.expandedTaskIds.has(el.dataset.id)) {
        ui.expandedTaskIds.delete(el.dataset.id);
      } else {
        ui.expandedTaskIds.add(el.dataset.id);
      }
      render();
      break;

    case 'reschedule-overdue':
      handleRescheduleOverdue();
      break;

    case 'toggle-completed-section':
      ui.completedCollapsed = !ui.completedCollapsed;
      render();
      break;

    case 'routine-filter':
      ui.routineFilter = el.dataset.value;
      render();
      break;

    case 'filter-category':
      ui.allFilters.categoryId = el.dataset.value;
      render();
      break;

    case 'clear-search':
      ui.allFilters.query = '';
      render();
      break;

    case 'undo-toast':
      if (ui.toast && ui.toast.undoSnapshot) {
        state.tasks = ui.toast.undoSnapshot.tasks;
        state.categories = ui.toast.undoSnapshot.categories;
        ui.toast = null;
        persistAndRender();
        showToast('元に戻しました');
      }
      break;

    // タスクモーダル操作
    case 'save-task':
      saveTaskDraft();
      break;

    case 'delete-task':
      handleDeleteTask(el.dataset.id);
      break;

    case 'set-due':
      if (ui.modal?.type === 'task') {
        ui.modal.draft.dueDate = el.dataset.value || null;
        renderModal();
      }
      break;

    case 'set-recurrence-type':
      if (ui.modal?.type === 'task') {
        const type = el.dataset.value;
        if (type === 'none') {
          ui.modal.draft.recurrence = { type: 'none' };
        } else if (type === 'weekly') {
          const baseDate = ui.modal.draft.dueDate || todayStr;
          const dow = new Date(`${baseDate}T12:00:00`).getDay();
          ui.modal.draft.recurrence = {
            type: 'weekly',
            daysOfWeek: ui.modal.draft.recurrence?.daysOfWeek?.length ? ui.modal.draft.recurrence.daysOfWeek : [dow],
          };
          if (!ui.modal.draft.dueDate) ui.modal.draft.dueDate = todayStr;
        } else if (type === 'monthly') {
          const baseDate = ui.modal.draft.dueDate || todayStr;
          const day = Number(baseDate.slice(8, 10)) || 1;
          ui.modal.draft.recurrence = { type: 'monthly', dayOfMonth: day };
          if (!ui.modal.draft.dueDate) ui.modal.draft.dueDate = todayStr;
        } else {
          ui.modal.draft.recurrence = { type };
          if (!ui.modal.draft.dueDate) ui.modal.draft.dueDate = todayStr;
        }
        renderModal();
      }
      break;

    case 'toggle-rec-weekday':
      if (ui.modal?.type === 'task' && ui.modal.draft.recurrence?.type === 'weekly') {
        const day = Number(el.dataset.day);
        const set = new Set(ui.modal.draft.recurrence.daysOfWeek || []);
        if (set.has(day) && set.size > 1) {
          set.delete(day);
        } else {
          set.add(day);
        }
        ui.modal.draft.recurrence.daysOfWeek = [...set].sort((a, b) => a - b);
        renderModal();
      }
      break;

    case 'set-priority':
      if (ui.modal?.type === 'task') {
        ui.modal.draft.priority = el.dataset.value;
        renderModal();
      }
      break;

    case 'set-category':
      if (ui.modal?.type === 'task') {
        ui.modal.draft.categoryId = el.dataset.value || null;
        renderModal();
      }
      break;

    case 'draft-add-subtask':
      addSubtaskToDraft();
      break;

    case 'draft-toggle-subtask':
      if (ui.modal?.type === 'task') {
        const subId = el.dataset.subId;
        ui.modal.draft.subtasks = (ui.modal.draft.subtasks || []).map((s) =>
          s.id === subId ? { ...s, completed: !s.completed } : s
        );
        renderModal();
      }
      break;

    case 'draft-delete-subtask':
      if (ui.modal?.type === 'task') {
        const subId = el.dataset.subId;
        ui.modal.draft.subtasks = (ui.modal.draft.subtasks || []).filter((s) => s.id !== subId);
        renderModal();
      }
      break;

    // 設定モーダル操作
    case 'set-theme':
      state.settings.theme = el.dataset.value;
      persistAndRender();
      break;

    case 'set-accent':
      state.settings.accent = el.dataset.value;
      persistAndRender();
      break;

    case 'pick-new-cat-color':
      ui.newCatColor = el.dataset.color;
      renderModal();
      break;

    case 'add-category': {
      const input = document.getElementById('new-category-input');
      const name = (input ? input.value : ui.newCatName).trim();
      if (!name) return;
      state.categories.push({ id: createId('cat'), name, color: ui.newCatColor });
      ui.newCatName = '';
      persistAndRender();
      showToast(`カテゴリ「${name}」を追加しました`);
      break;
    }

    case 'delete-category': {
      const catId = el.dataset.id;
      const cat = getCategoryById(catId);
      if (!cat) return;
      const snapshot = cloneStateSnapshot();
      state.categories = state.categories.filter((c) => c.id !== catId);
      state.tasks = state.tasks.map((t) => (t.categoryId === catId ? { ...t, categoryId: null } : t));
      persistAndRender();
      showToast(`カテゴリ「${cat.name}」を削除しました`, snapshot);
      break;
    }

    case 'export-json': {
      const json = exportStateAsJson(state);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hibi-backup-${todayStr}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('バックアップファイルを書き出しました');
      break;
    }

    case 'clear-completed': {
      const snapshot = cloneStateSnapshot();
      const before = state.tasks.length;
      state.tasks = state.tasks.filter((t) => isRecurring(t) || !t.completed);
      const removed = before - state.tasks.length;
      persistAndRender();
      showToast(`完了済みタスク${removed}件を整理しました`, snapshot);
      break;
    }

    case 'load-sample': {
      if (!window.confirm('現在のタスクをサンプルデータで上書きしてもよろしいですか？（元に戻すことも可能です）')) {
        return;
      }
      const snapshot = cloneStateSnapshot();
      const sample = buildSampleData(todayStr);
      state.tasks = sample.tasks;
      state.categories = sample.categories;
      ui.modal = null;
      persistAndRender();
      showToast('サンプルタスクを読み込みました', snapshot);
      break;
    }
  }
});

function addSubtaskToDraft() {
  if (ui.modal?.type !== 'task') return;
  const input = document.getElementById('draft-subtask-input');
  if (!input) return;
  const title = input.value.trim();
  if (!title) return;
  ui.modal.draft.subtasks = [...(ui.modal.draft.subtasks || []), { id: createId('sub'), title, completed: false }];
  renderModal();
  requestAnimationFrame(() => {
    const nextInput = document.getElementById('draft-subtask-input');
    if (nextInput) nextInput.focus();
  });
}

document.addEventListener('input', (e) => {
  const target = e.target;

  // すべてタブの検索（フォーカスを維持したまま結果だけ更新）
  if (target.id === 'all-search-input') {
    ui.allFilters.query = target.value;
    const pos = target.selectionStart;
    render();
    const reInput = document.getElementById('all-search-input');
    if (reInput) {
      reInput.focus();
      reInput.setSelectionRange(pos, pos);
    }
    return;
  }

  if (target.id === 'new-category-input') {
    ui.newCatName = target.value;
    return;
  }

  // タスク編集モーダルのフィールド同期
  if (ui.modal?.type === 'task' && target.dataset.draftField) {
    const field = target.dataset.draftField;
    ui.modal.draft[field] = field === 'dueDate' ? target.value || null : target.value;
  }
});

document.addEventListener('change', (e) => {
  const target = e.target;

  // サブタスクのカード上インラインチェック
  if (target.dataset.action === 'toggle-subtask-inline') {
    handleToggleSubtaskInline(target.dataset.taskId, target.dataset.subId);
    return;
  }

  if (target.dataset.action === 'filter-priority') {
    ui.allFilters.priority = target.value;
    render();
    return;
  }

  if (target.dataset.action === 'sort-tasks') {
    ui.allFilters.sortBy = target.value;
    render();
    return;
  }

  if (target.dataset.action === 'toggle-show-completed') {
    ui.allFilters.showCompleted = target.checked;
    render();
    return;
  }

  if (target.dataset.action === 'set-rec-month-day' && ui.modal?.type === 'task') {
    ui.modal.draft.recurrence = { type: 'monthly', dayOfMonth: Number(target.value) };
    return;
  }

  if (target.dataset.draftField === 'dueDate' && ui.modal?.type === 'task') {
    ui.modal.draft.dueDate = target.value || null;
    renderModal();
    return;
  }

  // JSONバックアップ復元
  if (target.id === 'import-json-input' && target.files?.[0]) {
    const file = target.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const sanitized = sanitizeState(parsed);
        const snapshot = cloneStateSnapshot();
        state = sanitized;
        ui.modal = null;
        persistAndRender();
        showToast(`${sanitized.tasks.length}件のタスクを復元しました`, snapshot);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'ファイルの読み込みに失敗しました');
      }
    };
    reader.readAsText(file);
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target;
  if (form.dataset.form === 'quick-add') {
    e.preventDefault();
    const input = form.querySelector('input[name="title"]');
    if (input) {
      handleQuickAdd(input.value);
      input.value = '';
    }
  }
});

document.addEventListener('keydown', (e) => {
  // サブタスク入力欄でEnter押下 -> サブタスク追加
  if (e.key === 'Enter' && e.target?.id === 'draft-subtask-input') {
    e.preventDefault();
    addSubtaskToDraft();
    return;
  }
  // モーダルのタイトル欄でEnter押下 -> 保存
  if (e.key === 'Enter' && e.target?.id === 'modal-task-title') {
    e.preventDefault();
    saveTaskDraft();
    return;
  }
  // Escapeキーでモーダルを閉じる
  if (e.key === 'Escape' && ui.modal) {
    closeModal();
  }
});

// 翌日アプリを再開した際に日付表示・期限判定を自動更新
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    const nowToday = toDateStr();
    if (nowToday !== todayStr) {
      todayStr = nowToday;
      render();
    }
  }
});

// OSのダークモード切替に追従
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.settings.theme === 'system') {
      applyThemeAndAccent();
    }
  });
}

// Service Worker登録（オフライン動作対応）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // ローカルファイル直接開きの場合は無視
    });
  });
}

// 初期描画
applyThemeAndAccent();
render();
