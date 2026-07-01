// ===== Direct vector PDF export (jsPDF + svg2pdf) =====
// Draws grid lines, stroke art (Make Me a Hanzi paths) and text straight into
// a vector PDF — fast and crisp, downloads as a file (no print dialog).

(function () {
  const CDN_JSPDF = "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js";
  const CDN_SVG2PDF = "https://cdn.jsdelivr.net/npm/svg2pdf.js@2.2.3/dist/svg2pdf.umd.min.js";
  const SVG_NS = "http://www.w3.org/2000/svg";

  // layout (mm)
  const PAGE_W = 210, PAGE_H = 297, MARGIN = 12;
  const COLS = 10, CELL = 16;
  const GRID_W = COLS * CELL;
  const LEFT = (PAGE_W - GRID_W) / 2;     // center the 10-cell grid
  const STRIP = 8;                        // stroke-order mini cell
  const STRIP_PER_ROW = Math.floor(GRID_W / STRIP);
  const HEADER_H = 8, BLOCK_GAP = 4;

  let fontB64 = null;

  function loadScriptOnce(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => rej(new Error("load " + src));
      document.head.appendChild(s);
    });
  }

  async function loadFont() {
    if (fontB64) return fontB64;
    const buf = await (await fetch("DejaVuSans.ttf")).arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    fontB64 = btoa(bin);
    return fontB64;
  }

  // off-screen holder so svg2pdf can measure elements
  let holder = null;
  function getHolder() {
    if (!holder) {
      holder = document.createElement("div");
      holder.style.cssText = "position:absolute;left:-9999px;top:0;width:0;height:0;overflow:hidden;";
      document.body.appendChild(holder);
    }
    return holder;
  }

  // render Make Me a Hanzi strokes into the pdf at (x,y,size) mm
  async function drawGlyph(doc, strokes, colorFn, x, y, size) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 1024 1024");
    svg.setAttribute("width", size); svg.setAttribute("height", size);
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("transform", "scale(1,-1) translate(0,-900)");
    strokes.forEach((d, i) => {
      const p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("d", d);
      p.setAttribute("fill", colorFn(i));
      g.appendChild(p);
    });
    svg.appendChild(g);
    getHolder().appendChild(svg);
    const render = doc.svg ? (el, o) => doc.svg(el, o) : (el, o) => svg2pdf(el, doc, o);
    await render(svg, { x, y, width: size, height: size });
    getHolder().removeChild(svg);
  }

  function drawCell(doc, x, y, s) {
    doc.setDrawColor(43, 43, 43);
    doc.setLineWidth(0.2);
    doc.rect(x, y, s, s);
    // dashed red cross (田字格)
    // Match the 0.25 opacity used by faded guide characters on a white page.
    doc.setDrawColor(244, 206, 206);
    doc.setLineWidth(0.12);
    doc.setLineDashPattern([0.7, 0.7], 0);
    doc.line(x + s / 2, y, x + s / 2, y + s);
    doc.line(x, y + s / 2, x + s, y + s / 2);
    doc.setLineDashPattern([], 0);
  }

  async function downloadWorksheetPdf() {
    const entries = parseInput($("words").value);
    if (!entries.length) { alert(t("emptyHint")); return; }

    await loadScriptOnce(CDN_JSPDF);
    await loadScriptOnce(CDN_SVG2PDF);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    doc.addFileToVFS("DejaVuSans.ttf", await loadFont());
    doc.addFont("DejaVuSans.ttf", "DejaVu", "normal");

    const rows = Math.min(8, Math.max(0, parseInt($("blankRows").value, 10) || 0));

    // prefetch stroke data (local bundle)
    const chars = [...new Set(entries.flatMap((e) => e.chars))];
    const arr = await Promise.all(chars.map(loadStroke));
    const SD = {};
    chars.forEach((c, i) => (SD[c] = arr[i] && arr[i].strokes ? arr[i].strokes : null));

    let y = MARGIN;
    const title = $("title").value.trim();
    if (title) {
      doc.setFont("DejaVu", "normal"); doc.setFontSize(13); doc.setTextColor(20);
      doc.text(title, PAGE_W / 2, y + 3, { align: "center" });
      y += 9;
    }

    for (const entry of entries) {
      const py = getPinyin(entry.word, true);
      for (let ci = 0; ci < entry.chars.length; ci++) {
        const ch = entry.chars[ci];
        const strokes = SD[ch];
        const isFirst = ci === 0;
        const stripRows = strokes ? Math.ceil(strokes.length / STRIP_PER_ROW) : 0;
        const stripH = strokes ? stripRows * STRIP + 2 : 0;
        const headH = isFirst ? HEADER_H : 0;
        const practiceH = (1 + rows) * CELL;
        const blockH = headH + stripH + practiceH + BLOCK_GAP;
        if (y + blockH > PAGE_H - MARGIN) { doc.addPage(); y = MARGIN; }

        // header: 中文 - pinyin - meaning
        if (isFirst) {
          let hx = LEFT;
          const hgs = 6;
          for (const wc of entry.chars) {
            if (SD[wc]) await drawGlyph(doc, SD[wc], () => "#1a1a1a", hx, y, hgs);
            hx += hgs + 0.6;
          }
          hx += 2;
          doc.setFont("DejaVu", "normal");
          if (py) {
            doc.setFontSize(11); doc.setTextColor(245, 78, 0);
            doc.text(py, hx, y + hgs * 0.72);
            hx += doc.getTextWidth(py) + 3;
          }
          if (entry.meaning) {
            doc.setFontSize(10); doc.setTextColor(60);
            doc.text(entry.meaning, hx, y + hgs * 0.72);
          }
          y += headH;
        }

        // stroke-order strip
        if (strokes) {
          for (let k = 1; k <= strokes.length; k++) {
            const col = (k - 1) % STRIP_PER_ROW, row = Math.floor((k - 1) / STRIP_PER_ROW);
            const cx = LEFT + col * STRIP, cy = y + row * STRIP;
            doc.setDrawColor(200); doc.setLineWidth(0.1); doc.rect(cx, cy, STRIP, STRIP);
            await drawGlyph(doc, strokes.slice(0, k),
              (i) => (i === k - 1 ? "#c0392b" : "#c8c8c8"), cx + 0.4, cy + 0.4, STRIP - 0.8);
          }
          y += stripH;
        }

        // practice grid: 1 guide row (first 2 cells faded) + extra blank rows
        for (let r = 0; r < 1 + rows; r++) {
          for (let c = 0; c < COLS; c++) {
            const cx = LEFT + c * CELL, cy = y + r * CELL;
            drawCell(doc, cx, cy, CELL);
            if (r === 0 && c < 2 && strokes) {
              await drawGlyph(doc, strokes, () => "#cfcfcf", cx + 1.2, cy + 1.2, CELL - 2.4);
            }
          }
        }
        y += practiceH + BLOCK_GAP;
      }
    }

    // footer credit on every page
    const n = doc.internal.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setFont("courier", "normal"); doc.setFontSize(8); doc.setTextColor(214, 214, 214);
      doc.text("bachng23", PAGE_W - 8, PAGE_H - 5, { align: "right" });
    }
    if (holder) holder.innerHTML = "";
    doc.save((title || "motian").replace(/[\\/:*?"<>|]+/g, "_") + ".pdf");
  }

  window.downloadWorksheetPdf = downloadWorksheetPdf;
})();
