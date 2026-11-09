/* QazAkx.olymp — каталог олимпиад, просмотр PDF, решение по пунктам и ИИ-жюри */
(function () {
  "use strict";

  const App = { catalog: null, topics: [], videos: {}, sets: {}, gradeBusy: false };
  const view = () => document.getElementById("view");
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const enc = encodeURIComponent;
  const fmt = (n) => (Math.round(n * 10) / 10).toString().replace(".", ",");

  // ---------------------------------------------------------------- data
  async function loadData() {
    const [cat, topics, videos] = await Promise.all([
      fetch("/data/catalog/chemistry.json").then((r) => r.json()),
      fetch("/data/topics.json").then((r) => r.json()).catch(() => ({ chemistry: [] })),
      fetch("/data/videos.json").then((r) => r.json()).catch(() => ({})),
    ]);
    App.catalog = cat;
    App.topics = topics.chemistry || [];
    App.videos = videos;
    App.byId = new Map(cat.olympiads.map((o) => [o.id, o]));
    App.bySet = new Map();
    for (const o of cat.olympiads) for (const m of o.materials) if (m.setId) App.bySet.set(m.setId, { olymp: o, material: m });
  }

  async function loadSet(setId) {
    if (App.sets[setId]) return App.sets[setId];
    const res = await fetch(`/api/task-set?id=${enc(setId)}`);
    if (!res.ok) throw new Error("Комплект не найден");
    const data = await res.json();
    App.sets[setId] = data.set;
    return data.set;
  }

  function topicLabel(id) {
    const t = App.topics.find((x) => x.id === id);
    return t ? t.label : id;
  }

  /** Progress of a parsed set: { checked, total, score, max, percent, weighted, weightSum } */
  function setProgress(set) {
    const saved = QStore.getSet(set.setId);
    let checked = 0, score = 0, max = 0, weighted = 0, weightSum = 0, fullMax = 0;
    for (const t of set.tasks) {
      fullMax += Number(t.total) || 0;
      const r = saved[t.number] && saved[t.number].result;
      weightSum += Number(t.weight) || 0;
      if (!r) continue;
      checked++;
      score += r.score;
      max += r.max;
      if (t.weight && r.max) weighted += (r.score / r.max) * t.weight;
    }
    return { checked, total: set.tasks.length, score, max, percent: max ? Math.round((score / max) * 100) : 0, weighted, weightSum, fullMax };
  }

  /** Cheap progress for catalog chips without loading the set */
  function quickProgress(setId) {
    const saved = QStore.getSet(setId);
    const results = Object.values(saved).map((t) => t.result).filter(Boolean);
    if (!results.length) return null;
    const score = results.reduce((s, r) => s + r.score, 0);
    const max = results.reduce((s, r) => s + r.max, 0);
    return { checked: results.length, percent: max ? Math.round((score / max) * 100) : 0 };
  }

  function pdfUrl(olymp, m, download) {
    if (m.local) return "/" + m.localPath.split("/").map(enc).join("/");
    return `/api/pdf-proxy?page=${enc(olymp.sourcePage)}&title=${enc(m.title)}${download ? "&download=1" : ""}`;
  }

  // ---------------------------------------------------------------- router
  function navigate(url, replace) {
    if (replace) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
    render();
  }

  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-link]");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target === "_blank") return;
    e.preventDefault();
    navigate(a.getAttribute("href"));
  });
  window.addEventListener("popstate", render);

  function setActiveNav(name) {
    document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === name));
  }

  async function render() {
    const path = location.pathname.replace(/\/+$/, "") || "/";
    const params = new URLSearchParams(location.search);
    window.scrollTo(0, 0);
    if (path === "/" || path === "/olympiads") {
      setActiveNav("catalog");
      return renderCatalog(params);
    }
    const m = path.match(/^\/olympiads\/([a-z0-9-]+)$/);
    if (m) {
      setActiveNav("catalog");
      return renderOlympiad(m[1], params);
    }
    if (path === "/progress") {
      setActiveNav("progress");
      return renderProgress();
    }
    if (path === "/account" || path.startsWith("/auth")) {
      setActiveNav("account");
      return renderAccount();
    }
    view().innerHTML = `<div class="page"><h1>Страница не найдена</h1><a href="/" data-link>← К олимпиадам</a></div>`;
  }

  // ---------------------------------------------------------------- catalog
  function stageList() {
    const stages = new Map();
    for (const o of App.catalog.olympiads) {
      if (!stages.has(o.stage)) stages.set(o.stage, { key: o.stage, label: o.stageLabel, group: o.stageGroup, order: o.stageOrder, count: 0, solvable: 0 });
      const s = stages.get(o.stage);
      s.count++;
      if (o.materials.some((m) => m.solvable)) s.solvable++;
    }
    return [...stages.values()].sort((a, b) => a.order - b.order);
  }

  function renderCatalog(params) {
    const stages = stageList();
    const onlyAi = params.get("ai") === "1";
    const defaultStage = (stages.find((s) => s.solvable) || stages.find((s) => s.key === "oblast") || stages[0]).key;
    const stageKey = params.get("stage") || defaultStage;
    const stage = stages.find((s) => s.key === stageKey) || stages[0];

    let items = App.catalog.olympiads.filter((o) => o.stage === stage.key);
    if (onlyAi) items = items.filter((o) => o.materials.some((m) => m.solvable));

    const byYear = new Map();
    for (const o of items) {
      const key = o.year ? String(o.year) : o.edition || "Без года";
      if (!byYear.has(key)) byYear.set(key, []);
      byYear.get(key).push(o);
    }

    const totalSolvable = App.catalog.olympiads.reduce((n, o) => n + o.materials.filter((m) => m.solvable).length, 0);
    const stageButtons = (group, title) => {
      const list = stages.filter((s) => s.group === group);
      if (!list.length) return "";
      return `<div class="stage-group">${title}</div>` +
        list.map((s) => `<button class="stage-btn ${s.key === stage.key ? "active" : ""}" data-stage="${s.key}">
          <span>${esc(s.label)}${s.solvable ? ' <span class="pill accent" title="Есть ИИ-проверка">ИИ</span>' : ""}</span><span class="count">${s.count}</span></button>`).join("");
    };

    const qs = (st, ai) => `/?stage=${st}${ai ? "&ai=1" : ""}`;

    view().innerHTML = `
      <div class="page">
        <div class="hero">
          <div>
            <h1>Олимпиады по химии</h1>
            <p>Все туры с задачами и решениями. Пиши ответ к каждому пункту — ИИ-жюри проверит по официальной схеме оценивания и подскажет, что повторить.</p>
          </div>
          <div class="pill accent">ИИ-проверка: ${totalSolvable} ${plural(totalSolvable, "комплект", "комплекта", "комплектов")}</div>
        </div>
        <div class="subjects">
          <button class="subject active">Химия</button>
          ${["Биология", "Физика", "Математика", "География", "Информатика", "Астрономия"].map((s) => `<button class="subject" disabled title="Скоро">${s}</button>`).join("")}
        </div>
        <div class="catalog">
          <aside class="card stages">${stageButtons("kz", "Казахстан")}${stageButtons("intl", "Другие олимпиады")}</aside>
          <section>
            <div class="toolbar">
              <h2 style="margin:0">${esc(stage.label)}</h2>
              <label class="toggle" style="margin-left:auto"><input type="checkbox" id="only-ai" ${onlyAi ? "checked" : ""}> Только с ИИ-проверкой</label>
            </div>
            <div class="years">
              ${byYear.size ? [...byYear.entries()].map(([year, list]) => `
                <div class="card year-row">
                  <div class="year">${esc(year)}</div>
                  <div class="grades">${list.map(gradeChip).join("")}</div>
                </div>`).join("") : `<div class="card empty">Здесь пока нет комплектов с ИИ-проверкой.</div>`}
            </div>
          </section>
        </div>
      </div>`;

    view().querySelectorAll("[data-stage]").forEach((b) => b.addEventListener("click", () => navigate(qs(b.dataset.stage, onlyAi), true)));
    document.getElementById("only-ai").addEventListener("change", (e) => navigate(qs(stage.key, e.target.checked), true));
  }

  function gradeChip(o) {
    const solvable = o.materials.filter((m) => m.solvable);
    let label = o.gradeLabel || o.edition || "Открыть";
    if (o.stage === "pagodane") label = `${o.edition || ""} · ${o.gradeLabel || ""}`.replace(/^ · | · $/g, "");
    const progresses = solvable.map((m) => quickProgress(m.setId)).filter(Boolean);
    const pct = progresses.length ? Math.round(progresses.reduce((s, p) => s + p.percent, 0) / progresses.length) : null;
    const sub = solvable.length ? `✎ ИИ-проверка${pct != null ? ` · ${pct}%` : ""}` : `${o.materials.length} PDF`;
    return `<a class="grade ${solvable.length ? "solvable" : ""}" href="/olympiads/${o.id}" data-link>
      <b>${esc(label)}</b><small>${sub}</small>${pct != null ? `<i class="bar" style="width:${Math.max(6, pct)}%"></i>` : ""}</a>`;
  }

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  // ---------------------------------------------------------------- olympiad page
  async function renderOlympiad(id, params) {
    const o = App.byId.get(id);
    if (!o) {
      view().innerHTML = `<div class="page"><a class="back" href="/" data-link>← Назад</a><h1>Олимпиада не найдена</h1></div>`;
      return;
    }
    const mats = o.materials;
    const defaultMat = mats.find((m) => m.solvable) || mats.find((m) => m.kind === "tasks") || mats[0];
    const mat = mats.find((m) => m.id === params.get("m")) || defaultMat;

    view().innerHTML = `
      <div class="page">
        <a class="back" href="/?stage=${o.stage}" data-link>← Назад</a>
        <h1>${esc(o.title)}</h1>
        <div class="tabs" role="tablist">
          ${mats.map((m) => `<button class="tab ${m.id === mat.id ? "active" : ""}" data-m="${m.id}" title="${esc(m.title)}">${esc(m.label)}${m.solvable ? '<i class="ai-dot" title="Можно решать с ИИ-проверкой"></i>' : ""}</button>`).join("")}
        </div>
        <div id="workspace"></div>
        <div class="files">
          <h3>Файлы</h3>
          <div class="card">${mats.map((m) => `
            <div class="file-row"><span>${esc(m.label)} <span class="dim small">· ${esc(m.title)}</span></span>
            <a class="btn btn-sm" href="${pdfUrl(o, m, true)}" ${m.local ? `download="${esc(m.title)}"` : ""}>Скачать</a></div>`).join("")}
          </div>
          <p class="dim small">Источник материалов: <a href="${esc(o.sourcePage)}" target="_blank" rel="noopener">olympiads.bc-pf.org</a></p>
        </div>
      </div>`;

    view().querySelectorAll(".tab").forEach((b) =>
      b.addEventListener("click", () => navigate(`/olympiads/${o.id}?m=${b.dataset.m}`, true))
    );
    const active = view().querySelector(".tab.active");
    if (active) active.scrollIntoView({ block: "nearest", inline: "center" });

    await renderWorkspace(o, mat, params);
  }

  function pdfFrame(o, m, extra = "") {
    const url = pdfUrl(o, m);
    return `<div class="pdf-wrap">
      ${extra}
      <iframe src="${url}#view=FitH" title="${esc(m.title)}" loading="lazy"></iframe>
      <div class="pdf-fallback"><p class="muted">${esc(m.title)}</p><a class="btn btn-primary" href="${url}" target="_blank" rel="noopener">Открыть PDF</a></div>
    </div>`;
  }

  async function renderWorkspace(o, mat, params) {
    const ws = document.getElementById("workspace");

    if (mat.kind === "sol") {
      const revealed = sessionStorage.getItem("reveal:" + o.id) === "1";
      const spoiler = revealed ? "" : `<div class="spoiler" id="spoiler"><h2>Решения жюри</h2>
        <p class="muted">Сначала попробуй решить сам — так подготовка работает лучше.<br>ИИ-жюри проверит ответы по этим же решениям.</p>
        <button class="btn btn-primary" id="reveal">Показать решения</button></div>`;
      ws.innerHTML = `<div class="workspace pdf-only">${pdfFrame(o, mat, spoiler)}</div>`;
      const btn = document.getElementById("reveal");
      if (btn) btn.addEventListener("click", () => {
        sessionStorage.setItem("reveal:" + o.id, "1");
        document.getElementById("spoiler").remove();
      });
      return;
    }

    if (!mat.solvable) {
      const note = mat.kind === "tasks"
        ? `<div class="note" style="margin-bottom:14px">Для этого комплекта поля ответа и ИИ-проверка ещё готовятся. Пока можно читать задания и решения.</div>`
        : "";
      ws.innerHTML = `${note}<div class="workspace pdf-only">${pdfFrame(o, mat)}</div>`;
      return;
    }

    ws.innerHTML = `<div class="workspace">${pdfFrame(o, mat)}<div class="solver" id="solver"><div class="card task-card muted">Загружаю задачи…</div></div></div>`;
    let set;
    try {
      set = await loadSet(mat.setId);
    } catch (e) {
      document.getElementById("solver").innerHTML = `<div class="card task-card">Не удалось загрузить задачи: ${esc(e.message)}</div>`;
      return;
    }
    const n = Number(params.get("t")) || set.tasks[0].number;
    const state = { o, mat, set, taskNumber: set.tasks.some((t) => t.number === n) ? n : set.tasks[0].number };
    App.solver = state;
    renderSolver();
  }

  // ---------------------------------------------------------------- solver
  function taskStatus(setId, number) {
    const saved = QStore.getTask(setId, number);
    if (saved && saved.result) {
      const p = saved.result.percent;
      return { cls: p >= 80 ? "good" : p >= 40 ? "mid" : "low", label: `${p}%` };
    }
    if (saved && saved.answers && Object.values(saved.answers).some((v) => String(v).trim())) return { cls: "draft", label: "✎" };
    return { cls: "", label: "" };
  }

  function renderSolver() {
    const { set, taskNumber } = App.solver;
    const host = document.getElementById("solver");
    if (!host) return;
    host.innerHTML = `<div class="card solver-head" id="solver-head"></div><div class="card task-card" id="task-card"></div><div id="result-host"></div>`;
    renderSolverHead();
    renderTaskCard();
    const saved = QStore.getTask(set.setId, taskNumber);
    if (saved && saved.result) renderResult(saved.result);
  }

  function renderSolverHead() {
    const { set, taskNumber } = App.solver;
    const p = setProgress(set);
    const head = document.getElementById("solver-head");
    if (!head) return;
    const weightedLine = p.checked && p.weightSum
      ? `<div class="small muted" style="margin-top:6px">Результат тура с учётом весов: <b style="color:var(--text)">${fmt(p.weighted)}</b> из ${p.weightSum}</div>`
      : "";
    head.innerHTML = `
      <div class="row"><b>Решение</b><span class="small muted">Проверено ${p.checked} из ${p.total} · ${fmt(p.score)} / ${fmt(p.fullMax || p.max)} б.</span></div>
      <div class="meter"><i style="width:${Math.round((p.checked / p.total) * 100)}%"></i></div>
      ${weightedLine}
      <div class="task-chips">${set.tasks.map((t) => {
        const st = taskStatus(set.setId, t.number);
        return `<button class="task-chip ${st.cls} ${t.number === taskNumber ? "active" : ""}" data-task="${t.number}" title="${esc(t.title)}">${t.number}${st.label && st.cls !== "draft" ? `<span class="small">· ${st.label}</span>` : st.cls === "draft" ? "·" : ""}</button>`;
      }).join("")}</div>`;
    head.querySelectorAll("[data-task]").forEach((b) =>
      b.addEventListener("click", () => {
        App.solver.taskNumber = Number(b.dataset.task);
        const url = `/olympiads/${App.solver.o.id}?m=${App.solver.mat.id}&t=${b.dataset.task}`;
        history.replaceState(null, "", url);
        renderSolver();
        document.getElementById("solver").scrollIntoView({ block: "start", behavior: "smooth" });
      })
    );
  }

  function currentTask() {
    const { set, taskNumber } = App.solver;
    return set.tasks.find((t) => t.number === taskNumber);
  }

  function renderTaskCard() {
    const { set } = App.solver;
    const task = currentTask();
    const saved = QStore.getTask(set.setId, task.number) || {};
    const answers = saved.answers || {};
    const result = saved.result;
    const card = document.getElementById("task-card");

    card.innerHTML = `
      <div class="task-title"><h2>Задача №${task.number}. ${esc(task.title)}</h2></div>
      <div class="small muted">${task.total != null ? `${fmt(task.total)} баллов` : ""}${task.weight ? ` · вес ${task.weight}%` : ""}</div>
      ${task.statement ? `<details class="statement"><summary>Условие задачи</summary><div class="statement-text">${esc(task.statement)}</div><p class="dim small">Текст извлечён из PDF — формулы и рисунки смотри в оригинале.</p></details>` : ""}
      ${task.parts.map((p) => {
        const r = result && result.parts.find((x) => x.id === p.id);
        return `<div class="part" data-part="${esc(p.id)}">
          <div class="part-head"><span class="part-id">${esc(p.id)}</span>
            ${r ? `<span class="pill ${r.verdict === "correct" ? "good" : r.verdict === "partial" ? "warn" : "bad"}">${fmt(r.score)} / ${fmt(r.max)} б.</span>` : `<span class="pill" ${p.pointsEstimated ? 'title="Оценочно: в официальной схеме нет баллов за этот пункт"' : ""}>${p.points != null ? (p.pointsEstimated ? "≈ " : "") + fmt(p.points) + " б." : ""}</span>`}
          </div>
          ${p.question ? `<p class="part-q">${esc(p.question)}</p>` : ""}
          <textarea data-answer="${esc(p.id)}" placeholder="Ход решения, расчёты и ответ. Без расчётов жюри ставит 0.">${esc(answers[p.id] || "")}</textarea>
          ${r ? verdictHtml(r) : ""}
        </div>`;
      }).join("")}
      <div class="actions">
        <button class="btn btn-primary" id="grade-btn">${result ? "Проверить ещё раз" : "Проверить задачу"}</button>
        <span class="save-state" id="save-state">${saved.updatedAt ? "Сохранено" : ""}</span>
      </div>
      <div id="grade-error" class="error" style="margin-top:10px"></div>`;

    let timer;
    card.querySelectorAll("textarea").forEach((ta) => {
      autosize(ta);
      ta.addEventListener("input", () => {
        autosize(ta);
        document.getElementById("save-state").textContent = "…";
        clearTimeout(timer);
        timer = setTimeout(() => {
          QStore.saveAnswers(set.setId, task.number, collectAnswers());
          document.getElementById("save-state").textContent = "Сохранено";
          renderSolverHead();
        }, 600);
      });
    });
    document.getElementById("grade-btn").addEventListener("click", gradeCurrent);
  }

  function autosize(ta) {
    ta.style.height = "auto";
    ta.style.height = Math.min(Math.max(ta.scrollHeight + 2, 92), 520) + "px";
  }

  function verdictHtml(r) {
    const mistakes = r.mistakes && r.mistakes.length
      ? `<ul class="verdict mistake">${r.mistakes.map((m) => `<li>${esc(m.text)} <span class="dim">— ${esc(topicLabel(m.topic))}</span></li>`).join("")}</ul>`
      : "";
    return `<div class="verdict ${r.verdict}">${esc(r.feedback || "")}${mistakes}</div>`;
  }

  function collectAnswers() {
    const out = {};
    document.querySelectorAll("#task-card textarea[data-answer]").forEach((ta) => (out[ta.dataset.answer] = ta.value));
    return out;
  }

  async function gradeCurrent() {
    if (App.gradeBusy) return;
    const { set } = App.solver;
    const task = currentTask();
    const answers = collectAnswers();
    const btn = document.getElementById("grade-btn");
    const err = document.getElementById("grade-error");
    err.textContent = "";
    if (!Object.values(answers).some((v) => v.trim())) {
      err.textContent = "Напиши ответ хотя бы на один пункт.";
      return;
    }
    QStore.saveAnswers(set.setId, task.number, answers);
    App.gradeBusy = true;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Жюри проверяет…`;
    try {
      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setId: set.setId, taskNumber: task.number, answers, lang: set.lang === "kz" ? "kz" : "ru" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Проверка не удалась");
      QStore.saveResult(set.setId, task.number, answers, data.result);
      if (App.solver && App.solver.set.setId === set.setId && App.solver.taskNumber === task.number) {
        renderSolver();
        const host = document.getElementById("result-host");
        if (host) host.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false;
      btn.textContent = "Проверить задачу";
    } finally {
      App.gradeBusy = false;
    }
  }

  function renderResult(result) {
    const host = document.getElementById("result-host");
    if (!host) return;
    const cls = result.percent >= 80 ? "good" : result.percent >= 40 ? "warn" : "bad";
    host.innerHTML = `<div class="card result-card">
      <div class="row" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div class="score-big">${fmt(result.score)} <span>/ ${fmt(result.max)} баллов</span></div>
        <span class="pill ${cls}">${result.percent}%</span>
      </div>
      ${result.summary ? `<p class="muted" style="margin:8px 0 0">${esc(result.summary)}</p>` : ""}
      ${reviewHtml(result.review)}
    </div>`;
  }

  function reviewHtml(review) {
    if (!review || !review.length) return `<div class="note" style="margin-top:14px">Ошибок по темам нет — отличная работа!</div>`;
    return `<h3 style="margin:18px 0 0">Что повторить</h3><div class="review">${review.map((t) => topicHtml(t.id, t.count)).join("")}</div>`;
  }

  function topicHtml(id, count) {
    const vids = Array.isArray(App.videos[id]) ? App.videos[id] : [];
    return `<div class="topic">
      <div class="topic-head"><b>${esc(topicLabel(id))}</b><span class="small dim">${count} ${plural(count, "ошибка", "ошибки", "ошибок")}</span></div>
      ${vids.length ? `<div class="videos">${vids.slice(0, 3).map(videoHtml).join("")}</div>` : `<div class="small dim" style="margin-top:4px">Видеоуроки по этой теме скоро появятся.</div>`}
    </div>`;
  }

  function youtubeId(url) {
    const m = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/);
    return m ? m[1] : null;
  }

  function videoHtml(v) {
    const id = youtubeId(v.url);
    if (id) {
      return `<div><div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="${esc(v.title)}" loading="lazy" allowfullscreen allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"></iframe></div>
        <div class="small" style="margin-top:4px">${esc(v.title)}${v.duration ? ` <span class="dim">· ${esc(v.duration)}</span>` : ""}</div></div>`;
    }
    return `<a class="video-link" href="${esc(v.url)}" target="_blank" rel="noopener">▶ ${esc(v.title)}</a>`;
  }

  // ---------------------------------------------------------------- progress
  function renderProgress() {
    const all = QStore.all();
    const attempts = [];
    const topicCount = new Map();
    for (const [setId, tasks] of Object.entries(all)) {
      const ref = App.bySet.get(setId);
      for (const [n, t] of Object.entries(tasks)) {
        if (!t.result) continue;
        attempts.push({ setId, n: Number(n), ref, result: t.result, at: t.checkedAt || t.updatedAt });
        for (const r of t.result.review || []) topicCount.set(r.id, (topicCount.get(r.id) || 0) + r.count);
      }
    }
    attempts.sort((a, b) => b.at - a.at);
    const score = attempts.reduce((s, a) => s + a.result.score, 0);
    const max = attempts.reduce((s, a) => s + a.result.max, 0);
    const setsStarted = new Set(Object.keys(all).filter((k) => Object.keys(all[k]).length)).size;
    const topics = [...topicCount.entries()].sort((a, b) => b[1] - a[1]);

    view().innerHTML = `<div class="page page-narrow">
      <h1>Мой прогресс</h1>
      <div class="stats">
        <div class="card stat"><b>${attempts.length}</b><span>задач проверено</span></div>
        <div class="card stat"><b>${max ? Math.round((score / max) * 100) : 0}%</b><span>средний результат</span></div>
        <div class="card stat"><b>${fmt(score)}</b><span>баллов набрано</span></div>
        <div class="card stat"><b>${setsStarted}</b><span>олимпиад начато</span></div>
      </div>
      <div class="two-col">
        <section><h2>Последние проверки</h2>
          <div class="card">${attempts.length ? attempts.slice(0, 40).map((a) => {
            const title = a.ref ? `${a.ref.olymp.title} · ${a.ref.material.label}` : a.setId;
            const href = a.ref ? `/olympiads/${a.ref.olymp.id}?m=${a.ref.material.id}&t=${a.n}` : "/";
            const cls = a.result.percent >= 80 ? "good" : a.result.percent >= 40 ? "warn" : "bad";
            return `<a class="list-row" href="${href}" data-link><span><b>Задача №${a.n}</b><br><span class="small muted">${esc(title)}</span></span>
              <span class="pill ${cls}">${fmt(a.result.score)} / ${fmt(a.result.max)}</span></a>`;
          }).join("") : `<div class="empty">Пока нет проверенных задач. <a href="/?ai=1" data-link>Выбрать олимпиаду →</a></div>`}</div>
        </section>
        <section><h2>Что повторить</h2>
          ${topics.length ? `<div class="review" style="margin:0">${topics.slice(0, 8).map(([id, c]) => topicHtml(id, c)).join("")}</div>` : `<div class="card empty">Здесь появятся темы, в которых ты ошибаешься, и видеоуроки к ним.</div>`}
        </section>
      </div>
      <p class="dim small" style="margin-top:28px">${QStore.auth.user() ? "Прогресс синхронизируется с аккаунтом." : `Прогресс хранится в этом браузере. <a href="/account" data-link>Войди</a>, чтобы не потерять его.`}</p>
    </div>`;
  }

  // ---------------------------------------------------------------- account
  const MIN_PASSWORD = 8;

  function passwordFields(label = "Пароль", autocomplete = "new-password") {
    return `
      <div class="field"><label class="small muted">${label}</label>
        <div class="pw-wrap"><input type="password" name="password" required minlength="${MIN_PASSWORD}" autocomplete="${autocomplete}">
        <button type="button" class="pw-toggle" aria-label="Показать пароль">👁</button></div></div>
      <div class="field"><label class="small muted">Повтори пароль</label>
        <input type="password" name="password2" required minlength="${MIN_PASSWORD}" autocomplete="${autocomplete}"></div>
      <p class="dim small">Минимум ${MIN_PASSWORD} символов.</p>`;
  }

  function checkPasswords(form) {
    const p1 = form.password.value;
    const p2 = form.password2 ? form.password2.value : p1;
    if (p1.length < MIN_PASSWORD) throw new Error(`Пароль должен быть не короче ${MIN_PASSWORD} символов.`);
    if (p1 !== p2) throw new Error("Пароли не совпадают.");
    return p1;
  }

  /** Обработчик формы: ошибки в #auth-error, кнопка блокируется на время запроса */
  function bindForm(form, fn) {
    const errBox = form.querySelector(".error");
    const btn = form.querySelector('button[type="submit"]');
    form.querySelectorAll(".pw-toggle").forEach((t) =>
      t.addEventListener("click", () => {
        form.querySelectorAll('input[type="password"], input[data-pw]').forEach((i) => {
          i.dataset.pw = "1";
          i.type = i.type === "password" ? "text" : "password";
        });
      })
    );
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errBox.textContent = "";
      btn.disabled = true;
      try {
        await fn();
      } catch (err) {
        errBox.textContent = err.message || "Ошибка";
      } finally {
        btn.disabled = false;
      }
    });
  }

  function renderAccount() {
    const params = new URLSearchParams(location.search);
    const path = location.pathname.replace(/\/+$/, "");
    if (!QStore.auth.isConfigured()) {
      view().innerHTML = `<div class="page"><div class="card auth-card"><h2>Аккаунт</h2>
        <p class="muted">Вход пока не настроен на этом сервере (нужны переменные Supabase, см. SUPABASE_SETUP.md). Прогресс сохраняется в этом браузере.</p></div></div>`;
      return;
    }
    const user = QStore.auth.user();

    // Переход по ссылке «сбросить пароль» из письма
    if (QStore.auth.isRecovery() || path === "/auth/reset") {
      if (!user) {
        view().innerHTML = `<div class="page"><div class="card auth-card"><h2>Новый пароль</h2>
          <p class="muted">Ссылка устарела или уже использована. Запроси новую.</p>
          <div class="actions"><a class="btn btn-primary" href="/account?mode=forgot" data-link>Восстановить пароль</a></div></div></div>`;
        return;
      }
      view().innerHTML = `<div class="page"><div class="card auth-card"><h2>Новый пароль</h2>
        <p class="muted small">Для ${esc(user.email || "")}</p>
        <form id="reset-form">${passwordFields("Новый пароль")}
          <div class="actions"><button class="btn btn-primary" type="submit">Сохранить пароль</button></div>
          <p class="error"></p></form></div></div>`;
      const form = document.getElementById("reset-form");
      bindForm(form, async () => {
        await QStore.auth.updatePassword(checkPasswords(form));
        history.replaceState(null, "", "/account");
        toast("Пароль изменён. Ты вошёл в аккаунт.");
        renderAccount();
      });
      return;
    }

    if (user) {
      view().innerHTML = `<div class="page"><div class="card auth-card"><h2>Аккаунт</h2>
        <p>${esc(user.email || "")}</p><p class="muted small">Прогресс синхронизируется между устройствами.</p>
        <div class="actions"><a class="btn" href="/progress" data-link>Мой прогресс</a><button class="btn btn-ghost" id="logout">Выйти</button></div>
        <details class="pw-change"><summary>Сменить пароль</summary>
          <form id="change-form">${passwordFields("Новый пароль")}
            <div class="actions"><button class="btn btn-primary" type="submit">Сохранить</button></div>
            <p class="error"></p></form></details></div></div>`;
      document.getElementById("logout").addEventListener("click", async () => {
        await QStore.auth.signOut();
        renderAccount();
      });
      const form = document.getElementById("change-form");
      bindForm(form, async () => {
        await QStore.auth.updatePassword(checkPasswords(form));
        form.reset();
        form.closest("details").open = false;
        toast("Пароль изменён.");
      });
      return;
    }

    const mode = ["signup", "forgot"].includes(params.get("mode")) ? params.get("mode") : "login";
    const tabs = `<div class="auth-tabs">
      <a href="/account" data-link class="${mode === "login" ? "active" : ""}">Вход</a>
      <a href="/account?mode=signup" data-link class="${mode === "signup" ? "active" : ""}">Регистрация</a></div>`;
    const google = QStore.auth.googleEnabled()
      ? `<button class="btn" id="google" type="button" style="width:100%;margin:8px 0 16px">Войти через Google</button>`
      : "";
    const emailField = `<div class="field"><label class="small muted">Email</label><input type="email" name="email" required autocomplete="email" value="${esc(params.get("email") || "")}"></div>`;

    if (mode === "forgot") {
      view().innerHTML = `<div class="page"><div class="card auth-card"><h2>Восстановление пароля</h2>
        <p class="muted small">Укажи email аккаунта — пришлём ссылку, по которой можно задать новый пароль.</p>
        <form id="forgot-form">${emailField}
          <div class="actions"><button class="btn btn-primary" type="submit">Отправить ссылку</button><a class="btn btn-ghost" href="/account" data-link>Назад ко входу</a></div>
          <p class="error"></p></form>
        <div id="forgot-done" class="notice" hidden></div></div></div>`;
      const form = document.getElementById("forgot-form");
      bindForm(form, async () => {
        await QStore.auth.resetPassword(form.email.value);
        const done = document.getElementById("forgot-done");
        done.hidden = false;
        done.innerHTML = `Если аккаунт с адресом <b>${esc(form.email.value.trim())}</b> существует, письмо со ссылкой уже в пути. Проверь «Входящие» и «Спам». Ссылка действует 1 час.`;
      });
      return;
    }

    if (mode === "signup") {
      view().innerHTML = `<div class="page"><div class="card auth-card">${tabs}
        <p class="muted small">Аккаунт нужен, чтобы прогресс сохранялся на всех устройствах.</p>${google}
        <form id="signup-form">${emailField}${passwordFields()}
          <div class="actions"><button class="btn btn-primary" type="submit">Создать аккаунт</button></div>
          <p class="error"></p></form>
        <div id="signup-done" class="notice" hidden></div></div></div>`;
      const form = document.getElementById("signup-form");
      bindForm(form, async () => {
        const d = await QStore.auth.signUp(form.email.value, checkPasswords(form));
        if (d && d.session) {
          toast("Аккаунт создан.");
          navigate("/account", true);
        } else {
          form.hidden = true;
          const done = document.getElementById("signup-done");
          done.hidden = false;
          done.innerHTML = `Почти готово! Мы отправили письмо на <b>${esc(form.email.value.trim())}</b> — открой ссылку в нём, чтобы подтвердить email и войти.`;
        }
      });
      document.getElementById("google")?.addEventListener("click", () => QStore.auth.google().catch((e) => toast(e.message)));
      return;
    }

    view().innerHTML = `<div class="page"><div class="card auth-card">${tabs}
      <p class="muted small">Войди, чтобы прогресс сохранялся на всех устройствах.</p>${google}
      <form id="login-form">${emailField}
        <div class="field"><label class="small muted">Пароль</label>
          <div class="pw-wrap"><input type="password" name="password" required autocomplete="current-password">
          <button type="button" class="pw-toggle" aria-label="Показать пароль">👁</button></div></div>
        <div class="actions" style="margin-top:6px"><button class="btn btn-primary" type="submit">Войти</button>
          <a class="small" href="/account?mode=forgot" data-link id="forgot-link">Забыли пароль?</a></div>
        <p class="error"></p></form></div></div>`;
    const form = document.getElementById("login-form");
    document.getElementById("forgot-link").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation(); // иначе общий обработчик data-link уведёт без введённого email
      navigate(`/account?mode=forgot${form.email.value ? "&email=" + enc(form.email.value.trim()) : ""}`, true);
    });
    bindForm(form, async () => {
      await QStore.auth.signIn(form.email.value, form.password.value);
      renderAccount();
    });
    document.getElementById("google")?.addEventListener("click", () => QStore.auth.google().catch((e) => toast(e.message)));
  }

  function toast(text) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  // ---------------------------------------------------------------- boot
  async function boot() {
    try {
      await loadData();
    } catch (e) {
      view().innerHTML = `<div class="page"><h1>Не удалось загрузить каталог</h1><p class="muted">${esc(e.message)}</p></div>`;
      return;
    }
    render();
    QStore.onChange(() => {
      const path = location.pathname;
      if (path === "/progress" || path === "/account" || path.startsWith("/auth")) render();
    });
    QStore.initAuth();
  }

  boot();
})();
