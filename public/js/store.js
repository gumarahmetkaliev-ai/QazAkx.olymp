/**
 * Прогресс ученика: ответы и результаты проверки по каждой задаче.
 * Хранится в localStorage, а при входе в аккаунт синхронизируется с Supabase
 * (таблица public.user_progress, см. supabase/schema.sql).
 *
 * Формат: { [setId]: { [taskNumber]: { answers, result, updatedAt, checkedAt } } }
 */
(function (root) {
  const KEY = "qazakx.progress.v3";
  let supabase = null;
  let user = null;
  const listeners = new Set();

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "{}") || {};
    } catch {
      return {};
    }
  }
  let data = load();

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {}
  }

  function emit() {
    listeners.forEach((fn) => {
      try {
        fn(data, user);
      } catch (e) {
        console.error(e);
      }
    });
  }

  function getTask(setId, n) {
    return (data[setId] && data[setId][n]) || null;
  }

  function getSet(setId) {
    return data[setId] || {};
  }

  function saveAnswers(setId, n, answers) {
    data[setId] = data[setId] || {};
    const prev = data[setId][n] || {};
    data[setId][n] = { ...prev, answers: { ...answers }, updatedAt: Date.now() };
    persist();
    scheduleCloud(setId, n);
  }

  function saveResult(setId, n, answers, result) {
    data[setId] = data[setId] || {};
    data[setId][n] = { answers: { ...answers }, result, updatedAt: Date.now(), checkedAt: Date.now() };
    persist();
    pushCloud(setId, n);
    emit();
  }

  // ---------- Supabase ----------
  const timers = new Map();
  function scheduleCloud(setId, n) {
    if (!supabase || !user) return;
    const key = setId + "#" + n;
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => pushCloud(setId, n), 2500));
  }

  async function pushCloud(setId, n) {
    if (!supabase || !user) return;
    const t = getTask(setId, n);
    if (!t) return;
    const row = {
      user_id: user.id,
      olympiad_id: setId,
      task_id: String(n),
      parts: t.answers || {},
      ai_result: t.result || null,
      score: t.result ? Math.round(t.result.score) : null,
      status: t.result ? "checked" : "draft",
      last_saved: new Date(t.updatedAt || Date.now()).toISOString(),
      checked_at: t.checkedAt ? new Date(t.checkedAt).toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("user_progress").upsert(row, { onConflict: "user_id,olympiad_id,task_id" });
    if (error) console.warn("Синхронизация не удалась:", error.message);
  }

  async function pullAndMerge() {
    if (!supabase || !user) return;
    const { data: rows, error } = await supabase.from("user_progress").select("*").eq("user_id", user.id);
    if (error) return console.warn("Не удалось загрузить прогресс:", error.message);
    const toPush = [];
    for (const r of rows || []) {
      const cloud = {
        answers: r.parts || {},
        result: r.ai_result || null,
        updatedAt: Date.parse(r.last_saved) || 0,
        checkedAt: r.checked_at ? Date.parse(r.checked_at) : null,
      };
      const local = getTask(r.olympiad_id, r.task_id);
      if (!local || (cloud.updatedAt || 0) > (local.updatedAt || 0)) {
        data[r.olympiad_id] = data[r.olympiad_id] || {};
        data[r.olympiad_id][r.task_id] = cloud;
      }
    }
    // Upload local-only / newer entries
    const cloudKeys = new Set((rows || []).map((r) => r.olympiad_id + "#" + r.task_id));
    for (const [setId, tasks] of Object.entries(data)) {
      for (const n of Object.keys(tasks)) {
        const row = (rows || []).find((r) => r.olympiad_id === setId && r.task_id === n);
        if (!cloudKeys.has(setId + "#" + n) || (tasks[n].updatedAt || 0) > (Date.parse(row && row.last_saved) || 0)) toPush.push([setId, n]);
      }
    }
    persist();
    for (const [s, n] of toPush) await pushCloud(s, n);
    emit();
  }

  async function initAuth() {
    try {
      const res = await fetch("/api/public-config", { cache: "no-store" });
      const cfg = (await res.json()).supabase || {};
      if (!cfg.configured || !root.supabase) return { configured: false };
      supabase = root.supabase.createClient(cfg.url, cfg.publishableKey, {
        auth: { persistSession: true, detectSessionInUrl: true, autoRefreshToken: true },
      });
      const { data: s } = await supabase.auth.getSession();
      user = s && s.session ? s.session.user : null;
      supabase.auth.onAuthStateChange(async (_e, session) => {
        const was = user && user.id;
        user = session ? session.user : null;
        if (user && user.id !== was) await pullAndMerge();
        emit();
      });
      if (user) await pullAndMerge();
      emit();
      return { configured: true };
    } catch (e) {
      console.warn("Авторизация недоступна:", e.message);
      return { configured: false };
    }
  }

  function redirectUrl() {
    return location.origin + "/account";
  }

  const auth = {
    isConfigured: () => Boolean(supabase),
    user: () => user,
    async google() {
      const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectUrl() } });
      if (error) throw error;
    },
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signUp(email, password) {
      const { data: d, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectUrl() } });
      if (error) throw error;
      return d;
    },
    async signOut() {
      await supabase.auth.signOut();
    },
  };

  root.QStore = {
    all: () => data,
    getTask,
    getSet,
    saveAnswers,
    saveResult,
    initAuth,
    auth,
    onChange: (fn) => listeners.add(fn),
    reset() {
      data = {};
      persist();
      emit();
    },
  };
})(window);
