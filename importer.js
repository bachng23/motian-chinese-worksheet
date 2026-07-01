// ===== File importer: .txt/.csv/.tsv, .json, .xlsx, .apkg =====
// Produces a normalized table { headers?, rows: string[][] }, auto-detects the
// hanzi column + meaning column, shows a preview, then fills the word list.

(function () {
  const CJK = /[㐀-鿿豈-﫿]/g;
  const MEDIA = /\[sound:|\[anki:|\.(mp3|ogg|wav|m4a|jpg|jpeg|png|gif|svg|webp)\b|^https?:\/\//i;
  const cjkScore = (s) => ((s || "").match(CJK) || []).length;
  const latinScore = (s) => ((s || "").match(/[A-Za-z]/g) || []).length;
  // latin letters that count toward "meaning" — ignore audio/image/url cells
  const meaningScore = (s) => (MEDIA.test(s || "") ? 0 : latinScore(s));

  // ---- lazy CDN loader ----
  const loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => rej(new Error("load " + src));
      document.head.appendChild(s);
    });
    return loaded[src];
  }

  // ---- per-format parsers -> { headers?, rows } ----
  function parseDelimited(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (!lines.length) return { rows: [] };
    const counts = { "\t": 0, "|": 0, ",": 0, ";": 0 };
    lines.slice(0, 20).forEach((l) =>
      Object.keys(counts).forEach((d) => (counts[d] += l.split(d).length - 1))
    );
    let delim = Object.keys(counts).reduce((a, b) => (counts[b] > counts[a] ? b : a));
    if (counts[delim] === 0) delim = null; // single column
    const rows = lines.map((l) =>
      delim ? l.split(delim).map((c) => c.trim()) : [l.trim()]
    );
    return { rows };
  }

  function parseJson(text) {
    const data = JSON.parse(text);
    // vocab.json shape -> flatten all words
    if (data && Array.isArray(data.books)) {
      const words = data.books.flatMap((b) =>
        b.lessons.flatMap((l) => l.words)
      );
      const headers = ["t", "s", "p", "pos", "m"];
      return { headers, rows: words.map((w) => headers.map((k) => w[k] || "")) };
    }
    if (Array.isArray(data)) {
      if (data.length && typeof data[0] === "object" && !Array.isArray(data[0])) {
        const headers = [...new Set(data.flatMap((o) => Object.keys(o)))];
        return { headers, rows: data.map((o) => headers.map((k) => String(o[k] ?? ""))) };
      }
      return { rows: data.map((r) => (Array.isArray(r) ? r.map(String) : [String(r)])) };
    }
    throw new Error(t("jsonBad"));
  }

  async function parseXlsx(file) {
    await loadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
    const rows = aoa.map((r) => r.map((c) => String(c).trim())).filter((r) => r.some((c) => c));
    return { rows };
  }

  async function parseApkg(file) {
    await loadScript("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js");
    await loadScript("https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-wasm.js");
    const SQL = await initSqlJs({
      locateFile: (f) => "https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/" + f,
    });
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const dbName = zip.file("collection.anki21") ? "collection.anki21" : "collection.anki2";
    const dbBuf = await zip.file(dbName).async("uint8array");
    const db = new SQL.Database(dbBuf);
    const res = db.exec("SELECT flds FROM notes");
    const rows = res.length
      ? res[0].values.map((v) => String(v[0]).split("\x1f"))
      : [];
    db.close();
    return { rows };
  }

  function parseFile(file) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (ext === "xlsx" || ext === "xls") return parseApkgGuard(parseXlsx(file));
    if (ext === "apkg") return parseApkgGuard(parseApkg(file));
    return file.text().then((text) => {
      if (ext === "json") return parseJson(text);
      return parseDelimited(text); // txt, csv, tsv, anything else
    });
  }
  // wrap async parsers so they share the same .then chain shape
  function parseApkgGuard(p) { return Promise.resolve(p); }

  // ---- column auto-detection ----
  function detectColumns(rows) {
    const n = Math.max(0, ...rows.map((r) => r.length));
    const sample = rows.slice(0, 80);
    const cjk = Array(n).fill(0), mean = Array(n).fill(0);
    sample.forEach((r) => {
      for (let i = 0; i < n; i++) { cjk[i] += cjkScore(r[i]); mean[i] += meaningScore(r[i]); }
    });
    let hanzi = 0;
    for (let i = 1; i < n; i++) if (cjk[i] > cjk[hanzi]) hanzi = i;
    let meaning = -1;
    for (let i = 0; i < n; i++) {
      if (i === hanzi || mean[i] === 0) continue;
      if (meaning === -1 || mean[i] > mean[meaning]) meaning = i;
    }
    return { hanzi, meaning, n };
  }

  // ---- preview modal ----
  function colLabel(idx, rows, headers) {
    const sample = (rows.find((r) => (r[idx] || "").trim()) || [])[idx] || "";
    const name = headers && headers[idx] ? headers[idx] : t("impColLabel", idx + 1);
    return `${name}${sample ? " — " + sample.slice(0, 10) : ""}`;
  }

  function buildLines(rows, h, m, skipFirst) {
    const out = [];
    rows.slice(skipFirst ? 1 : 0).forEach((r) => {
      const t = (r[h] || "").trim();
      if (!cjkScore(t)) return; // skip rows without hanzi
      const mean = m >= 0 ? (r[m] || "").trim() : "";
      out.push(mean ? `${t} | ${mean}` : t);
    });
    return out;
  }

  // first row looks like a header if its meaning cell has no latin letters
  // but following rows do (e.g. "英文" header over "school", "friend").
  function headerLikely(rows, meaning, hasHeaders) {
    if (hasHeaders || rows.length < 2 || meaning < 0) return false;
    return latinScore(rows[0][meaning]) === 0 &&
      rows.slice(1, 6).some((r) => latinScore(r[meaning]) > 0);
  }

  function showModal(fileName, parsed) {
    const rows = parsed.rows, headers = parsed.headers;
    if (!rows.length) { alert(t("fileEmpty")); return; }
    const det = detectColumns(rows);

    const back = document.createElement("div");
    back.className = "modal-back";
    const colOpts = (sel) => Array.from({ length: det.n }, (_, i) =>
      `<option value="${i}" ${i === sel ? "selected" : ""}>${colLabel(i, rows, headers)}</option>`).join("");

    back.innerHTML = `
      <div class="modal">
        <h3>${t("impTitle")} <span class="fn">${fileName}</span></h3>
        <p class="msub">${t("impSub", rows.length)}</p>
        <div class="row2">
          <label class="field"><span>${t("impHanziCol")}</span><select id="impHanzi">${colOpts(det.hanzi)}</select></label>
          <label class="field"><span>${t("impMeanCol")}</span>
            <select id="impMean"><option value="-1">${t("impNoMean")}</option>${colOpts(det.meaning)}</select></label>
        </div>
        <label class="imp-skip"><input type="checkbox" id="impSkip"
          ${headerLikely(rows, det.meaning, !!headers) ? "checked" : ""} />
          ${t("impSkipHeader")}</label>
        <div class="imp-preview" id="impPrev"></div>
        <div class="actions">
          <button id="impReplace" class="primary" type="button">${t("impReplace")}</button>
          <button id="impAppend" type="button">${t("impAppend")}</button>
          <button id="impCancel" type="button">${t("impCancel")}</button>
        </div>
      </div>`;
    document.body.appendChild(back);

    const $i = (id) => back.querySelector("#" + id);
    function refresh() {
      const h = parseInt($i("impHanzi").value, 10);
      const m = parseInt($i("impMean").value, 10);
      const lines = buildLines(rows, h, m, $i("impSkip").checked);
      const prev = lines.slice(0, 8).map((l) => `<div>${l}</div>`).join("");
      $i("impPrev").innerHTML =
        `<div class="imp-count">${t("impCount", lines.length)}</div>${prev}`;
      return lines;
    }
    $i("impHanzi").addEventListener("change", refresh);
    $i("impMean").addEventListener("change", refresh);
    $i("impSkip").addEventListener("change", refresh);
    refresh();

    const close = () => back.remove();
    const apply = (append) => {
      const lines = refresh();
      if (!lines.length) { alert(t("noHanzi")); return; }
      const ta = document.getElementById("words");
      const cur = ta.value.trim();
      ta.value = append && cur ? cur + "\n" + lines.join("\n") : lines.join("\n");
      if (!document.getElementById("title").value.trim() && !append) {
        document.getElementById("title").value = fileName.replace(/\.[^.]+$/, "");
      }
      close();
      if (typeof generate === "function") generate();
    };
    $i("impReplace").addEventListener("click", () => apply(false));
    $i("impAppend").addEventListener("click", () => apply(true));
    $i("impCancel").addEventListener("click", close);
    back.addEventListener("click", (e) => { if (e.target === back) close(); });
  }

  function showFilePickerModal(input, handleFile) {
    const back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML = `
      <div class="modal file-picker-modal">
        <h3>${t("filePickTitle")}</h3>
        <button class="file-drop" id="fileDrop" type="button">
          <span>${t("fileDropText")}</span>
          <small>${t("fileSupport")}</small>
        </button>
        <div class="actions">
          <button id="fileChoose" class="primary" type="button">${t("fileChooseBtn")}</button>
          <button id="fileCancel" type="button">${t("impCancel")}</button>
        </div>
      </div>`;
    document.body.appendChild(back);

    const close = () => back.remove();
    const drop = back.querySelector("#fileDrop");
    const choose = back.querySelector("#fileChoose");
    const cancel = back.querySelector("#fileCancel");

    choose.addEventListener("click", () => input.click());
    cancel.addEventListener("click", close);
    back.addEventListener("click", (e) => { if (e.target === back) close(); });

    ["dragenter", "dragover"].forEach((eventName) => {
      drop.addEventListener(eventName, (e) => {
        e.preventDefault();
        drop.classList.add("dragging");
      });
    });
    ["dragleave", "drop"].forEach((eventName) => {
      drop.addEventListener(eventName, (e) => {
        e.preventDefault();
        drop.classList.remove("dragging");
      });
    });
    drop.addEventListener("drop", (e) => {
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      close();
      handleFile(file);
    });

    return close;
  }

  // ---- wire up the file input ----
  window.addEventListener("DOMContentLoaded", () => {
    const input = document.getElementById("fileInput");
    const btn = document.getElementById("openFile");
    if (!input || !btn) return;

    let closePicker = null;
    function handleFile(file) {
      if (!file) return;
      const info = document.getElementById("fileInfo");
      if (info) info.textContent = t("readingFile", file.name);
      parseFile(file)
        .then((parsed) => { if (info) info.textContent = ""; showModal(file.name, parsed); })
        .catch((err) => {
          console.error(err);
          if (info) info.textContent = t("errFilePrefix") + err.message;
          alert(t("errReadFile", err.message));
        })
        .finally(() => { input.value = ""; });
    }

    btn.addEventListener("click", () => {
      if (closePicker) closePicker();
      closePicker = showFilePickerModal(input, handleFile);
    });
    input.addEventListener("change", () => {
      const file = input.files[0];
      if (closePicker) {
        closePicker();
        closePicker = null;
      }
      handleFile(file);
    });
  });
})();
