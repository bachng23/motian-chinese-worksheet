# Motian Chinese Worksheet

Motian is a browser-based worksheet generator for practicing Traditional Chinese handwriting. It is built for TOCFL learners and for students using *A Course in Contemporary Chinese*.

The app turns vocabulary lists into clean A4 handwriting sheets with stroke-order guides, faded tracing cells, pinyin, meanings, and direct PDF export.

## Highlights

- Generate printable A4 handwriting worksheets in the browser.
- Practice Traditional Chinese characters with stroke-order guide strips.
- Use bundled vocabulary from *A Course in Contemporary Chinese* B1-B6.
- Select vocabulary by book and lesson.
- Paste custom words manually.
- Import vocabulary files with automatic column detection.
- Export worksheets directly to PDF.
- Switch UI language between Vietnamese, English, and Traditional Chinese.

## File Import

Motian can import:

- `.txt`
- `.csv`
- `.tsv`
- `.xlsx`
- `.xls`
- `.json`
- `.apkg`

After a file is selected, Motian previews the detected columns so the hanzi and meaning columns can be adjusted before loading the list.

## Worksheet Output

Each worksheet can include:

- Word-level pinyin.
- Optional meanings.
- Stroke-order demonstration cells.
- Faded tracing examples.
- Blank practice rows.
- A custom page title.

The generated PDF is designed for A4 printing.

## Running Locally

Motian is a static site. Use any local static file server:

```bash
python3 -m http.server 4174
```

Then open:

```text
http://127.0.0.1:4174
```

A local server is recommended because the app loads bundled JSON and font assets.

## Project Structure

```text
.
├── index.html        # App shell
├── styles.css        # UI, worksheet, print, and modal styles
├── app.js            # Worksheet generation and vocabulary picker
├── i18n.js           # Interface translations
├── importer.js       # File import and column detection
├── pdf.js            # Direct PDF export
├── vocab.json        # Bundled course vocabulary
├── strokes.json      # Bundled stroke-order data
└── DejaVuSans.ttf    # Font used for PDF export
```

## Tech Notes

Motian is intentionally simple: plain HTML, CSS, and JavaScript with no build step. Heavy libraries for PDF generation and file parsing are loaded only when needed.

The stroke data is bundled locally so the main worksheet generation flow works quickly without fetching character data one by one.

## License

MIT License.
