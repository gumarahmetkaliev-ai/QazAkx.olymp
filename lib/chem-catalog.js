/**
 * Chemistry catalog builder.
 *
 * Turns the raw list of olympiad source pages (olympiads.bc-pf.org) and the PDF
 * files found on them into a clean hierarchy:
 *   Этап → Год → Класс → материалы (вкладки «1 тур (Задачи)», «1 тур (Решения)» …)
 * and pairs every «Задачи» PDF with its «Решения» PDF so the solver knows which
 * official solution to grade against.
 *
 * Pure functions only — used by scripts/build-catalog.js and tests.
 */

const PAGE_ORIGIN = "https://olympiads.bc-pf.org";

const STAGES = {
  region: { label: "Районная", group: "kz", order: 1 },
  oblast: { label: "Областная", group: "kz", order: 2 },
  national: { label: "Республиканская", group: "kz", order: 3 },
  president: { label: "Президентская", group: "kz", order: 4 },
  junior: { label: "Junior", group: "kz", order: 5 },
  kaz_sbory: { label: "Сборы сборной РК", group: "kz", order: 6 },
  beyondolymp: { label: "BeyondOlympiad", group: "kz", order: 7 },
  nchb: { label: "NChB", group: "kz", order: 8 },
  icho: { label: "IChO (международная)", group: "intl", order: 10 },
  mendel: { label: "Менделеевская", group: "intl", order: 11 },
  bcho: { label: "Балтийская (BChO)", group: "intl", order: 12 },
  vseros: { label: "Всеросс — заключительный", group: "intl", order: 13 },
  vserossregion: { label: "Всеросс — региональный", group: "intl", order: 14 },
  vsesib_otb: { label: "Всесибирская — отборочный", group: "intl", order: 15 },
  vsesib_zk: { label: "Всесибирская — заключительный", group: "intl", order: 16 },
  rus_sbory: { label: "Сборы сборной РФ", group: "intl", order: 17 },
  pagodane: { label: "Pagodane", group: "intl", order: 18 },
};

const BIO_STAGES = {
  region: { label: "Районная", group: "kz", order: 1 },
  oblast: { label: "Областная", group: "kz", order: 2 },
  national: { label: "Республиканская", group: "kz", order: 3 },
  junior: { label: "Junior", group: "kz", order: 5 },
  kbo: { label: "KBO (Казахстанская)", group: "kz", order: 6 },
  beyondolymp: { label: "BeyondOlympiad", group: "kz", order: 7 },
  biophage: { label: "Biophage", group: "kz", order: 8 },
  ibo: { label: "IBO (международная)", group: "intl", order: 10 },
  iaob: { label: "IAOB", group: "intl", order: 11 },
  inbo: { label: "INBO", group: "intl", order: 12 },
  usaboopen: { label: "USABO — Open", group: "intl", order: 13 },
  usabosf: { label: "USABO — Semifinal", group: "intl", order: 14 },
  ABO: { label: "ABO (Австралия)", group: "intl", order: 15 },
  NZIBO: { label: "NZIBO (Новая Зеландия)", group: "intl", order: 16 },
  bbo: { label: "BBO (Британская)", group: "intl", order: 17 },
  utoronto: { label: "U of Toronto", group: "intl", order: 18 },
  hkgjsbo: { label: "HKGJSBO (Гонконг)", group: "intl", order: 19 },
  vso_zk: { label: "Всеросс — заключительный", group: "intl", order: 20 },
  vso_rg: { label: "Всеросс — региональный", group: "intl", order: 21 },
  vsesib_otb: { label: "Всесибирская — отборочный", group: "intl", order: 22 },
  vsesib_zk: { label: "Всесибирская — заключительный", group: "intl", order: 23 },
  pt_otb: { label: "Покори Воробьёвы горы — отборочный", group: "intl", order: 24 },
  pt_zk: { label: "Покори Воробьёвы горы — заключительный", group: "intl", order: 25 },
  pvg: { label: "Покори Воробьёвы горы", group: "intl", order: 26 },
  vsp: { label: "Высшая проба", group: "intl", order: 27 },
  belbo: { label: "Белорусская", group: "intl", order: 28 },
};

/** Предметы: префикс id и имён файлов, название, этапы */
const SUBJECTS = {
  chemistry: { prefix: "chem", label: "Химия", stages: STAGES },
  biology: { prefix: "bio", label: "Биология", stages: BIO_STAGES },
};

const KZ_STAGES_WITH_PRACTICE = new Set(["region", "oblast", "national"]);

const KIND_LABELS = {
  tasks: "Задачи",
  practice: "Практика",
  sol: "Решения",
  blank: "Бланк ответов",
  results: "Результаты",
  other: "Материалы",
};

const LANG_SUFFIX = { ru: "", kz: " на казахском", en: " на английском" };

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Parse "https://olympiads.bc-pf.org/chemistry/oblast/2023/10" (или /biology/…) → subject, stage, year, grade */
function parseSourcePage(sourcePage) {
  if (!sourcePage || !String(sourcePage).startsWith(PAGE_ORIGIN)) return null;
  const pagePath = String(sourcePage).slice(PAGE_ORIGIN.length).replace(/^\/+|\/+$/g, "");
  const parts = pagePath.split("/");
  const subject = SUBJECTS[parts[0]];
  if (!subject) return null;
  let stageKey;
  let rest;
  if (parts[1] === "s") {
    stageKey = parts[2];
    rest = parts.slice(3);
  } else {
    stageKey = parts[1];
    rest = parts.slice(2);
  }
  const stage = subject.stages[stageKey] || { label: stageKey, group: "intl", order: 99 };

  let year = null;
  let grade = null;
  let edition = null;
  if (stageKey === "pagodane" || stageKey === "biophage") {
    // pagodane/7th/11-12 or pagodane/7th/2024
    edition = rest[0] || null;
    if (/^\d{4}$/.test(rest[1] || "")) year = Number(rest[1]);
    else if (rest[1]) grade = rest[1];
  } else {
    const yearMatch = String(rest[0] || "").match(/^(\d{4})/);
    if (yearMatch) year = Number(yearMatch[1]);
    if (rest[0] && !/^\d{4}$/.test(rest[0])) edition = rest[0]; // e.g. 2021-Jun, 1999-and-older
    if (rest[1] && /^\d{1,2}$/.test(rest[1])) grade = Number(rest[1]);
  }

  return {
    subject: parts[0],
    subjectPrefix: subject.prefix,
    subjectLabel: subject.label,
    pagePath,
    stageKey,
    stageLabel: stage.label,
    stageGroup: stage.group,
    stageOrder: stage.order,
    year,
    grade,
    edition,
  };
}

/** Classify a PDF filename: kind, language, grade, round and a pairing key */
function classifyFile(filename) {
  const name = String(filename || "").replace(/\.pdf$/i, "");
  const lower = name.toLowerCase();
  let tokens = lower.split(/[-_\s]+/).filter(Boolean);

  let lang = "ru";
  let langExplicit = false;
  const langTokens = { rus: "ru", ru: "ru", kaz: "kz", qaz: "kz", kz: "kz", eng: "en", en: "en" };
  tokens = tokens.filter((t) => {
    if (langTokens[t]) {
      lang = langTokens[t];
      langExplicit = true;
      return false;
    }
    return true;
  });
  // "taskQ" style suffix (ru-7-9-tour2-taskQ)
  tokens = tokens.map((t) => (t === "taskq" ? "task" : t));

  let kind = null;
  const kindTokens = {
    tasks: "tasks", task: "tasks", problems: "tasks", zadachi: "tasks",
    sol: "sol", sols: "sol", solution: "sol", solutions: "sol", resh: "sol", answer: "sol",
    blank: "blank", asheets: "blank", answersheets: "blank", sheets: "blank",
    res: "results",
  };
  tokens = tokens.filter((t) => {
    if (kindTokens[t]) {
      // "answer" after "sheet" means answer sheet
      kind = kind === "blank" ? "blank" : kindTokens[t];
      return false;
    }
    return true;
  });
  if (/answer[-_]?sheet/.test(lower)) kind = "blank";
  if (!kind) kind = "other";

  let grade = null;
  let round = null;
  let track = null;
  const joined = tokens.join("-");

  let m;
  if ((m = joined.match(/^(?:chem|bio)(\d{1,2})(?:-(\d))?(?:-|$)/))) {
    const g = Number(m[1]);
    if (g >= 5 && g <= 12) grade = g;
    else if (m[1].length === 4) grade = `${m[1].slice(0, 2)}-${m[1].slice(2)}`; // chem1112
    else if (m[1].length === 3) grade = `${m[1][0]}-${m[1].slice(1)}`; // chem910
    if (m[2]) round = Number(m[2]);
  } else if ((m = joined.match(/^(?:chem|bio)(\d{3,4})(?:-|$)/))) {
    grade = m[1].length === 4 ? `${m[1].slice(0, 2)}-${m[1].slice(2)}` : `${m[1][0]}-${m[1].slice(1)}`;
  } else if ((m = joined.match(/^(?:chem|bio)-(\d)(?:-|$)/))) {
    round = Number(m[1]);
  }
  if (round == null && (m = joined.match(/tour(\d)/))) round = Number(m[1]);
  if ((m = joined.match(/nchb-\d{4}-(jun|sen)-(\d)/))) {
    track = m[1] === "jun" ? "Junior" : "Senior";
    round = Number(m[2]);
  }
  if (grade == null && (m = joined.match(/(?:^|-)(\d{1,2})-(\d{1,2})(?:-|$)/)) && Number(m[1]) >= 5 && Number(m[2]) <= 12) {
    grade = `${m[1]}-${m[2]}`;
  }
  if (grade == null && (m = joined.match(/(?:^|-)(\d{1,2})-tour/)) && Number(m[1]) >= 5 && Number(m[1]) <= 12) {
    grade = Number(m[1]);
  }
  if (grade == null && (m = joined.match(/(?:^|-)(?:chem|bio)-(\d{1,2})(?:-(\d{1,2}))?$/)) && Number(m[1]) >= 5) {
    grade = m[2] ? `${m[1]}-${m[2]}` : Number(m[1]);
  }
  if (/junior/.test(joined)) track = track || "Junior";
  if (/theory/.test(joined)) track = track || "Теория";
  if (/prep/.test(joined)) track = track || "Подготовительные";
  if (/practical|experiment/.test(joined)) track = track || "Практика";

  const pairKey = `${joined}|${lang}`;
  return { filename, kind, lang, langExplicit, grade, round, track, base: joined, pairKey };
}

function humanize(base, stageKey) {
  let text = String(base || "")
    .replace(/(^|-)(chem|bio|biol|\d{4})(?=-|$)/g, "$1")
    .replace(new RegExp(`^${stageKey || "^"}\\d{4}`), "")
    .replace(/-+/g, " ")
    .trim();
  if (!text || text === stageKey) text = "Теоретический тур";
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Материал";
}

function materialLabel(info, ctx) {
  const pieces = [];
  if (info.grade != null && ctx.pageGrade == null && ctx.multiGrade) pieces.push(`${info.grade} кл`);
  if (info.track && !(info.track === "Практика" && info.kind === "tasks")) pieces.push(info.track);
  if (info.round != null) pieces.push(`${info.round} тур`);
  let kind = info.kind;
  if (kind === "tasks" && info.round === 2 && ctx.subject === "chemistry" && KZ_STAGES_WITH_PRACTICE.has(ctx.stageKey)) kind = "practice";
  if (kind === "tasks" && info.track === "Практика") kind = "practice";
  if (!pieces.length && info.kind === "other") return humanize(info.base, ctx.stageKey) + LANG_SUFFIX[info.lang];
  if (!pieces.length) pieces.push(humanize(info.base, ctx.stageKey));
  return `${pieces.join(" · ")} (${KIND_LABELS[kind]}${LANG_SUFFIX[info.lang]})`;
}

const KIND_ORDER = { tasks: 0, sol: 1, blank: 2, other: 3, results: 4 };
const LANG_ORDER = { ru: 0, kz: 1, en: 2 };

function sortKey(info) {
  const grade = typeof info.grade === "number" ? info.grade : parseInt(info.grade, 10) || 0;
  return [grade, info.round || 0, info.base, KIND_ORDER[info.kind] ?? 9, LANG_ORDER[info.lang] ?? 9];
}

function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

/**
 * Build one olympiad record.
 * @param {string} sourcePage
 * @param {string[]} filenames PDF file names on that page
 * @param {(relPath: string) => boolean} isLocal checks if public/<relPath> exists
 */
function buildOlympiad(sourcePage, filenames, isLocal = () => false) {
  const page = parseSourcePage(sourcePage);
  if (!page) return null;

  const unique = [...new Set(filenames.filter((f) => /\.pdf$/i.test(f)))];
  const infos = unique.map(classifyFile);
  // Unmarked file next to an explicit "-rus" twin is the English original (IChO style)
  for (const info of infos) {
    if (info.langExplicit) continue;
    const twin = infos.find((o) => o !== info && o.langExplicit && o.lang === "ru" && o.base === info.base && o.kind === info.kind);
    if (twin) {
      info.lang = "en";
      info.pairKey = `${info.base}|en`;
    }
  }
  const grades = new Set(infos.map((i) => i.grade).filter((g) => g != null));
  const ctx = { pageGrade: page.grade, multiGrade: grades.size > 1, stageKey: page.stageKey, subject: page.subject };

  infos.sort((a, b) => compareKeys(sortKey(a), sortKey(b)));

  const id = slugify(page.pagePath.replace(/^[a-z]+\/(s\/)?/, `${page.subjectPrefix}-`));
  const materials = infos.map((info) => {
    const localPath = `olympiads/${page.pagePath}/${info.filename}`;
    return {
      id: slugify(info.filename.replace(/\.pdf$/i, "")),
      title: info.filename,
      label: materialLabel(info, ctx),
      kind: info.kind,
      lang: info.lang,
      grade: info.grade ?? page.grade,
      round: info.round,
      pairKey: info.pairKey,
      localPath,
      local: Boolean(isLocal(localPath)),
    };
  });

  // Pair tasks ↔ solutions (same base + language; fall back to same base, any language)
  const solutions = materials.filter((m) => m.kind === "sol");
  for (const mat of materials) {
    if (mat.kind !== "tasks") continue;
    let sol = solutions.find((s) => s.pairKey === mat.pairKey);
    if (!sol) {
      const base = mat.pairKey.split("|")[0];
      sol = solutions.find((s) => s.pairKey.split("|")[0] === base && s.lang === "ru") || solutions.find((s) => s.pairKey.split("|")[0] === base);
    }
    if (sol) mat.solutionId = sol.id;
    mat.setId = `${id}--${mat.id}`;
  }

  const gradeLabel = page.grade != null ? `${page.grade} класс` : grades.size === 1 ? `${[...grades][0]} класс` : grades.size > 1 ? "Все классы" : "";
  const titleParts = [page.subjectLabel, page.stageLabel];
  if (page.edition && !/^\d{4}$/.test(page.edition)) titleParts.push(page.edition);
  else if (page.year) titleParts.push(String(page.year));
  if (gradeLabel) titleParts.push(gradeLabel);

  return {
    id,
    subject: page.subject,
    stage: page.stageKey,
    stageLabel: page.stageLabel,
    stageGroup: page.stageGroup,
    stageOrder: page.stageOrder,
    year: page.year,
    edition: page.edition,
    grade: page.grade ?? (grades.size === 1 ? [...grades][0] : null),
    gradeLabel,
    title: titleParts.join(" → "),
    sourcePage,
    materials,
  };
}

function sortOlympiads(list) {
  return list.sort((a, b) => {
    if ((b.year || 0) !== (a.year || 0)) return (b.year || 0) - (a.year || 0);
    if (a.stageOrder !== b.stageOrder) return a.stageOrder - b.stageOrder;
    const ga = typeof a.grade === "number" ? a.grade : parseInt(a.grade, 10) || 0;
    const gb = typeof b.grade === "number" ? b.grade : parseInt(b.grade, 10) || 0;
    return ga - gb;
  });
}

module.exports = {
  PAGE_ORIGIN,
  STAGES,
  SUBJECTS,
  parseSourcePage,
  classifyFile,
  buildOlympiad,
  sortOlympiads,
  slugify,
};
