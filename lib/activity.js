/**
 * QazAKx Activity Grid — pure aggregation.
 * QUALIFIED TASK: AI-checked AND score >= 75.
 * Unique per olympiadId + taskId + localDate.
 */

const QUALIFIED_THRESHOLD = 75;
const DAILY_GOAL = 5;

function toLocalDateKey(value, now = new Date()) {
  const date = value instanceof Date ? value : new Date(value || now);
  if (Number.isNaN(date.getTime())) return toLocalDateKey(now);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function scoreOf(record) {
  const score = Number(record && record.score);
  if (!Number.isFinite(score)) return null;
  const maxScore = Number(record && record.maxScore);
  if (Number.isFinite(maxScore) && maxScore > 0 && maxScore !== 100 && score <= maxScore) {
    return Math.round((score / maxScore) * 100);
  }
  return Math.round(score);
}

function isAiChecked(record) {
  if (!record) return false;
  const status = String(record.status || "");
  if (status.startsWith("CHECKED_")) return true;
  if (record.aiResult && (record.aiResult.text || record.aiResult.verdict)) return true;
  return Number.isFinite(Number(record.score)) && Number(record.score) >= 0;
}

function isQualified(record) {
  if (!isAiChecked(record)) return false;
  const pct = scoreOf(record);
  return pct !== null && pct >= QUALIFIED_THRESHOLD;
}

function flattenStore(store) {
  const records = [];
  const root = store && typeof store === "object" ? store : {};
  Object.keys(root).forEach((olympiadId) => {
    const olymp = root[olympiadId] || {};
    const tasks = olymp.tasks || {};
    Object.keys(tasks).forEach((taskId) => {
      const task = tasks[taskId] || {};
      records.push({
        olympiadId: olymp.olympiadId || olympiadId,
        taskId: String(task.taskId || task.id || task.number || taskId),
        number: task.number,
        answer: task.answer || "",
        answers: task.answers || {},
        status: task.status || "NOT_STARTED",
        score: task.score,
        maxScore: task.maxScore || 10,
        aiResult: task.aiResult || null,
        lastSaved: task.lastSaved || olymp.lastSaved || Date.now(),
        checkedAt: task.checkedAt || task.lastSaved || olymp.lastSaved || Date.now(),
      });
    });
  });
  return records;
}

function pickBetterRecord(a, b) {
  if (!a) return b;
  if (!b) return a;
  const scoreA = scoreOf(a);
  const scoreB = scoreOf(b);
  const sa = scoreA === null ? -1 : scoreA;
  const sb = scoreB === null ? -1 : scoreB;
  if (sb > sa) return b;
  if (sa > sb) return a;
  const ta = Number(a.checkedAt || a.lastSaved || 0);
  const tb = Number(b.checkedAt || b.lastSaved || 0);
  return tb >= ta ? b : a;
}

function mergeProgressStores(localStore, cloudStore) {
  const merged = {};
  const apply = (source) => {
    const records = flattenStore(source);
    records.forEach((rec) => {
      if (!merged[rec.olympiadId]) {
        merged[rec.olympiadId] = { olympiadId: rec.olympiadId, tasks: {}, lastSaved: rec.lastSaved };
      }
      const existing = merged[rec.olympiadId].tasks[rec.taskId];
      const winner = pickBetterRecord(existing, rec);
      merged[rec.olympiadId].tasks[rec.taskId] = winner;
      merged[rec.olympiadId].lastSaved = Math.max(
        Number(merged[rec.olympiadId].lastSaved || 0),
        Number(winner.lastSaved || 0)
      );
    });
  };
  apply(localStore);
  apply(cloudStore);
  return merged;
}

function intensity(count) {
  if (!count || count <= 0) return 0;
  if (count >= 5) return 5;
  return count;
}

function buildDayMap(records, now = new Date()) {
  const days = {};
  (records || []).forEach((rec) => {
    if (!isQualified(rec)) return;
    const dateKey = toLocalDateKey(rec.checkedAt || rec.lastSaved, now);
    const uniqueKey = `${rec.olympiadId}::${rec.taskId}::${dateKey}`;
    if (!days[dateKey]) {
      days[dateKey] = { date: dateKey, unique: new Map(), scores: [] };
    }
    const existing = days[dateKey].unique.get(uniqueKey);
    days[dateKey].unique.set(uniqueKey, pickBetterRecord(existing, rec));
  });

  const result = {};
  Object.keys(days).forEach((dateKey) => {
    const tasks = Array.from(days[dateKey].unique.values());
    const scores = tasks.map((t) => scoreOf(t)).filter((s) => s !== null);
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const count = tasks.length;
    result[dateKey] = {
      date: dateKey,
      count,
      remaining: Math.max(0, DAILY_GOAL - count),
      completed: count >= DAILY_GOAL,
      intensity: intensity(count),
      averageScore: avg,
      tasks: tasks.map((t) => ({
        olympiadId: t.olympiadId,
        taskId: t.taskId,
        number: t.number,
        score: scoreOf(t),
        status: t.status,
      })),
    };
  });
  return result;
}

function eachDateKey(fromDate, toDate) {
  const keys = [];
  const cur = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const end = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
  while (cur <= end) {
    keys.push(toLocalDateKey(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return keys;
}

function startOfWeekMonday(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d;
}

function buildHeatmapRange(now = new Date()) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 1);
  start.setDate(start.getDate() + 1);
  const gridStart = startOfWeekMonday(start);
  return { start, end, gridStart, days: eachDateKey(gridStart, end) };
}

function computeStreaks(dayMap, now = new Date()) {
  const { start, end } = buildHeatmapRange(now);
  const keys = eachDateKey(start, end);
  let longest = 0;
  let run = 0;
  keys.forEach((key) => {
    const day = dayMap[key];
    if (day && day.count >= DAILY_GOAL) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  });

  let current = 0;
  const cursor = new Date(end);
  const todayKey = toLocalDateKey(end);
  const today = dayMap[todayKey];
  if (!today || today.count < DAILY_GOAL) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (true) {
    const key = toLocalDateKey(cursor);
    const day = dayMap[key];
    if (day && day.count >= DAILY_GOAL) {
      current += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return { current, longest };
}

function periodBounds(now = new Date()) {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = startOfWeekMonday(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return { todayStart, weekStart, monthStart };
}

function inRange(ts, from) {
  return Number(ts) >= from.getTime();
}

function computeStatistics(records, now = new Date()) {
  const checked = (records || []).filter(isAiChecked);
  const uniqueChecked = new Map();
  checked.forEach((rec) => {
    const key = `${rec.olympiadId}::${rec.taskId}`;
    uniqueChecked.set(key, pickBetterRecord(uniqueChecked.get(key), rec));
  });
  const uniqueList = Array.from(uniqueChecked.values());
  const qualifiedAll = uniqueList.filter(isQualified);
  const scores = uniqueList.map(scoreOf).filter((s) => s !== null);
  const averageScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const dayMap = buildDayMap(records, now);
  const streaks = computeStreaks(dayMap, now);
  const { todayStart, weekStart, monthStart } = periodBounds(now);

  const countQualifiedIn = (from) => {
    const map = new Map();
    qualifiedAll.forEach((rec) => {
      if (!inRange(rec.checkedAt || rec.lastSaved, from)) return;
      map.set(`${rec.olympiadId}::${rec.taskId}`, rec);
    });
    return map.size;
  };

  const todayKey = toLocalDateKey(now);
  const todayDay = dayMap[todayKey] || { count: 0, remaining: DAILY_GOAL, completed: false, averageScore: 0, tasks: [] };

  return {
    tasksChecked: uniqueList.length,
    qualifiedTasks: qualifiedAll.length,
    averageScore,
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
    today: todayDay.count,
    thisWeek: countQualifiedIn(weekStart),
    thisMonth: countQualifiedIn(monthStart),
    dailyGoal: DAILY_GOAL,
    todayProgress: todayDay,
    dayMap,
  };
}

function formatDayTooltip(day, locale = "en-US") {
  if (!day) return "";
  const [y, m, d] = day.date.split("-").map(Number);
  const pretty = new Date(y, m - 1, d).toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  if (day.completed) {
    return `${pretty}\n${day.count} qualified tasks\nDaily goal completed\nAverage score: ${day.averageScore}%`;
  }
  return `${pretty}\n${day.count} qualified tasks\n${day.remaining} task remaining\nAverage score: ${day.averageScore}%`;
}

function cloudRowsToStore(rows) {
  const store = {};
  (rows || []).forEach((row) => {
    const olympiadId = row.olympiad_id;
    const taskId = String(row.task_id);
    if (!store[olympiadId]) store[olympiadId] = { olympiadId, tasks: {}, lastSaved: 0 };
    store[olympiadId].tasks[taskId] = {
      taskId,
      number: row.number || taskId,
      answer: row.answer || "",
      answers: row.parts || {},
      status: row.status || "NOT_STARTED",
      score: row.score,
      maxScore: row.max_score || 10,
      aiResult: row.ai_result || null,
      lastSaved: row.last_saved ? new Date(row.last_saved).getTime() : Date.now(),
      checkedAt: row.checked_at ? new Date(row.checked_at).getTime() : (row.updated_at ? new Date(row.updated_at).getTime() : Date.now()),
    };
    store[olympiadId].lastSaved = Math.max(store[olympiadId].lastSaved, store[olympiadId].tasks[taskId].lastSaved);
  });
  return store;
}

function storeToCloudRows(store, userId) {
  return flattenStore(store).map((rec) => ({
    user_id: userId,
    olympiad_id: rec.olympiadId,
    task_id: rec.taskId,
    answer: rec.answer || "",
    parts: rec.answers || {},
    status: rec.status,
    ai_result: rec.aiResult,
    score: rec.score == null ? null : Number(rec.score),
    last_saved: new Date(rec.lastSaved || Date.now()).toISOString(),
    checked_at: new Date(rec.checkedAt || rec.lastSaved || Date.now()).toISOString(),
  }));
}

const api = {
  QUALIFIED_THRESHOLD,
  DAILY_GOAL,
  toLocalDateKey,
  scoreOf,
  isAiChecked,
  isQualified,
  flattenStore,
  pickBetterRecord,
  mergeProgressStores,
  intensity,
  buildDayMap,
  buildHeatmapRange,
  computeStreaks,
  computeStatistics,
  formatDayTooltip,
  cloudRowsToStore,
  storeToCloudRows,
};

if (typeof module === "object" && module.exports) {
  module.exports = api;
}
if (typeof window !== "undefined") {
  window.QazAkxActivityCore = api;
}
