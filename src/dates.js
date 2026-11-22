// ローカル日付（YYYY-MM-DD）の計算・繰り返し次回日算出・日本語フォーマット

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * Dateオブジェクトをローカルタイムゾーンの YYYY-MM-DD に変換する
 */
export function toDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * YYYY-MM-DD をローカルの正午 Date にパース（夏時間等のズレを防止）
 */
export function parseDateStr(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const d = new Date(year, month, day, 12, 0, 0, 0);
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) {
    return null;
  }
  return d;
}

/**
 * 指定日に日数を加算した YYYY-MM-DD を返す
 */
export function addDays(dateStr, days) {
  const d = parseDateStr(dateStr);
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

/**
 * 2つの YYYY-MM-DD の日数差 (b - a) を返す
 */
export function diffDays(aStr, bStr) {
  const a = parseDateStr(aStr);
  const b = parseDateStr(bStr);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * 曜日番号 (0=日 ... 6=土) を取得
 */
export function getWeekday(dateStr) {
  const d = parseDateStr(dateStr);
  return d ? d.getDay() : 0;
}

/**
 * 今週末（土曜日、今日が土日なら次の土曜日）の日付を返す
 */
export function getNextWeekendStr(todayStr = toDateStr()) {
  const dow = getWeekday(todayStr);
  const daysUntilSat = dow === 6 ? 7 : 6 - dow;
  return addDays(todayStr, daysUntilSat);
}

/**
 * 来週の月曜日を返す
 */
export function getNextMondayStr(todayStr = toDateStr()) {
  const dow = getWeekday(todayStr);
  const daysUntilMon = dow === 0 ? 1 : 8 - dow;
  return addDays(todayStr, daysUntilMon);
}

/**
 * 繰り返し設定に基づき、基準日の「次」の予定日 (YYYY-MM-DD) を計算する
 * @param {string|null} currentDueStr タスクの現在期限
 * @param {{type: string, daysOfWeek?: number[], dayOfMonth?: number}} recurrence 繰り返しルール
 * @param {string} todayStr 今日の日付
 */
export function getNextOccurrenceDate(currentDueStr, recurrence, todayStr = toDateStr()) {
  if (!recurrence || recurrence.type === 'none') return null;

  // 期限切れのルーティンを今日完了した場合も、過去日に戻らず「今日より後」を次回にする
  const baseStr = currentDueStr && currentDueStr > todayStr ? currentDueStr : todayStr;
  const baseDate = parseDateStr(baseStr);
  if (!baseDate) return addDays(todayStr, 1);

  switch (recurrence.type) {
    case 'daily': {
      return addDays(baseStr, 1);
    }

    case 'weekdays': {
      let next = addDays(baseStr, 1);
      while (getWeekday(next) === 0 || getWeekday(next) === 6) {
        next = addDays(next, 1);
      }
      return next;
    }

    case 'weekly': {
      const days = Array.isArray(recurrence.daysOfWeek) && recurrence.daysOfWeek.length > 0
        ? [...new Set(recurrence.daysOfWeek)].sort((a, b) => a - b)
        : [baseDate.getDay()];

      for (let offset = 1; offset <= 7; offset++) {
        const candidate = addDays(baseStr, offset);
        if (days.includes(getWeekday(candidate))) {
          return candidate;
        }
      }
      return addDays(baseStr, 7);
    }

    case 'monthly': {
      const targetDay = recurrence.dayOfMonth || baseDate.getDate();
      const nextYear = baseDate.getMonth() === 11 ? baseDate.getFullYear() + 1 : baseDate.getFullYear();
      const nextMonth = (baseDate.getMonth() + 1) % 12;
      // その月の最終日を超えないように丸める（例: 1月31日 -> 2月28日）
      const lastDayOfNextMonth = new Date(nextYear, nextMonth + 1, 0, 12, 0, 0, 0).getDate();
      const day = Math.min(targetDay, lastDayOfNextMonth);
      return toDateStr(new Date(nextYear, nextMonth, day, 12, 0, 0, 0));
    }

    default:
      return addDays(baseStr, 1);
  }
}

/**
 * 繰り返しルールをわかりやすい日本語ラベルに変換する
 */
export function formatRecurrenceLabel(recurrence) {
  if (!recurrence || recurrence.type === 'none') return '';
  switch (recurrence.type) {
    case 'daily':
      return '毎日';
    case 'weekdays':
      return '平日';
    case 'weekly': {
      const days = Array.isArray(recurrence.daysOfWeek) && recurrence.daysOfWeek.length > 0
        ? [...new Set(recurrence.daysOfWeek)].sort((a, b) => a - b)
        : [];
      if (days.length === 7) return '毎日';
      if (days.length === 0) return '毎週';
      return `毎週 ${days.map((d) => WEEKDAY_JA[d]).join('・')}`;
    }
    case 'monthly':
      return recurrence.dayOfMonth ? `毎月 ${recurrence.dayOfMonth}日` : '毎月';
    default:
      return '';
  }
}

/**
 * 期限をわかりやすい日本語バッジ表示に変換する
 */
export function formatDueDateLabel(dueDateStr, todayStr = toDateStr()) {
  if (!dueDateStr) return '';
  const diff = diffDays(todayStr, dueDateStr);
  if (diff === 0) return '今日';
  if (diff === 1) return '明日';
  if (diff === -1) return '昨日';
  if (diff < -1) return `${Math.abs(diff)}日前`;

  const d = parseDateStr(dueDateStr);
  if (!d) return dueDateStr;
  const today = parseDateStr(todayStr);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const wd = WEEKDAY_JA[d.getDay()];
  if (today && d.getFullYear() !== today.getFullYear()) {
    return `${d.getFullYear()}年${m}月${day}日 (${wd})`;
  }
  return `${m}月${day}日 (${wd})`;
}

/**
 * ヘッダー用の今日の日付表示（例: 11月22日 (日)）
 */
export function formatHeaderDate(todayStr = toDateStr()) {
  const d = parseDateStr(todayStr);
  if (!d) return '';
  return `${d.getMonth() + 1}月${d.getDate()}日 (${WEEKDAY_JA[d.getDay()]})`;
}

export { WEEKDAY_JA };
