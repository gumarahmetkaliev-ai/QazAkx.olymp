/**
 * Статистика прогресса в стиле Codeforces: уровни задач, календарь активности, серии дней, рост баллов.
 * Чистые функции — работают и в браузере (window.QProgress), и в Node (тесты).
 *
 * Вход — данные QStore: { [setId]: { [taskNumber]: { answers, result, history: [{at, score, max}], checkedAt } } }
 */
(function (root) {
  const DAY = 86400000;

  /** Уровень задачи по лучшей попытке */
  function level(percent) {
    if (percent == null) return "none";
    if (percent >= 100) return "solved";
    if (percent >= 70) return "strong";
    if (percent > 0) return "partial";
    return "zero";
  }

  const LEVEL_LABEL = {
    solved: "Решена",
    strong: "Почти решена",
    partial: "Частично",
    zero: "0 баллов",
    none: "Не решалась",
  };

  /** Все попытки задачи (старые записи без history превращаются в одну попытку) */
  function attemptsOf(t) {
    if (!t) return [];
    if (Array.isArray(t.history) && t.history.length) return t.history.filter((h) => h && h.at && h.max);
    if (t.result && t.result.max) return [{ at: t.checkedAt || t.updatedAt || 0, score: t.result.score, max: t.result.max }];
    return [];
  }

  function pct(a) {
    return a.max ? Math.round((a.score / a.max) * 100) : 0;
  }

  /** Лучшая попытка и момент, когда задача впервые решена полностью */
  function taskSummary(t) {
    const atts = attemptsOf(t).slice().sort((a, b) => a.at - b.at);
    if (!atts.length) return { level: "none", attempts: 0, best: null, bestPercent: null, solvedAt: null };
    let best = atts[0];
    let solvedAt = null;
    for (const a of atts) {
      if (pct(a) > pct(best) || (pct(a) === pct(best) && a.score > best.score)) best = a;
      if (solvedAt == null && pct(a) >= 100) solvedAt = a.at;
    }
    const bestPercent = pct(best);
    return { level: level(bestPercent), attempts: atts.length, best, bestPercent, solvedAt };
  }

  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  /** Серии дней подряд с активностью: максимальная, текущая (сегодня или вчера), максимальная за последний год */
  function streaks(days, now = Date.now()) {
    const keys = [...days].sort();
    let max = 0;
    let run = 0;
    let prev = null;
    let maxYear = 0;
    const yearAgo = dayKey(now - 365 * DAY);
    let runYear = 0;
    for (const k of keys) {
      const cont = prev && dayKey(new Date(prev + "T12:00:00").getTime() + DAY) === k;
      run = cont ? run + 1 : 1;
      max = Math.max(max, run);
      if (k >= yearAgo) {
        runYear = cont && prev >= yearAgo ? runYear + 1 : 1;
        maxYear = Math.max(maxYear, runYear);
      }
      prev = k;
    }
    let current = 0;
    let cursor = days.has(dayKey(now)) ? now : days.has(dayKey(now - DAY)) ? now - DAY : null;
    while (cursor != null && days.has(dayKey(cursor))) {
      current++;
      cursor -= DAY;
    }
    return { max, current, maxYear };
  }

  /**
   * Сводка по всем данным.
   * @param data   QStore.all()
   * @param setsMeta Map setId → { tasks: число задач, title } (необязательно)
   */
  function summarize(data, now = Date.now()) {
    const tasks = [];
    const activity = new Map(); // dayKey → { checks, solved, score }
    for (const [setId, byNum] of Object.entries(data || {})) {
      for (const [n, t] of Object.entries(byNum || {})) {
        const s = taskSummary(t);
        if (s.level === "none") continue;
        tasks.push({ setId, number: Number(n), ...s });
        for (const a of attemptsOf(t)) {
          const k = dayKey(a.at);
          const day = activity.get(k) || { checks: 0, solved: 0, score: 0 };
          day.checks++;
          activity.set(k, day);
        }
        if (s.solvedAt) {
          const k = dayKey(s.solvedAt);
          const day = activity.get(k) || { checks: 0, solved: 0, score: 0 };
          day.solved++;
          activity.set(k, day);
        }
      }
    }
    const solved = tasks.filter((t) => t.level === "solved");
    const since = (ms) => solved.filter((t) => t.solvedAt >= now - ms).length;
    const activeDays = new Set(activity.keys());
    const totalChecks = [...activity.values()].reduce((s, d) => s + d.checks, 0);
    const score = tasks.reduce((s, t) => s + t.best.score, 0);
    const max = tasks.reduce((s, t) => s + t.best.max, 0);
    const byLevel = { solved: 0, strong: 0, partial: 0, zero: 0 };
    for (const t of tasks) byLevel[t.level]++;
    return {
      tasks,
      activity,
      solvedTotal: solved.length,
      solvedYear: since(365 * DAY),
      solvedMonth: since(30 * DAY),
      attempted: tasks.length,
      totalChecks,
      score: Math.round(score * 10) / 10,
      percent: max ? Math.round((score / max) * 100) : 0,
      byLevel,
      streak: streaks(activeDays, now),
    };
  }

  /** Рост суммы лучших баллов по дням (для графика) */
  function scoreTimeline(data) {
    const events = [];
    for (const byNum of Object.values(data || {})) {
      for (const t of Object.values(byNum || {})) {
        let best = 0;
        for (const a of attemptsOf(t).slice().sort((x, y) => x.at - y.at)) {
          if (a.score > best) {
            events.push({ at: a.at, delta: a.score - best });
            best = a.score;
          }
        }
      }
    }
    events.sort((a, b) => a.at - b.at);
    const points = [];
    let total = 0;
    for (const e of events) {
      total += e.delta;
      const k = dayKey(e.at);
      const last = points[points.length - 1];
      if (last && last.day === k) last.total = Math.round(total * 10) / 10;
      else points.push({ day: k, at: e.at, total: Math.round(total * 10) / 10 });
    }
    return points;
  }

  /** Уровень интенсивности клетки календаря (0–4), как у Codeforces */
  function heatLevel(checks) {
    if (!checks) return 0;
    if (checks === 1) return 1;
    if (checks <= 3) return 2;
    if (checks <= 6) return 3;
    return 4;
  }

  /** Клетки календаря за год: недели (колонки) × дни Пн..Вс */
  function yearGrid(year, activity) {
    const start = new Date(year, 0, 1);
    const shift = (start.getDay() + 6) % 7; // понедельник = 0
    const first = new Date(year, 0, 1 - shift);
    const weeks = [];
    const months = [];
    for (let w = 0; w < 54; w++) {
      const col = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + w * 7 + d);
        if (date.getFullYear() !== year) {
          col.push(null);
          continue;
        }
        const k = dayKey(date.getTime());
        const a = activity.get(k);
        col.push({ key: k, date, checks: a ? a.checks : 0, solved: a ? a.solved : 0, level: heatLevel(a ? a.checks : 0) });
        if (date.getDate() === 1) months.push({ week: w, month: date.getMonth() });
      }
      if (col.some(Boolean)) weeks.push(col);
    }
    return { weeks, months };
  }

  const api = { level, LEVEL_LABEL, attemptsOf, taskSummary, summarize, scoreTimeline, streaks, heatLevel, yearGrid, dayKey };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.QProgress = api;
})(typeof window !== "undefined" ? window : globalThis);
