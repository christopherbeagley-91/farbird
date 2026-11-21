# Farbird personalised card, 5 x 7 in. Usage: python3 cards.py <fontsource dir>  -> cards.html
import sys
F="file://"+sys.argv[1]
def ff(fam,path,w,st): return f"@font-face{{font-family:'{fam}';font-weight:{w};font-style:{st};src:url('{F}/{path}')}}"
fonts="".join([ff('Bodoni Moda','bodoni-moda/files/bodoni-moda-latin-500-normal.woff2',500,'normal'),
 ff('EB Garamond','eb-garamond/files/eb-garamond-latin-400-normal.woff2',400,'normal'),
 ff('EB Garamond','eb-garamond/files/eb-garamond-latin-400-italic.woff2',400,'italic'),
 ff('Instrument Sans','instrument-sans/files/instrument-sans-latin-500-normal.woff2',500,'normal')])
def bird(fg,beak): return f'<svg width="0.32in" height="0.32in" viewBox="0 0 40 40"><ellipse cx="18" cy="23" rx="13" ry="11" fill="{fg}"/><circle cx="27" cy="16" r="5.5" fill="{fg}"/><path d="M31 17 L39 22 L31.5 19.5Z" fill="{beak}"/><path d="M13 33 L11 38 M20 34 L20 38" stroke="{fg}" stroke-width="2" stroke-linecap="round"/></svg>'
BOX=[dict(name="AROHA",bg="#F4A3C4",no="004",
  msg="Merry Christmas, Aroha.<br>Counting the sleeps,<br>and the flight hours.",sign="All my love, Ben",
  inside=[("Perfume mist","Sol de Janeiro","Brazil"),("Hand cream","L’Occitane","Provence"),("Truffles","Godiva","Belgium")]),
 dict(name="NICO",bg="#1F5FBF",no="005",
  msg="Merry Christmas, Nico!<br>Your mum said no lollies.<br>I didn’t ask her.",sign="Love, Aunty Mia",
  inside=[("Squishmallow","Squishmallows","USA"),("Mini figure","Sonny Angel","Tokyo"),("Gummy clusters","Nerds","USA")])]
css=fonts+"""
@page{margin:0} body{margin:0;background:#fff}
.sheet{width:17in;height:11in;position:relative;display:flex;align-items:center;justify-content:center}
.cards{display:flex;gap:.6in}
.card{width:5in;height:7in;background:#F6F1E7;color:#1B1A17;position:relative;box-sizing:border-box;padding:.55in .5in .45in;display:flex;flex-direction:column;outline:1px dashed #bbb}
.stripe{position:absolute;left:0;right:0;top:0;height:.22in}
.c-ov{font:500 7.5pt 'Instrument Sans';letter-spacing:.24em;color:#5A544B;margin-top:.1in}
.c-for{font:500 38pt/1 'Bodoni Moda';letter-spacing:.12em;margin:.18in 0 .28in}
.c-msg{font:italic 400 22pt/1.35 'EB Garamond'}
.c-sign{font:italic 400 22pt 'EB Garamond';margin-top:.25in}
.c-in{margin-top:auto;border-top:1px solid #D9CFBD;padding-top:.16in}
.c-in h4{margin:0 0 .08in;font:500 7.5pt 'Instrument Sans';letter-spacing:.24em;color:#5A544B}
.c-in div{display:flex;justify-content:space-between;font:400 12pt/1.6 'EB Garamond'}
.c-in em{color:#5A544B}
.c-ft{display:flex;justify-content:space-between;align-items:center;margin-top:.18in;font:500 7pt 'Instrument Sans';letter-spacing:.2em;color:#5A544B}
.note{position:absolute;top:.35in;left:.5in;font:500 8pt 'Instrument Sans';color:#666}
"""
def card(b):
    ins="".join(f"<div><span>{a} <em>· {c}</em></span><span>{d}</span></div>" for a,c,d in b['inside'])
    return f"""<div class='card'><div class='stripe' style='background:{b['bg']}'></div>
<div class='c-ov'>FARBIRD · CHRISTMAS 2026</div><div class='c-for'>{b['name']}</div>
<div class='c-msg'>{b['msg']}</div><div class='c-sign'>{b['sign']}</div>
<div class='c-in'><h4>INSIDE, AND WHERE IT’S FROM</h4>{ins}</div>
<div class='c-ft'><span>NO. {b['no']} · FARBIRD.CO</span>{bird('#1B1A17','#C8102E')}</div></div>"""
open('cards.html','w').write(f"<html><head><meta charset='utf-8'><style>{css}</style></head><body><div class='sheet'><div class='note'>Cards: trim on the dashed lines (5 × 7 in each). Print on ivory or natural-white cardstock.</div><div class='cards'>{''.join(card(b) for b in BOX)}</div></div></body></html>")
