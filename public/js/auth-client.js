(function (root) {
  const STORAGE_KEY = "qazakx_olympiad_store_v2";
  let supabaseClient = null;
  let currentUser = null;
  let core = root.QazAkxActivityCore || {};

  function loadLocalStore() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveLocalStore(store) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store || {}));
  }

  function redirectTo() {
    return window.location.origin.replace(/\/+$/, "") + "/auth/callback";
  }

  async function loadConfig() {
    const res = await fetch("/api/public-config", { cache: "no-store" });
    const data = await res.json();
    return data && data.supabase ? data.supabase : { configured: false };
  }

  async function initSupabase() {
    const cfg = await loadConfig();
    if (!cfg.configured || !root.supabase) return { configured: false };
    supabaseClient = root.supabase.createClient(cfg.url, cfg.publishableKey, {
      auth: { persistSession: true, detectSessionInUrl: true, autoRefreshToken: true },
    });
    const { data } = await supabaseClient.auth.getSession();
    currentUser = data && data.session ? data.session.user : null;
    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      currentUser = session ? session.user : null;
      if (currentUser) {
        await mergeAndSync();
      }
      if (typeof root.onQazAkxAuthChange === "function") {
        root.onQazAkxAuthChange(currentUser);
      }
    });
    if (currentUser) await mergeAndSync();
    return { configured: true, user: currentUser };
  }

  async function signInWithGoogle() {
    if (!supabaseClient) throw new Error("AUTH_NOT_CONFIGURED");
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo() },
    });
    if (error) throw error;
  }

  async function signInWithPassword(email, password) {
    if (!supabaseClient) throw new Error("AUTH_NOT_CONFIGURED");
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    currentUser = data.user;
    await mergeAndSync();
    return data.user;
  }

  async function signUpWithPassword(email, password) {
    if (!supabaseClient) throw new Error("AUTH_NOT_CONFIGURED");
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectTo() },
    });
    if (error) throw error;
    return data.user;
  }

  async function sendPasswordReset(email) {
    if (!supabaseClient) throw new Error("AUTH_NOT_CONFIGURED");
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin.replace(/\/+$/, "") + "/auth/reset",
    });
    if (error) throw error;
  }

  async function updatePassword(newPassword) {
    if (!supabaseClient) throw new Error("AUTH_NOT_CONFIGURED");
    const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

  async function signOut() {
    if (!supabaseClient) return;
    await supabaseClient.auth.signOut();
    currentUser = null;
  }

  async function fetchCloudStore() {
    if (!supabaseClient || !currentUser) return {};
    const { data, error } = await supabaseClient.from("user_progress").select("*").eq("user_id", currentUser.id);
    if (error) throw error;
    return core.cloudRowsToStore ? core.cloudRowsToStore(data || []) : {};
  }

  async function upsertCloud(store) {
    if (!supabaseClient || !currentUser || !core.storeToCloudRows) return;
    const rows = core.storeToCloudRows(store, currentUser.id);
    if (!rows.length) return;
    const { error } = await supabaseClient.from("user_progress").upsert(rows, {
      onConflict: "user_id,olympiad_id,task_id",
    });
    if (error) throw error;
  }

  async function mergeAndSync() {
    if (!currentUser || !core.mergeProgressStores) return loadLocalStore();
    const local = loadLocalStore();
    let cloud = {};
    try {
      cloud = await fetchCloudStore();
    } catch (err) {
      console.warn("Cloud progress fetch skipped:", err && err.message);
      return local;
    }
    const merged = core.mergeProgressStores(local, cloud);
    saveLocalStore(merged);
    try {
      await upsertCloud(merged);
    } catch (err) {
      console.warn("Cloud progress upsert skipped:", err && err.message);
    }
    return merged;
  }

  async function syncTaskToCloud(olympiadId, taskId, task) {
    if (!supabaseClient || !currentUser) return;
    const row = {
      user_id: currentUser.id,
      olympiad_id: olympiadId,
      task_id: String(taskId),
      answer: task.answer || "",
      parts: task.answers || {},
      status: task.status,
      ai_result: task.aiResult || null,
      score: task.score == null ? null : Number(task.score),
      last_saved: new Date(task.lastSaved || Date.now()).toISOString(),
      checked_at: new Date(task.checkedAt || task.lastSaved || Date.now()).toISOString(),
    };
    const { error } = await supabaseClient.from("user_progress").upsert(row, {
      onConflict: "user_id,olympiad_id,task_id",
    });
    if (error) console.warn("Cloud task sync skipped:", error.message);
  }

  root.QazAkxAuth = {
    initSupabase,
    signInWithGoogle,
    signInWithPassword,
    signUpWithPassword,
    sendPasswordReset,
    updatePassword,
    signOut,
    mergeAndSync,
    syncTaskToCloud,
    getUser: () => currentUser,
    isConfigured: () => Boolean(supabaseClient),
    loadLocalStore,
    saveLocalStore,
  };
})(typeof self !== "undefined" ? self : this);
