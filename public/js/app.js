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
  const SUBJECTS = [
    { key: "chemistry", label: "Химия", of: "по химии" },
    { key: "biology", label: "Биология", of: "по биологии" },
    { key: "physics", label: "Физика", of: "по физике" },
    { key: "math", label: "Математика", of: "по математике" },
    { key: "informatics", label: "Информатика", of: "по информатике" },
    { key: "astronomy", label: "Астрономия", of: "по астрономии" },
    { key: "geography", label: "География", of: "по географии" },
  ];

  async function loadData() {
    const empty = { olympiads: [], stages: [] };
    const [catalogs, topics, videos] = await Promise.all([
      Promise.all(SUBJECTS.map((s) => fetch(`/data/catalog/${s.key}.json`).then((r) => (r.ok ? r.json() : empty)).catch(() => empty))),
      fetch("/data/topics.json").then((r) => r.json()).catch(() => ({ chemistry: [] })),
      fetch("/data/videos.json").then((r) => r.json()).catch(() => ({})),
    ]);
    App.catalogs = {};
    SUBJECTS.forEach((s, i) => (App.catalogs[s.key] = catalogs[i]));
    App.catalog = App.catalogs.chemistry;
    App.topics = Object.values(topics).filter(Array.isArray).flat();
    App.videos = videos;
    const all = catalogs.flatMap((c) => c.olympiads || []);
    App.byId = new Map(all.map((o) => [o.id, o]));
    App.bySet = new Map();
    for (const o of all) for (const m of o.materials) if (m.setId) App.bySet.set(m.setId, { olymp: o, material: m });
  }

  function currentSubject(params) {
    let key = params && params.get("subject");
    if (!key) {
      try {
        key = localStorage.getItem("qazakx.subject");
      } catch {}
    }
    if (!App.catalogs[key]) key = "chemistry";
    try {
      localStorage.setItem("qazakx.subject", key);
    } catch {}
    App.catalog = App.catalogs[key];
    return SUBJECTS.find((x) => x.key === key);
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
      const best = QProgress.taskSummary(saved[t.number]).best; // лучшая попытка, как в профиле
      const r = best ? { score: best.score, max: best.max } : null;
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
    const sums = Object.values(saved).map((t) => QProgress.taskSummary(t)).filter((x) => x.level !== "none");
    if (!sums.length) return null;
    const score = sums.reduce((s, x) => s + x.best.score, 0);
    const max = sums.reduce((s, x) => s + x.best.max, 0);
    return { checked: sums.length, solved: sums.filter((x) => x.level === "solved").length, percent: max ? Math.round((score / max) * 100) : 0 };
  }

  /** Полоска из клеток по задачам комплекта: цвет = уровень лучшей попытки */
  function setStrip(set) {
    return `<div class="strip">${set.tasks.map((t) => {
      const st = taskStatus(set.setId, t.number);
      return `<i class="${st.cls}" title="Задача №${t.number}${st.tip ? " — " + esc(st.tip) : " — не решалась"}"></i>`;
    }).join("")}</div>`;
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
    if (path === "/books") {
      setActiveNav("books");
      return renderBooks(params);
    }
    if (path === "/account" || path.startsWith("/auth")) {
      setActiveNav("account");
      return renderAccount();
    }
    view().innerHTML = `<div class="page"><h1>Страница не найдена</h1><a href="/" data-link>← К олимпиадам</a></div>`;
  }

  // ---------------------------------------------------------------- books
  async function renderBooks(params) {
    view().innerHTML = `<div class="page"><div class="empty">Загружаю книги…</div></div>`;
    if (!App.books) App.books = await fetch("/data/books.json").then((r) => r.json()).then((d) => d.books || []).catch(() => []);
    const books = App.books;
    const mode = params.get("by") === "book" ? "book" : "topic";
    const open = params.get("book");
    const lang = (b) => (b.lang === "ru" ? "RU" : "EN");
    const pages = (s) => (s.to && s.to !== s.p ? `с. ${s.p}–${s.to}` : `с. ${s.p}`);
    const bioTopics = App.topics.filter((t) => t.id.startsWith("bio-"));

    let body;
    if (mode === "topic") {
      body = bioTopics
        .map((t) => {
          const rows = [];
          for (const b of books) {
            const secs = b.sections.filter((x) => x.topic === t.id);
            if (!secs.length) continue;
            // главы целиком, если есть; иначе первые параграфы
            const top = secs.filter((x) => x.lvl === 0);
            const pick = (top.length ? top : secs).slice(0, 4);
            rows.push(`<div class="book"><span class="book-icon">📖</span><span><b>${esc(b.title)}</b> <span class="tag">${lang(b)}</span><br>
              ${pick.map((x) => `<span class="small">${esc(x.t)} <span class="dim">· ${pages(x)}</span></span>`).join("<br>")}${secs.length > pick.length ? `<br><span class="small dim">и ещё ${secs.length - pick.length} разд.</span>` : ""}</span></div>`);
          }
          if (!rows.length) return "";
          return `<details class="card book-topic"><summary><b>${esc(t.label)}</b> <span class="dim small">· ${rows.length} ${plural(rows.length, "книга", "книги", "книг")}</span></summary><div class="books">${rows.join("")}</div></details>`;
        })
        .join("");
    } else {
      body = books
        .map((b) => {
          const chapters = [];
          let cur = null;
          for (const x of b.sections) {
            if (x.lvl === 0 || !cur) { cur = { head: x, subs: [] }; chapters.push(cur); }
            else cur.subs.push(x);
          }
          return `<details class="card book-full" ${open === b.id ? "open" : ""} id="book-${esc(b.id)}"><summary><b>${esc(b.title)}</b> <span class="tag">${lang(b)}</span><br><span class="small dim">${esc(b.authors || "")} · ${chapters.length} глав</span></summary>
            <ol class="toc">${chapters
              .map((c) => `<li><span>${esc(c.head.t)}</span> <span class="dim small">${pages(c.head)}</span>${c.subs.length ? `<ul>${c.subs.map((x) => `<li class="small">${esc(x.t)} <span class="dim">${pages(x)}</span></li>`).join("")}</ul>` : ""}</li>`)
              .join("")}</ol></details>`;
        })
        .join("");
    }

    view().innerHTML = `<div class="page">
      <h1>Книги</h1>
      <p class="dim">Что читать по каждой теме: книга, глава и страницы. После проверки задачи сайт сам подскажет нужный параграф в «Что повторить». Пока есть книги по биологии.</p>
      <div class="subjects" style="margin:12px 0">
        <a class="subject ${mode === "topic" ? "active" : ""}" href="/books" data-link>По темам</a>
        <a class="subject ${mode === "book" ? "active" : ""}" href="/books?by=book" data-link>По книгам</a>
      </div>
      <div class="book-list">${body || `<div class="empty">Книг пока нет.</div>`}</div>
      <p class="small dim" style="margin-top:16px">Номера страниц — по изданиям: Campbell 11th ed., Alberts MBC 6th ed., Vander's, Raven 8th ed., Cummings «Concepts of Genetics», Schaum's Genetics, Грин–Стаут–Тейлор (3 тома), «Зоология позвоночных», Шарова «Зоология беспозвоночных».</p>
    </div>`;
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
    const subject = currentSubject(params);
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

    const qs = (st, ai) => `/?subject=${subject.key}&stage=${st}${ai ? "&ai=1" : ""}`;

    view().innerHTML = `
      <div class="page">
        <div class="hero">
          <div>
            <h1>Олимпиады ${subject.of}</h1>
            <p>Все туры с задачами и решениями. Пиши ответ к каждому пункту — ${subject.key === "biology" ? "сайт проверит по официальным ключам, а открытые вопросы — ИИ-жюри," : subject.key === "math" ? "ИИ-жюри проверит доказательство по официальному решению" : subject.key === "informatics" ? "ИИ-жюри разберёт алгоритм (код не запускается)" : "ИИ-жюри проверит по официальной схеме оценивания"} и подскажет, что повторить.</p>
          </div>
          <div class="pill accent">ИИ-проверка: ${totalSolvable} ${plural(totalSolvable, "комплект", "комплекта", "комплектов")}</div>
        </div>
        <div class="subjects">
          ${SUBJECTS.map((x) => `<a class="subject ${x.key === subject.key ? "active" : ""}" href="/?subject=${x.key}" data-link>${x.label}</a>`).join("")}
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
    const solved = progresses.reduce((s, p) => s + p.solved, 0);
    const sub = !solvable.length
      ? `${o.materials.length} PDF`
      : pct == null
        ? "✎ ИИ-проверка"
        : `${solved ? `✓ ${solved} ${plural(solved, "решена", "решены", "решено")} · ` : ""}${pct}%`;
    const lvl = pct == null ? "" : `lvl-${QProgress.level(pct)}`;
    return `<a class="grade ${solvable.length ? "solvable" : ""}" href="/olympiads/${o.id}" data-link>
      <b>${esc(label)}</b><small>${sub}</small>${pct != null ? `<i class="bar ${lvl}" style="width:${Math.max(6, pct)}%"></i>` : ""}</a>`;
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
        <a class="back" href="/?subject=${o.subject || "chemistry"}&stage=${o.stage}" data-link>← Назад</a>
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
    const sum = QProgress.taskSummary(saved);
    if (sum.level !== "none") {
      const tip = `${QProgress.LEVEL_LABEL[sum.level]} · лучшая попытка ${fmt(sum.best.score)}/${fmt(sum.best.max)} (${sum.bestPercent}%) · попыток: ${sum.attempts}`;
      return { cls: `lvl-${sum.level}`, label: sum.level === "solved" ? "✓" : `${sum.bestPercent}%`, tip };
    }
    if (saved && saved.answers && Object.values(saved.answers).some((v) => String(v).trim())) return { cls: "draft", label: "✎", tip: "Черновик" };
    return { cls: "", label: "", tip: "" };
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
      ${set.noSolution ? `<div class="small muted" style="margin-top:6px">ℹ Официального решения к этому туру нет — ИИ-жюри оценит ответ по существу.</div>` : ""}
      ${set.wholeDocument ? `<div class="small muted" style="margin-top:6px">ℹ Задания этого тура не удалось разбить по пунктам — пиши все ответы в одно поле, подписывая номер задачи.</div>` : ""}
      <div class="task-chips">${set.tasks.map((t) => {
        const st = taskStatus(set.setId, t.number);
        return `<button class="task-chip ${st.cls} ${t.number === taskNumber ? "active" : ""}" data-task="${t.number}" title="${esc(t.title + (st.tip ? " — " + st.tip : ""))}">${t.number}${st.label && st.cls !== "draft" ? `<span class="small">${st.label}</span>` : st.cls === "draft" ? "·" : ""}</button>`;
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
          ${p.kind === "choice" ? choiceHtml(p, answers[p.id], r) : `<textarea data-answer="${esc(p.id)}" placeholder="Ход решения, расчёты и ответ. Без расчётов жюри ставит 0.">${esc(answers[p.id] || "")}</textarea>`}
          ${r ? (p.kind === "choice" ? `<div class="choice-verdict ${r.verdict}">${esc(r.feedback)}</div>` : verdictHtml(r)) : ""}
        </div>`;
      }).join("")}
      <div class="actions">
        <button class="btn btn-primary" id="grade-btn">${result ? "Проверить ещё раз" : "Проверить задачу"}</button>
        <span class="save-state" id="save-state">${saved.updatedAt ? "Сохранено" : ""}</span>
      </div>
      <div id="grade-error" class="error" style="margin-top:10px"></div>`;

    let timer;
    // Тестовые вопросы: выбор варианта сразу сохраняется
    card.querySelectorAll(".choice-btn").forEach((btn) =>
      btn.addEventListener("click", () => {
        const box = btn.closest(".choices");
        const input = box.querySelector("input[data-answer]");
        const multi = box.dataset.multi === "1";
        const cur = new Set(input.value.split("").filter(Boolean));
        if (multi) cur.has(btn.dataset.key) ? cur.delete(btn.dataset.key) : cur.add(btn.dataset.key);
        else {
          const had = cur.has(btn.dataset.key);
          cur.clear();
          if (!had) cur.add(btn.dataset.key);
        }
        input.value = [...cur].sort().join("");
        box.querySelectorAll(".choice-btn").forEach((b) => b.classList.toggle("on", cur.has(b.dataset.key)));
        QStore.saveAnswers(set.setId, task.number, collectAnswers());
        document.getElementById("save-state").textContent = "Сохранено";
      })
    );
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
    document.querySelectorAll("#task-card textarea[data-answer], #task-card input[data-answer]").forEach((el) => (out[el.dataset.answer] = el.value));
    return out;
  }

  /** Варианты ответа тестового вопроса: кнопки A–E с текстом варианта */
  function choiceHtml(p, value, r) {
    const chosen = new Set(String(value || "").split(""));
    const opts = p.options && p.options.length >= 2 ? p.options : (p.choices || []).map((k) => ({ key: k, text: "" }));
    return `<div class="choices ${r ? "graded" : ""}" data-multi="${p.multi ? 1 : 0}">
      <input type="hidden" data-answer="${esc(p.id)}" value="${esc(value || "")}">
      ${p.multi ? `<div class="small dim">Несколько верных ответов</div>` : ""}
      ${opts.map((o) => `<button type="button" class="choice-btn ${chosen.has(o.key) ? "on" : ""}" data-key="${o.key}"><b>${o.key}</b>${o.text ? `<span>${esc(o.text)}</span>` : ""}</button>`).join("")}
    </div>`;
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
    return `<h3 style="margin:18px 0 0">Что повторить</h3><div class="review">${review.map((t) => topicHtml(t.id, t.count, t.books)).join("")}</div>`;
  }

  function topicHtml(id, count, books) {
    const vids = Array.isArray(App.videos[id]) ? App.videos[id] : [];
    const bookList = Array.isArray(books) && books.length
      ? `<div class="books">${books.map((b) => `<div class="book"><span class="book-icon">📖</span><span><b>${esc(b.title)}</b>${b.authors ? ` <span class="dim">— ${esc(b.authors)}</span>` : ""}<br>
          <span class="small">${b.chapter ? `${esc(b.chapter)} → ` : ""}${esc(b.section)}, с. ${esc(b.pages)}</span></span></div>`).join("")}</div>`
      : "";
    return `<div class="topic">
      <div class="topic-head"><b>${esc(topicLabel(id))}</b><span class="small dim">${count} ${plural(count, "ошибка", "ошибки", "ошибок")}</span></div>
      ${bookList}
      ${vids.length ? `<div class="videos">${vids.slice(0, 3).map(videoHtml).join("")}</div>` : bookList ? "" : `<div class="small dim" style="margin-top:4px">Видеоуроки по этой теме скоро появятся.</div>`}
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
  const MONTHS = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];

  function heatmapHtml(year, activity) {
    const { weeks, months } = QProgress.yearGrid(year, activity);
    const cell = 13, gap = 3, left = 30, top = 18;
    const w = left + weeks.length * (cell + gap), h = top + 7 * (cell + gap);
    const rects = weeks.map((col, wi) => col.map((d, di) => {
      if (!d) return "";
      const tip = `${d.date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}: ${d.checks ? `${d.checks} ${plural(d.checks, "проверка", "проверки", "проверок")}${d.solved ? `, решено ${d.solved}` : ""}` : "нет активности"}`;
      return `<rect x="${left + wi * (cell + gap)}" y="${top + di * (cell + gap)}" width="${cell}" height="${cell}" rx="2" class="hm hm${d.level}${d.solved ? " hm-solved" : ""}"><title>${tip}</title></rect>`;
    }).join("")).join("");
    const monthLabels = months.map((m) => `<text x="${left + m.week * (cell + gap)}" y="11" class="hm-label">${MONTHS[m.month]}</text>`).join("");
    const dayLabels = ["Пн", "", "Ср", "", "Пт", "", "Вс"].map((d, i) => (d ? `<text x="0" y="${top + i * (cell + gap) + 10}" class="hm-label">${d}</text>` : "")).join("");
    return `<svg class="heatmap" viewBox="0 0 ${w} ${h}" role="img" aria-label="Активность за ${year} год">${monthLabels}${dayLabels}${rects}</svg>
      <div class="hm-legend small dim">меньше <i class="hm0"></i><i class="hm1"></i><i class="hm2"></i><i class="hm3"></i><i class="hm4"></i> больше · <i class="hm2 hm-solved"></i> есть решённая задача</div>`;
  }

  function timelineHtml(points) {
    if (points.length < 2) return `<div class="empty small">График появится после проверок в разные дни.</div>`;
    const W = 640, H = 200, L = 40, R = 12, T = 12, B = 26;
    const t0 = points[0].at, t1 = points[points.length - 1].at;
    const maxY = Math.max(10, ...points.map((p) => p.total));
    const step = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((st) => maxY / st <= 5) || 2000;
    const niceMax = Math.ceil(maxY / step) * step;
    const x = (t) => L + (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * (W - L - R));
    const y = (v) => T + (1 - v / niceMax) * (H - T - B);
    const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y(p.total).toFixed(1)}`).join(" ");
    const grid = Array.from({ length: niceMax / step + 1 }, (_, i) => i * step).map((v) => {
      return `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="tl-grid"/><text x="${L - 6}" y="${y(v) + 4}" class="tl-label" text-anchor="end">${v}</text>`;
    }).join("");
    const fmtD = (t) => new Date(t).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
    const dots = points.map((p) => `<circle cx="${x(p.at).toFixed(1)}" cy="${y(p.total).toFixed(1)}" r="3.5" class="tl-dot"><title>${fmtD(p.at)}: ${fmt(p.total)} б.</title></circle>`).join("");
    return `<svg class="timeline" viewBox="0 0 ${W} ${H}" role="img" aria-label="Рост баллов">${grid}
      <path d="${path} L${x(t1).toFixed(1)},${y(0)} L${x(t0).toFixed(1)},${y(0)} Z" class="tl-area"/><path d="${path}" class="tl-line"/>${dots}
      <text x="${L}" y="${H - 6}" class="tl-label">${fmtD(t0)}</text><text x="${W - R}" y="${H - 6}" class="tl-label" text-anchor="end">${fmtD(t1)}</text></svg>`;
  }

  async function renderProgress() {
    const all = QStore.all();
    const sum = QProgress.summarize(all);
    const years = [...new Set([new Date().getFullYear(), ...[...sum.activity.keys()].map((k) => Number(k.slice(0, 4)))])].sort((a, b) => b - a);
    const year = Number(new URLSearchParams(location.search).get("year")) || years[0];
    const topicCount = new Map();
    const topicBooks = new Map();
    const attempts = [];
    for (const [setId, tasks] of Object.entries(all)) {
      const ref = App.bySet.get(setId);
      for (const [n, t] of Object.entries(tasks)) {
        if (!t.result) continue;
        attempts.push({ setId, n: Number(n), ref, result: t.result, at: t.checkedAt || t.updatedAt, st: QProgress.taskSummary(t) });
        for (const r of t.result.review || []) {
          topicCount.set(r.id, (topicCount.get(r.id) || 0) + r.count);
          if (Array.isArray(r.books) && r.books.length) topicBooks.set(r.id, r.books);
        }
      }
    }
    attempts.sort((a, b) => b.at - a.at);
    const topics = [...topicCount.entries()].sort((a, b) => b[1] - a[1]);
    const setIds = [...new Set(attempts.map((a) => a.setId))];
    const L = sum.byLevel;

    view().innerHTML = `<div class="page page-narrow">
      <h1>Мой прогресс</h1>
      <div class="cf-stats card">
        <div><b>${sum.solvedTotal}</b><span>${plural(sum.solvedTotal, "задача решена", "задачи решено", "задач решено")} за всё время</span></div>
        <div><b>${sum.solvedYear}</b><span>за последний год</span></div>
        <div><b>${sum.solvedMonth}</b><span>за последний месяц</span></div>
        <div><b>${sum.streak.max} ${plural(sum.streak.max, "день", "дня", "дней")}</b><span>подряд — рекорд</span></div>
        <div><b>${sum.streak.maxYear} ${plural(sum.streak.maxYear, "день", "дня", "дней")}</b><span>подряд за последний год</span></div>
        <div><b>${sum.streak.current} ${plural(sum.streak.current, "день", "дня", "дней")}</b><span>текущая серия${sum.streak.current ? " 🔥" : ""}</span></div>
      </div>

      <div class="card cf-block">
        <div class="row"><h2 style="margin:0">Активность</h2>
          <div class="year-pick">${years.map((y) => `<a href="/progress?year=${y}" data-link class="${y === year ? "active" : ""}">${y}</a>`).join("")}</div></div>
        ${heatmapHtml(year, sum.activity)}
      </div>

      <div class="levels">
        <div class="lvl-card lvl-solved"><b>${L.solved}</b><span>решено полностью</span></div>
        <div class="lvl-card lvl-strong"><b>${L.strong}</b><span>почти (≥70%)</span></div>
        <div class="lvl-card lvl-partial"><b>${L.partial}</b><span>частично</span></div>
        <div class="lvl-card lvl-zero"><b>${L.zero}</b><span>0 баллов</span></div>
        <div class="lvl-card"><b>${sum.totalChecks}</b><span>${plural(sum.totalChecks, "проверка", "проверки", "проверок")} · ${sum.percent}% в среднем</span></div>
      </div>

      <div class="card cf-block"><div class="row"><h2 style="margin:0">Рост баллов</h2><span class="small muted">сумма лучших результатов по задачам: ${fmt(sum.score)} б.</span></div>
        ${timelineHtml(QProgress.scoreTimeline(all))}</div>

      <section class="cf-block"><h2>Олимпиады</h2>
        <div class="card" id="olymp-progress">${setIds.length ? `<div class="empty small">Загружаю…</div>` : `<div class="empty">Пока нет проверенных задач. <a href="/?subject=chemistry&ai=1" data-link>Выбрать олимпиаду →</a></div>`}</div>
      </section>

      <div class="two-col">
        <section><h2>Последние проверки</h2>
          <div class="card">${attempts.length ? attempts.slice(0, 30).map((a) => {
            const title = a.ref ? `${a.ref.olymp.title} · ${a.ref.material.label}` : a.setId;
            const href = a.ref ? `/olympiads/${a.ref.olymp.id}?m=${a.ref.material.id}&t=${a.n}` : "/";
            return `<a class="list-row" href="${href}" data-link><span><b>Задача №${a.n}</b><br><span class="small muted">${esc(title)}</span></span>
              <span class="pill lvl-${QProgress.level(a.result.percent)}">${fmt(a.result.score)} / ${fmt(a.result.max)}</span></a>`;
          }).join("") : `<div class="empty">Здесь появятся твои проверки.</div>`}</div>
        </section>
        <section><h2>Что повторить</h2>
          ${topics.length ? `<div class="review" style="margin:0">${topics.slice(0, 8).map(([id, c]) => topicHtml(id, c, topicBooks.get(id))).join("")}</div>` : `<div class="card empty">Здесь появятся темы, в которых ты ошибаешься, и что почитать по ним.</div>`}
        </section>
      </div>
      <p class="dim small" style="margin-top:28px">${QStore.auth.user() ? "Прогресс синхронизируется с аккаунтом." : `Прогресс хранится в этом браузере. <a href="/account" data-link>Войди</a>, чтобы не потерять его.`}</p>
    </div>`;

    // Комплекты: «решено N из M» + клетки задач (нужен список задач — подгружаем)
    if (setIds.length) {
      const sets = (await Promise.all(setIds.map((id) => loadSet(id).catch(() => null)))).filter(Boolean);
      const host = document.getElementById("olymp-progress");
      if (!host) return;
      const rows = sets.map((set) => {
        const ref = App.bySet.get(set.setId);
        const sums = set.tasks.map((t) => QProgress.taskSummary(QStore.getTask(set.setId, t.number)));
        const solved = sums.filter((x) => x.level === "solved").length;
        const href = ref ? `/olympiads/${ref.olymp.id}?m=${ref.material.id}` : "/";
        return { solved, total: set.tasks.length, html: `<a class="list-row olymp-row" href="${href}" data-link>
          <span><b>${esc(ref ? ref.olymp.title : set.title)}</b><br><span class="small muted">${esc(ref ? ref.material.label : "")}</span></span>
          <span class="olymp-right">${setStrip(set)}<span class="small ${solved === set.tasks.length ? "solved-all" : "muted"}">${solved === set.tasks.length ? "🏆 " : ""}решено ${solved} из ${set.tasks.length}</span></span></a>` };
      });
      rows.sort((a, b) => b.solved / b.total - a.solved / a.total);
      host.innerHTML = rows.map((r) => r.html).join("");
    }
  }

  // ---------------------------------------------------------------- account
  const MIN_PASSWORD = 8;

  function passwordFields(label = "Пароль", autocomplete = "new-password") {
    return `
      <div class="field"><label>${label}</label>
        <div class="pw-wrap input-ico"><span>🔒</span><input type="password" name="password" required minlength="${MIN_PASSWORD}" autocomplete="${autocomplete}" placeholder="Минимум ${MIN_PASSWORD} символов">
        <button type="button" class="pw-toggle" aria-label="Показать пароль">👁</button></div>
        <div class="pw-meter"><i></i></div><div class="pw-meter-label dim small">Минимум ${MIN_PASSWORD} символов</div></div>
      <div class="field"><label>Повтори пароль</label>
        <div class="input-ico"><span>🔒</span><input type="password" name="password2" required minlength="${MIN_PASSWORD}" autocomplete="${autocomplete}" placeholder="Ещё раз"></div></div>`;
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
      ? `<button class="btn btn-google" id="google" type="button"><span class="g-dot">G</span> Продолжить с Google</button><div class="auth-or"><span>или по email</span></div>`
      : "";
    const emailField = `<div class="field"><label for="f-email">Email</label><div class="input-ico"><span>✉</span><input id="f-email" type="email" name="email" required autocomplete="email" placeholder="you@example.com" value="${esc(params.get("email") || "")}"></div></div>`;

    if (mode === "forgot") {
      view().innerHTML = authShell(`
        <h2>Восстановление пароля</h2>
        <p class="auth-sub">Укажи email аккаунта — пришлём ссылку, по которой можно задать новый пароль.</p>
        <form id="forgot-form">${emailField}
          <button class="btn btn-primary btn-block" type="submit">Отправить ссылку</button>
          <p class="error"></p></form>
        <div id="forgot-done" class="notice" hidden></div>
        <p class="auth-foot"><a href="/account" data-link>← Назад ко входу</a></p>`);
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
      view().innerHTML = authShell(`${tabs}
        <h2>Создать аккаунт</h2>
        <p class="auth-sub">Бесплатно. Прогресс и решения сохранятся на всех устройствах.</p>${google}
        <form id="signup-form">${emailField}${passwordFields()}
          <button class="btn btn-primary btn-block" type="submit">Создать аккаунт</button>
          <p class="error"></p></form>
        <div id="signup-done" class="notice" hidden></div>
        <p class="auth-foot">Уже есть аккаунт? <a href="/account" data-link>Войти</a></p>`);
      const form = document.getElementById("signup-form");
      bindStrength(form);
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

    view().innerHTML = authShell(`${tabs}
      <h2>С возвращением 👋</h2>
      <p class="auth-sub">Войди, чтобы продолжить решать с того места, где остановился.</p>${google}
      <form id="login-form">${emailField}
        <div class="field"><div class="label-row"><label for="f-pw">Пароль</label><a class="small" href="/account?mode=forgot" data-link id="forgot-link">Забыли пароль?</a></div>
          <div class="pw-wrap input-ico"><span>🔒</span><input id="f-pw" type="password" name="password" required autocomplete="current-password" placeholder="Твой пароль">
          <button type="button" class="pw-toggle" aria-label="Показать пароль">👁</button></div></div>
        <button class="btn btn-primary btn-block" type="submit">Войти</button>
        <p class="error"></p></form>
      <p class="auth-foot">Нет аккаунта? <a href="/account?mode=signup" data-link>Зарегистрироваться</a></p>`);
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

  /** Двухпанельная обёртка страницы входа/регистрации */
  function authShell(inner) {
    return `<div class="page auth-page"><div class="auth-shell">
      <aside class="auth-side">
        <div class="auth-brand">QazAkx<span>.olymp</span></div>
        <h3>Готовься к олимпиадам как чемпион</h3>
        <ul class="auth-perks">
          <li><span>🏆</span><div><b>7 предметов, 1400+ олимпиад</b><br>Районные, областные, республиканские и международные туры</div></li>
          <li><span>🤖</span><div><b>ИИ-жюри</b><br>Проверяет решение по официальной схеме и объясняет ошибки</div></li>
          <li><span>📈</span><div><b>Прогресс как на Codeforces</b><br>Календарь активности, серии, уровни задач</div></li>
          <li><span>📖</span><div><b>Что повторить</b><br>Книга, глава и страницы по каждой ошибке</div></li>
        </ul>
      </aside>
      <div class="auth-main">${inner}</div>
    </div></div>`;
  }

  /** Индикатор надёжности пароля */
  function bindStrength(form) {
    const input = form.password;
    const bar = form.querySelector(".pw-meter i");
    const label = form.querySelector(".pw-meter-label");
    if (!input || !bar) return;
    input.addEventListener("input", () => {
      const v = input.value;
      let sc = 0;
      if (v.length >= MIN_PASSWORD) sc++;
      if (v.length >= 10) sc++;
      if (/[A-ZА-Я]/.test(v) && /[a-zа-я]/.test(v)) sc++;
      if (/\d/.test(v) && /[^\w\s]|_/.test(v)) sc++;
      const lv = [
        ["0%", "var(--line-2)", `Минимум ${MIN_PASSWORD} символов`],
        ["30%", "var(--bad)", "Слабый"],
        ["55%", "var(--warn)", "Средний"],
        ["80%", "var(--good)", "Хороший"],
        ["100%", "var(--good)", "Надёжный"],
      ][v ? Math.max(1, sc) : 0];
      bar.style.width = lv[0];
      bar.style.background = lv[1];
      label.textContent = lv[2];
    });
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
