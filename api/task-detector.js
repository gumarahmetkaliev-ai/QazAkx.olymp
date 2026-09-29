/**
 * Olympiad Task & Solution Detector
 * Analyzes extracted PDF text and splits into structured tasks with sub-parts
 */

const COMMON_UNITS_REGEX =
  /^(?:г|кг|мг|л|мл|м3|см3|моль|ммоль|кмоль|м|см|мм|нм|пм|па|кпа|мпа|атм|бар|торр|мм\s*рт|дж|кдж|мдж|эв|кал|ккал|в|мв|а|ма|ом|ком|с|мин|ч|сут|г\/моль|г\/л|моль\/л|м|н|%|‰|°c|◦c|k|da|кда|amu|аем)\b/i;

function cleanArtifactLines(lines) {
  return lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    // Page footers & headers
    if (/^--\s*\d+\s*(?:of|\/)\s*\d+\s*--$/i.test(trimmed)) return false;
    if (/^(?:page|страница|бет)\s*\d+(?:\s*(?:of|\/)\s*\d+)?$/i.test(trimmed)) return false;
    if (/^\d+\s*\/\s*\d+$/.test(trimmed)) return false;
    if (/qazcho\.kz\s*\|\s*qazolymp\.kz/i.test(trimmed)) return false;
    if (/bc-pf\.org/i.test(trimmed)) return false;
    if (/Заключительный этап республиканской олимпиады/i.test(trimmed)) return false;
    if (/Комплект заданий теоретического тура/i.test(trimmed)) return false;
    if (/Республикалық олимпиада/i.test(trimmed)) return false;
    return true;
  });
}

function isScoringTableHeader(line) {
  const trimmed = line.trim();
  if (/(?:всего|total|балл|вес|weight|жалпы|ұпай)\s*(?:\(%\)|%|\b)/i.test(trimmed)) {
    return true;
  }
  if (/^(?:\d+(?:\.\d+)?\s+){2,}(?:всего|total|вес|weight|\d+)/i.test(trimmed)) {
    return true;
  }
  if (/^(?:\d+\s+){2,}\d+$/.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Main Task Detector
 */
function detectTasks(text) {
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return {
      success: false,
      count: 0,
      tasks: [],
      manualReviewRequired: true,
      error: "Empty or invalid text",
    };
  }

  const rawLines = text.split(/\r?\n/);
  const lines = cleanArtifactLines(rawLines);

  const taskHeaderRegex =
    /^(?:Задача|Problem|Task|Задание|Есеп|Вопрос|Question)\s*(?:№\s*|#\s*)?(\d+)[.:]?(.*)$/i;

  // 1. Find candidate task headers
  const candidates = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const match = taskHeaderRegex.exec(line);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num >= 1 && num <= 60) {
        candidates.push({
          lineIndex: i,
          number: num,
          title: line,
          suffix: (match[2] || "").trim(),
        });
      }
    }
  }

  // 2. Filter Table of Contents (TOC) entries
  const nonTOC = [];
  for (let i = 0; i < candidates.length; i++) {
    const curr = candidates[i];
    const next = candidates[i + 1];
    if (
      next &&
      next.lineIndex - curr.lineIndex <= 2 &&
      next.number === curr.number + 1
    ) {
      continue;
    }
    nonTOC.push(curr);
  }

  // 3. Fallback to numbered list if no "Задача X" headers found
  if (nonTOC.length === 0) {
    const numberedCandidates = [];
    const sectionNumRegex = /^(\d+)[.)]\s+([A-ZА-ЯЁӘІҢҒҮҰҚӨҺ][^.!?]{5,})/i;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const match = sectionNumRegex.exec(line);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num >= 1 && num <= 30) {
          numberedCandidates.push({
            lineIndex: i,
            number: num,
            title: line,
            suffix: match[2].trim(),
          });
        }
      }
    }

    if (numberedCandidates.length >= 2 && numberedCandidates[0].number === 1) {
      let isStrictSequential = true;
      for (let i = 0; i < numberedCandidates.length; i++) {
        if (numberedCandidates[i].number !== i + 1) {
          isStrictSequential = false;
          break;
        }
      }
      if (isStrictSequential) {
        nonTOC.push(...numberedCandidates);
      }
    }
  }

  // 4. Deduplicate by task number
  const taskGroups = new Map();
  for (let i = 0; i < nonTOC.length; i++) {
    const curr = nonTOC[i];
    const nextLineIdx =
      i < nonTOC.length - 1 ? nonTOC[i + 1].lineIndex : lines.length;
    const bodyLength = nextLineIdx - curr.lineIndex;

    if (
      !taskGroups.has(curr.number) ||
      taskGroups.get(curr.number).bodyLength < bodyLength
    ) {
      taskGroups.set(curr.number, { ...curr, bodyLength, nextLineIdx });
    }
  }

  const sortedNums = Array.from(taskGroups.keys()).sort((a, b) => a - b);

  // Fallback if no tasks detected: treat whole document as 1 task
  if (sortedNums.length === 0) {
    const singleText = lines.filter((l) => !isScoringTableHeader(l)).join("\n").trim();
    const parts = detectSubParts(singleText);
    return {
      success: true,
      count: 1,
      manualReviewRequired: true,
      tasks: [
        {
          id: "task-1",
          number: 1,
          title: "Задание олимпиады (единый текст)",
          statement: singleText.slice(0, 15000),
          text: singleText.slice(0, 15000),
          confidence: 0.3,
          parts,
          sourcePages: [1],
        },
      ],
    };
  }

  // 5. Extract task text & subparts
  const tasks = [];
  let isContinuous = true;
  let expectedNum = sortedNums[0];

  for (let i = 0; i < sortedNums.length; i++) {
    const num = sortedNums[i];
    if (num !== expectedNum) {
      isContinuous = false;
    }
    expectedNum = num + 1;

    const item = taskGroups.get(num);
    const startIdx = item.lineIndex;
    const nextNum = sortedNums[i + 1];
    const endIdx = nextNum ? taskGroups.get(nextNum).lineIndex : lines.length;

    let taskLines = lines.slice(startIdx, endIdx);

    // Filter out scoring headers from statement
    taskLines = taskLines.filter((l, idx) => {
      if (idx === 0) return true;
      return !isScoringTableHeader(l);
    });

    const fullText = taskLines.join("\n").trim();
    const parts = detectSubParts(fullText, num);

    tasks.push({
      id: `task-${num}`,
      number: num,
      title: item.title,
      statement: fullText,
      text: fullText,
      confidence: isContinuous ? 0.95 : 0.8,
      parts,
      sourcePages: [Math.max(1, Math.floor((startIdx / Math.max(1, lines.length)) * 8) + 1)],
    });
  }

  return {
    success: true,
    count: tasks.length,
    manualReviewRequired: !isContinuous || tasks.length === 0,
    tasks,
  };
}

/**
 * Detect sub-parts inside a task statement (e.g. 1. / 2. / 3. or a) / b) / c))
 */
function detectSubParts(taskText, taskNumber = 1) {
  const parts = [];
  const lines = taskText.split(/\r?\n/);

  // Pattern for subquestions (ensuring no trailing digits after dot, to prevent matching decimals like 9.81):
  // 1) 1. / 2. / 3. followed by space and non-digit (e.g. "1. Определите...")
  // 2) 1) / 2) / 3)
  // 3) a) / b) / c) / d) / e) or а) / б) / в) / г) / д)
  // 4) (a) / (b) / (c) or (1) / (2)
  // 5) 1.1 / 1.2 / 3.1 / 3.2 (task.subpart) followed by space and non-digit
  const partPattern =
    /^(?:(?:([0-9]{1,2})\.\s*(?!\d))|(?:([0-9]{1,2})\)\s*)|(?:([a-zа-яёәіңғүұқөһ])\s*\))|(?:\(([a-zа-яёәіңғүұқөһ0-9]{1,2})\)\s*)|(?:(\d{1,2}\.\d{1,2})[.:)]\s*(?!\d)))\s*(.+)/i;

  let candidateParts = [];
  let currentPart = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || isScoringTableHeader(trimmed)) continue;

    // Skip the main task title itself
    if (i === 0 && /^(?:Задача|Problem|Task|Задание|Вопрос)/i.test(trimmed)) {
      continue;
    }

    const match = partPattern.exec(trimmed);

    if (match) {
      const rawLabel = (match[1] || match[2] || match[3] || match[4] || match[5] || "").trim();
      const afterText = (match[6] || "").trim();

      // Check if afterText starts with physical unit (e.g. "г", "атм", "мл", "%", "◦C")
      const firstWord = afterText.split(/\s+/)[0] || "";
      const isQuantityUnit = COMMON_UNITS_REGEX.test(firstWord);

      if (isQuantityUnit) {
        if (currentPart) currentPart.fullLines.push(line);
        continue;
      }

      // Check if this looks like a genuine question or instruction
      if (afterText.length >= 3) {
        if (currentPart) candidateParts.push(currentPart);
        currentPart = {
          label: rawLabel,
          title: afterText,
          fullLines: [line],
        };
        continue;
      }
    }

    if (currentPart) {
      currentPart.fullLines.push(line);
    }
  }

  if (currentPart) {
    candidateParts.push(currentPart);
  }

  if (candidateParts.length === 0) return [];

  // Filter for valid sequential series:
  // Option A: 1, 2, 3...
  const numericParts = candidateParts.filter((p) => /^\d+$/.test(p.label));
  if (numericParts.length >= 2) {
    let validSequential = [];
    let expected = 1;
    for (const p of numericParts) {
      const num = parseInt(p.label, 10);
      if (num === expected) {
        validSequential.push(p);
        expected++;
      }
    }
    if (validSequential.length >= 2) {
      return validSequential.map((p) => ({
        label: p.label,
        title: p.title,
        text: p.fullLines.join("\n").trim(),
      }));
    }
  }

  // Option B: a, b, c... or а, б, в...
  const letterParts = candidateParts.filter((p) => /^[a-zа-яёәіңғүұқөһ]$/i.test(p.label));
  if (letterParts.length >= 2) {
    return letterParts.map((p) => ({
      label: p.label,
      title: p.title,
      text: p.fullLines.join("\n").trim(),
    }));
  }

  // Option C: X.1, X.2...
  const decimalParts = candidateParts.filter((p) => /^\d+\.\d+$/.test(p.label));
  if (decimalParts.length >= 2) {
    return decimalParts.map((p) => ({
      label: p.label,
      title: p.title,
      text: p.fullLines.join("\n").trim(),
    }));
  }

  return candidateParts
    .filter((p) => p.fullLines.join(" ").length >= 10)
    .map((p) => ({
      label: p.label,
      title: p.title,
      text: p.fullLines.join("\n").trim(),
    }));
}

module.exports = { detectTasks, detectSubParts, cleanArtifactLines };
