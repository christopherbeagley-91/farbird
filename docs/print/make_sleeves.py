"""Builds a 36 x 24 in Farbird sleeve print sheet (up to three sleeves), laid out
exactly like docs/print/Farbird-sleeves-36x24-poster.pdf, rendered with Chromium.

One-off setup (fonts from npm, OFL licensed):
  mkdir -p docs/print/fonts && cd docs/print/fonts
  for p in @fontsource-variable/bodoni-moda @fontsource-variable/instrument-sans @fontsource/eb-garamond; do npm pack $p; done
  for t in *.tgz; do mkdir -p "${t%.tgz}" && tar xzf "$t" -C "${t%.tgz}"; done

Usage:
  python3 docs/print/make_sleeves.py out.pdf '[{"name":"Sandra","from":"From Chris, in New York","no":"NO. 001","colour":"pohutukawa"}]'
colour is one of pohutukawa, bush, kowhai, musk, jandal (ink text on kowhai and musk).
Print at 100% (actual size) on 36 x 24 in poster paper.
"""
import json, sys, base64, pathlib
from playwright.sync_api import sync_playwright

import os
FONTS = pathlib.Path(os.environ.get("FARBIRD_FONTS", pathlib.Path(__file__).parent / "fonts"))
def font64(rel):
    return base64.b64encode((FONTS / rel).read_bytes()).decode()

BODONI = font64("fontsource-variable-bodoni-moda-5.3.0/package/files/bodoni-moda-latin-opsz-normal.woff2")
INSTR = font64("fontsource-variable-instrument-sans-5.3.0/package/files/instrument-sans-latin-wght-normal.woff2")
GARA_I = font64("fontsource-eb-garamond-5.3.0/package/files/eb-garamond-latin-400-italic.woff2")

IVORY, INK, KOWHAI, POHUTUKAWA = "#F6F1E7", "#1B1A17", "#F5C518", "#C8102E"
COLOURS = {
    "pohutukawa": (POHUTUKAWA, IVORY),
    "bush": ("#0B6E4F", IVORY),
    "kowhai": (KOWHAI, INK),
    "musk": ("#F4A3C4", INK),
    "jandal": ("#1F5FBF", IVORY),
}
CAPTION = ("Trim to the coloured band (25.8 × 5 in). Fits a 13.8 × 9 × 4.3 in box: fold on the inner marks "
           "(top edges) and the outer marks (bottom edges), then tuck the 1.5 in tabs underneath and fix with "
           "low-tack tape so it slides off.")

# Geometry in pt, measured from the original sheet.
BAND_X0, BAND_X1, BAND_H = 367.5, 2224.5, 360.0
BAND_TOPS = [165.75, 684.0, 1202.25]
MARK_XS = [475.5, 792.0, 1800.0, 2116.5]
CX = (BAND_X0 + BAND_X1) / 2

def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def build(sleeves, t):
    parts = []
    for i, s in enumerate(sleeves):
        if i >= len(BAND_TOPS):
            raise SystemExit("A sheet holds three sleeves; split the list.")
        top = BAND_TOPS[i]
        bg, fg = COLOURS[s["colour"]]
        beak = POHUTUKAWA if s["colour"] == "kowhai" else KOWHAI
        marks = []
        for x in MARK_XS:
            for k in range(4):
                marks.append(f'<rect x="{x}" y="{top - 21.75 + 4*k}" width="0.75" height="2.25" fill="#888"/>')
                marks.append(f'<rect x="{x}" y="{top + BAND_H + 6.75 + 4*k}" width="0.75" height="2.25" fill="#888"/>')
        # bird (positions relative to band top, from the original)
        by = top - 165.75
        bird = (
            f'<ellipse cx="1762.37" cy="{488.75+by}" rx="7.49" ry="6.335" fill="{fg}"/>'
            f'<circle cx="1767.55" cy="{484.72+by}" r="3.17" fill="{fg}"/>'
            f'<polygon points="1769.86,{485.29+by} 1774.46,{488.17+by} 1770.14,{486.73+by}" fill="{beak}"/>'
            f'<line x1="1759.49" y1="{494.51+by}" x2="1758.34" y2="{497.39+by}" stroke="{fg}" stroke-width="{t["leg"]}" stroke-linecap="round"/>'
            f'<line x1="1763.52" y1="{495.08+by}" x2="1763.52" y2="{497.39+by}" stroke="{fg}" stroke-width="{t["leg"]}" stroke-linecap="round"/>'
        )
        parts.append(f'''
<div class="cap" style="top:{top - 42 + t["cap"]}pt">{esc(CAPTION)}</div>
<div class="band" style="top:{top}pt;background:{bg};color:{fg}">
  <div class="over" style="top:{36.75 + t["over"]}pt">Farbird · Christmas 2026</div>
  <div class="name" style="top:{137.1 + t["name"]}pt">{esc(s["name"])}</div>
  <div class="from" style="top:{220.86 + t["from"]}pt">{esc(s["from"])}</div>
  <div class="no" style="top:{317.25 + t["no"]}pt">{esc(s["no"])}</div>
</div>
<svg class="ov" viewBox="0 0 2592 1728" width="2592pt" height="1728pt">{"".join(marks)}{bird}</svg>''')
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: "Bodoni Moda"; font-weight: 400 900; font-style: normal; src: url(data:font/woff2;base64,{BODONI}) format("woff2"); }}
@font-face {{ font-family: "Instrument Sans"; font-weight: 400 700; src: url(data:font/woff2;base64,{INSTR}) format("woff2"); }}
@font-face {{ font-family: "EB Garamond"; font-style: italic; font-weight: 400; src: url(data:font/woff2;base64,{GARA_I}) format("woff2"); }}
@page {{ size: 36in 24in; margin: 0; }}
html, body {{ margin: 0; width: 2592pt; height: 1728pt; background: #fff; position: relative; overflow: hidden;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
.cap {{ position: absolute; left: 367.2pt; font: 500 8pt/1 "Instrument Sans"; letter-spacing: {t["cap_ls"]}em; color: #666; white-space: nowrap; }}
.band {{ position: absolute; left: {BAND_X0}pt; width: {BAND_X1 - BAND_X0}pt; height: {BAND_H}pt; }}
.band > div {{ position: absolute; left: 0; right: 0; text-align: center; white-space: nowrap; line-height: 1; }}
.over {{ font: 500 11pt/1 "Instrument Sans"; letter-spacing: {t["over_ls"]}em; text-transform: uppercase; }}
.name {{ font: 500 84pt/1 "Bodoni Moda"; font-variation-settings: "opsz" {t["opsz"]}, "wght" 500; letter-spacing: {t["name_ls"]}em; text-transform: uppercase; padding-left: {t["name_ls"]}em; }}
.from {{ font: italic 400 23pt/1 "EB Garamond"; }}
.band > .no {{ left: {817.2 - BAND_X0}pt; right: auto; text-align: left; font: 500 8pt/1 "Instrument Sans"; letter-spacing: {t["no_ls"]}em; }}
.ov {{ position: absolute; left: 0; top: 0; }}
</style></head><body>{"".join(parts)}</body></html>'''

def render(out, sleeves, t):
    html = build(sleeves, t)
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        pg.set_content(html, wait_until="load")
        pg.evaluate("document.fonts.ready")
        pg.pdf(path=out, width="36in", height="24in", print_background=True, prefer_css_page_size=True)
        b.close()

if __name__ == "__main__":
    # Offsets (pt) and spacing calibrated against the original sheet.
    t = {"cap": -0.25, "over": -1.25, "name": -22.15, "from": -3, "no": -0.25, "leg": 1.15,
         "over_ls": 0.24, "name_ls": 0.12, "no_ls": 0.16, "opsz": 11, "cap_ls": 0.04}
    if len(sys.argv) > 3:
        t.update(json.loads(sys.argv[3]))
    render(sys.argv[1], json.loads(sys.argv[2]), t)
