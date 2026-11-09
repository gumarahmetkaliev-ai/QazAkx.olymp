# QazAkx.olymp

Олимпиады по химии Казахстана: все туры с заданиями и решениями (как на BeyondOlympiads) **+ ИИ-жюри**.
Ученик пишет ответ к каждому пункту задачи, ИИ проверяет строго по официальному решению и схеме баллов,
прогресс сохраняется, а по темам ошибок показываются видеоуроки.

## Как устроено

```
olympiads.bc-pf.org ──sync-chemistry──▶ data/chemistry-sources.json + public/olympiads/**.pdf
                                              │
                         build-catalog ◀──────┘──────▶ build-tasks (PDF заданий + PDF решений)
                               │                              │
                  data/catalog/chemistry.json        data/tasks/<комплект>.json
                  (этап → год → класс → вкладки)     (задачи, пункты, баллы, эталон жюри)
                               │                              │
                        index.html (сайт)  ── /api/grade ──▶ ИИ-жюри (OpenRouter) ──▶ баллы по пунктам,
                                                                                       ошибки, темы, видео
```

| Файл | Что делает |
|---|---|
| `index.html`, `public/js/app.js`, `public/css/app.css` | Сайт: каталог, страница олимпиады (вкладки + PDF + поля ответа), прогресс, аккаунт |
| `public/js/store.js` | Прогресс в браузере + синхронизация с Supabase |
| `lib/chem-catalog.js` | Разбор каталога: этапы, классы, туры, пары «задачи ↔ решения» |
| `lib/task-parser.js` | Разбор PDF в задачи/пункты/баллы/эталон (формат qazcho.kz) |
| `lib/jury.js`, `api/grade.js` | ИИ-жюри |
| `data/topics.json` | Темы ошибок |
| `data/videos.json` | **Ваши видеоуроки** по темам |
| `legacy.html` | Старая версия сайта (оставлена на всякий случай) |

## Запуск

```bash
npm install
cp .env.example .env        # впишите OPENROUTER_API_KEY
npm run dev                 # http://localhost:3000
```

Посмотреть интерфейс без ключа: `npm run dev:fake-ai` (жюри ставит баллы по длине ответа, только для теста).

## Как включить ИИ-проверку для новых олимпиад

Сейчас поля ответа есть у одного комплекта (Республиканская 2024, 9 класс). Чтобы добавить остальные:

```bash
# 1. Свежие списки PDF со всех страниц + скачать PDF (можно частями)
npm run sync-chemistry -- --download --stage=oblast
npm run sync-chemistry -- --download            # вся химия

# 2. Разобрать PDF в задачи с пунктами и эталонами
npm run build-tasks                              # парсер (бесплатно)
npm run build-tasks -- --ai                      # слабые комплекты доразбирает ИИ

# 3. Проверить и закоммитить
npm test
git add data/ && git commit -m "Новые комплекты с ИИ-проверкой"
```

Для лучшего качества разбора поставьте poppler (`pdftotext`): Windows — `winget install oschwartz10612.Poppler`
или `choco install poppler`, macOS — `brew install poppler`. Без него используется pdf-parse.

`build-tasks` пишет, у каких комплектов не нашлись баллы или эталон (`~` в выводе) — их стоит открыть
в `data/tasks/*.json` и поправить руками или пересобрать с `--ai`.

**PDF и Vercel.** Скачанные PDF лежат в `public/olympiads/` и в git не попадают (их сотни мегабайт).
Локально сайт открывает их без интернета, а на Vercel PDF идут через `/api/pdf-proxy` с CDN источника.
Если хотите хранить конкретные PDF в репозитории: `git add -f public/olympiads/...`.

## Видеоуроки

Откройте `data/videos.json` и добавьте видео к темам (id тем — в `data/topics.json`):

```json
"stoichiometry": [
  { "title": "Расчёты по уравнениям реакций", "url": "https://youtu.be/XXXXXXXXXXX", "duration": "14:20" }
]
```

YouTube-ссылки встраиваются плеером прямо в результат проверки и на странице «Прогресс».

## Деплой (Vercel)

Переменные окружения: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, при необходимости `SUPABASE_URL` и
`SUPABASE_PUBLISHABLE_KEY` (таблица — `supabase/schema.sql`, инструкция — `SUPABASE_SETUP.md`).
Проверка задачи может идти до ~30 секунд, для `api/grade.js` в `vercel.json` выставлено `maxDuration: 60`.

Материалы олимпиад — с [olympiads.bc-pf.org](https://olympiads.bc-pf.org) (авторы задач — жюри олимпиад, qazcho.kz).
