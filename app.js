// ===== TOCFL handwriting worksheet generator =====
// Pure client-side. Uses pinyin-pro (global `pinyinPro`) for auto pinyin.

const $ = (id) => document.getElementById(id);

// hide the loading splash once the fill animation finishes
(function () {
  const loader = document.getElementById("loader");
  if (!loader) return;
  const fill = loader.querySelector(".fill");
  const pct = loader.querySelector(".loader-pct");
  const hide = () => {
    loader.classList.add("done");
    setTimeout(() => loader.remove(), 600);
  };
  // count "loading NN%" in sync with the fill animation (1.8s)
  const DUR = 1800, start = performance.now();
  (function tick(now) {
    const p = Math.min(100, Math.round(((now || start) - start) / DUR * 100));
    if (pct) pct.textContent = "loading " + p + "%";
    if (p < 100) requestAnimationFrame(tick);
  })(start);
  if (fill) fill.addEventListener("animationend", () => setTimeout(hide, 350));
  setTimeout(hide, 4000); // safety fallback
})();

// pinyin-pro exposes `pinyin` under global pinyinPro
function getPinyin(char, withTone) {
  try {
    return pinyinPro.pinyin(char, {
      toneType: withTone ? "symbol" : "none",
      type: "string",
    });
  } catch (e) {
    return "";
  }
}

// Parse textarea into entries: { word, chars:[...], meaning }
function parseInput(raw) {
  const entries = [];
  raw.split("\n").forEach((line) => {
    line = line.trim();
    if (!line) return;
    // separator: | or tab (fall back to first space group)
    let word, meaning = "";
    if (line.includes("|")) {
      const [w, ...rest] = line.split("|");
      word = w.trim();
      meaning = rest.join("|").trim();
    } else if (line.includes("\t")) {
      const [w, ...rest] = line.split("\t");
      word = w.trim();
      meaning = rest.join(" ").trim();
    } else {
      // "漢字 nghĩa..." — take leading run of CJK as the word
      const m = line.match(/^([㐀-鿿豈-﫿]+)\s*(.*)$/);
      if (m) { word = m[1]; meaning = m[2].trim(); }
      else { word = line; }
    }
    const chars = Array.from(word).filter((c) =>
      /[㐀-鿿豈-﫿]/.test(c)
    );
    if (chars.length) entries.push({ word, chars, meaning });
  });
  return entries;
}

function makeCell(opts) {
  // opts: { gridType, glyph, glyphClass, isRef }
  const cell = document.createElement("div");
  cell.className = "cell";
  if (opts.gridType !== "blank") cell.classList.add(opts.gridType);
  if (opts.isRef) cell.classList.add("ref");
  if (opts.glyph) {
    const g = document.createElement("span");
    g.className = "glyph hanzi " + (opts.glyphClass || "");
    g.textContent = opts.glyph;
    cell.appendChild(g);
  }
  return cell;
}

function makeRow(cells) {
  const row = document.createElement("div");
  row.className = "grid-row";
  cells.forEach((c) => row.appendChild(c));
  return row;
}

// ===== Stroke-order data =====
// Primary source: local bundle strokes.json (all chars in the textbook,
// downloaded once). Fallback: hanzi-writer-data CDN for anything not bundled.
const STROKE_CACHE = {};
let STROKES_BUNDLE = null;
const bundleReady = fetch("strokes.json")
  .then((r) => (r.ok ? r.json() : {}))
  .then((b) => (STROKES_BUNDLE = b))
  .catch(() => (STROKES_BUNDLE = {}));

async function loadStroke(char) {
  if (char in STROKE_CACHE) return STROKE_CACHE[char];
  const bundle = await bundleReady;
  if (bundle[char]) return (STROKE_CACHE[char] = { strokes: bundle[char] });
  // fallback to CDN for characters not in the local bundle
  try {
    const r = await fetch("https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/" +
      encodeURIComponent(char) + ".json");
    return (STROKE_CACHE[char] = r.ok ? await r.json() : null);
  } catch {
    return (STROKE_CACHE[char] = null);
  }
}

const COLS = 10;       // fixed cells per row
const TRACE_CELLS = 2; // first 2 cells are faded templates to trace

// Stroke-order demonstration strip: cell k shows strokes 0..k, the newest
// stroke highlighted in red, previous strokes light gray.
function buildStrokeStrip(data, cfg) {
  const strip = document.createElement("div");
  strip.className = "stroke-strip";
  const n = data.strokes.length;
  for (let k = 1; k <= n; k++) {
    const cell = document.createElement("div");
    cell.className = "stroke-cell" + (cfg.gridType === "tian" ? " sgrid" : "");
    let paths = "";
    for (let i = 0; i < k; i++) {
      paths += `<path d="${data.strokes[i]}" fill="${i === k - 1 ? "#c0392b" : "#c8c8c8"}"/>`;
    }
    cell.innerHTML =
      `<svg viewBox="0 0 1024 1024" class="stroke-svg">` +
      `<g transform="scale(1,-1) translate(0,-900)">${paths}</g></svg>`;
    strip.appendChild(cell);
  }
  return strip;
}

// A faded template cell: uses the standard stroke glyph (Make Me a Hanzi)
// when available, otherwise falls back to the web font.
function makeTemplateCell(char, cfg) {
  const data = cfg.useStroke && cfg.strokeData && cfg.strokeData[char];
  if (data) {
    const cell = document.createElement("div");
    cell.className = "cell" + (cfg.gridType === "tian" ? " tian" : "");
    const paths = data.strokes.map((d) => `<path d="${d}" fill="#1a1a1a"/>`).join("");
    cell.innerHTML =
      `<svg viewBox="0 0 1024 1024" class="glyph-svg trace">` +
      `<g transform="scale(1,-1) translate(0,-900)">${paths}</g></svg>`;
    return cell;
  }
  return makeCell({ gridType: cfg.gridType, glyph: char, glyphClass: "trace" });
}

// Build one block (one character): a guide row (2 faded + 8 blank) plus
// `blankRows` fully-blank practice rows. Always 10 cells per row.
function buildCharBlock(char, cfg, headInfo) {
  const block = document.createElement("div");
  block.className = "block";

  const data = cfg.useStroke && cfg.strokeData && cfg.strokeData[char];

  // header: 中文 (hanzi) - pinyin - meaning
  const head = document.createElement("div");
  head.className = "block-head";
  if (headInfo && headInfo.word) {
    const hz = document.createElement("span");
    hz.className = "head-hanzi hanzi";
    hz.textContent = headInfo.word;
    head.appendChild(hz);
  }
  if (cfg.showPinyin && headInfo && headInfo.py) {
    const py = document.createElement("span");
    py.className = "py";
    py.textContent = headInfo.py;
    head.appendChild(py);
  }
  if (cfg.showMeaning && headInfo && headInfo.meaning) {
    const m = document.createElement("span");
    m.className = "mean";
    m.textContent = headInfo.meaning;
    head.appendChild(m);
  }
  if (head.children.length) block.appendChild(head);

  // Stroke-order demonstration strip (筆順)
  if (data) block.appendChild(buildStrokeStrip(data, cfg));

  // Guide row: first 2 cells faded template, rest blank
  const firstCells = [];
  for (let i = 0; i < COLS; i++) {
    firstCells.push(
      i < TRACE_CELLS ? makeTemplateCell(char, cfg) : makeCell({ gridType: cfg.gridType })
    );
  }
  const guideRow = makeRow(firstCells);
  guideRow.classList.add("row-top");
  block.appendChild(guideRow);

  // Extra fully-blank practice rows
  for (let r = 0; r < cfg.blankRows; r++) {
    const cells = [];
    for (let i = 0; i < COLS; i++) cells.push(makeCell({ gridType: cfg.gridType }));
    block.appendChild(makeRow(cells));
  }

  return block;
}

function readConfig() {
  return {
    // fixed defaults (no longer user-adjustable)
    gridType: "tian",
    opacity: 0.25,
    cellSize: 16,
    showPinyin: true,
    showMeaning: true,
    toneMark: true,
    useStroke: true,
    // still adjustable
    blankRows: clamp(parseInt($("blankRows").value, 10) || 0, 0, 8),
    title: $("title").value.trim(),
  };
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

let genToken = 0;
async function generate() {
  const cfg = readConfig();
  const entries = parseInput($("words").value);
  const sheet = $("sheet");
  const token = ++genToken;
  sheet.innerHTML = "";

  if (!entries.length) {
    sheet.innerHTML = `<div class="placeholder no-print">${t("emptyHint")}</div>`;
    return;
  }

  // prefetch stroke data for all unique characters (parallel, cached)
  if (cfg.useStroke) {
    sheet.innerHTML = `<div class="placeholder no-print">${t("loadingStrokes")}</div>`;
    const chars = [...new Set(entries.flatMap((e) => e.chars))];
    const datas = await Promise.all(chars.map(loadStroke));
    if (token !== genToken) return; // a newer generate() superseded this one
    cfg.strokeData = {};
    chars.forEach((c, i) => (cfg.strokeData[c] = datas[i]));
    sheet.innerHTML = "";
  }

  // apply CSS variables
  document.documentElement.style.setProperty("--cell", cfg.cellSize + "mm");
  document.documentElement.style.setProperty("--trace-opacity", cfg.opacity);

  // We paginate naively: put all blocks in one page; the @page + page-break
  // rules let the browser flow long content onto multiple printed pages.
  const page = document.createElement("div");
  page.className = "page";

  if (cfg.title) {
    const t = document.createElement("h2");
    t.className = "page-title hanzi";
    t.textContent = cfg.title;
    page.appendChild(t);
  }

  entries.forEach((entry) => {
    entry.chars.forEach((char, idx) => {
      // show meaning/word-level pinyin only on the first char of a multi-char word
      const head = idx === 0
        ? {
            word: entry.word,
            py: cfg.showPinyin ? getPinyin(entry.word, cfg.toneMark) : "",
            meaning: entry.meaning,
          }
        : null;
      page.appendChild(buildCharBlock(char, cfg, head));
    });
  });

  sheet.appendChild(page);
}

$("generate").addEventListener("click", generate);
$("print").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = "⏳ …";
  try {
    await generate();
    await window.downloadWorksheetPdf();
  } catch (err) {
    console.error(err);
    alert(t("pdfError") + (err.message || err));
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
});

// ===== Vocabulary loader (Đương Đại B1–B6 from vocab.json) =====
let VOCAB = null;
const selKeys = new Set(); // selected lessons across books: "book:lesson"

function lessonWordsToText(words) {
  return words.map((w) => (w.m ? `${w.t} | ${w.m}` : w.t)).join("\n");
}

function currentBook() {
  if (!VOCAB) return null;
  return VOCAB.books.find((b) => b.book === parseInt($("vbook").value, 10));
}

// gather all selected lessons (across books), in book/lesson order
function selectedLessons() {
  if (!VOCAB) return [];
  const out = [];
  VOCAB.books.forEach((b) =>
    b.lessons.forEach((l) => {
      if (selKeys.has(b.book + ":" + l.lesson)) out.push({ book: b.book, lesson: l });
    })
  );
  return out;
}

function refreshSelInfo() {
  const sel = selectedLessons();
  const nWords = sel.reduce((s, x) => s + x.lesson.words.length, 0);
  $("vinfo").textContent = sel.length ? t("chosenInfo", sel.length, nWords) : t("noneChosen");
  // sync the "select all" checkbox to current book state
  const book = currentBook();
  if (book) {
    const all = book.lessons.every((l) => selKeys.has(book.book + ":" + l.lesson));
    $("selAll").checked = all;
  }
}

function populateBooks() {
  if (!VOCAB) return;
  const sel = $("vbook");
  const prev = sel.value;
  sel.innerHTML = "";
  VOCAB.books.forEach((b) => sel.appendChild(new Option(t("bookOpt", b.book), b.book)));
  if (prev) sel.value = prev;
}

function buildLessonList() {
  const book = currentBook();
  const list = $("lessonList");
  list.innerHTML = "";
  if (!book) return;
  book.lessons.forEach((l) => {
    const key = book.book + ":" + l.lesson;
    const label = document.createElement("label");
    label.className = "lesson-item";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selKeys.has(key);
    cb.addEventListener("change", () => {
      cb.checked ? selKeys.add(key) : selKeys.delete(key);
      refreshSelInfo();
    });
    const span = document.createElement("span");
    span.textContent = t("lessonOpt", l.lesson, l.count);
    label.append(cb, span);
    list.appendChild(label);
  });
  refreshSelInfo();
}

// re-render dynamic labels when the UI language changes (called by i18n.js)
window.refreshDynamicI18n = function () {
  if (!VOCAB) return;
  populateBooks();
  buildLessonList();
};

function initVocab() {
  fetch("vocab.json")
    .then((r) => r.json())
    .then((data) => {
      VOCAB = data;
      populateBooks();
      buildLessonList();
    })
    .catch(() => {
      $("vinfo").textContent = t("vocabLoadErr");
    });

  $("vbook").addEventListener("change", buildLessonList);
  $("selAll").addEventListener("change", () => {
    const book = currentBook();
    if (!book) return;
    book.lessons.forEach((l) => {
      const key = book.book + ":" + l.lesson;
      $("selAll").checked ? selKeys.add(key) : selKeys.delete(key);
    });
    buildLessonList();
  });
  $("loadVocab").addEventListener("click", () => {
    const sel = selectedLessons();
    if (!sel.length) return;
    const words = sel.flatMap((x) => x.lesson.words);
    $("words").value = lessonWordsToText(words);
    if (!$("title").value.trim()) {
      $("title").value =
        sel.length === 1
          ? `當代中文 B${sel[0].book}L${sel[0].lesson.lesson}`
          : `當代中文 (${sel.length} 課)`;
    }
    generate();
  });
}

// Generate a sample on first load so the user sees something
window.addEventListener("DOMContentLoaded", () => {
  $("words").value = "喜 | to be happy, joyful\n酒 | wine, alcohol\n恭 | respectful, polite\n謝謝 | thank you";
  initVocab();
  // wait for pinyin-pro to be ready
  const tryGen = () => {
    if (window.pinyinPro) generate();
    else setTimeout(tryGen, 100);
  };
  tryGen();
});
