#!/usr/bin/env python3
"""Compose the PaperMachine hero image. One palette + one language per render."""
import sys

PALETTES = {
    'blue': dict(
        g0='#3369ad', g1='#1d4577', g2='#12294b', g3='#0a1729', g4='#070f1b',
        dark='#07101e', deep='#060e19',
        glow='rgba(122,178,255,.36)', accent='rgba(168,201,247,.94)',
        link='#a6caff', ink='#eef4fe', mute='rgba(214,230,250,.82)',
        chipbg='rgba(255,255,255,.08)', chipbd='rgba(255,255,255,.15)',
        card='rgba(14,27,48,.76)', cardbd='rgba(255,255,255,.18)',
        on='rgba(122,172,255,.26)', onbd='rgba(154,197,255,.44)',
        left='rgba(4,10,20,'),
    'emerald': dict(
        g0='#1f7a6b', g1='#125049', g2='#0b3230', g3='#071f20', g4='#041415',
        dark='#04181a', deep='#031012',
        glow='rgba(104,224,196,.34)', accent='rgba(150,228,210,.94)',
        link='#8fe4d0', ink='#e8fbf6', mute='rgba(206,240,232,.80)',
        chipbg='rgba(255,255,255,.08)', chipbd='rgba(255,255,255,.15)',
        card='rgba(8,38,38,.76)', cardbd='rgba(255,255,255,.17)',
        on='rgba(96,206,180,.26)', onbd='rgba(130,226,202,.44)',
        left='rgba(3,16,18,'),
    'violet': dict(
        g0='#6d4bbf', g1='#48317f', g2='#2c1e52', g3='#1a1233', g4='#100b21',
        dark='#150e2c', deep='#0c0819',
        glow='rgba(178,142,255,.34)', accent='rgba(206,182,255,.94)',
        link='#c3a6ff', ink='#f2ecff', mute='rgba(226,214,250,.80)',
        chipbg='rgba(255,255,255,.09)', chipbd='rgba(255,255,255,.16)',
        card='rgba(26,17,54,.76)', cardbd='rgba(255,255,255,.18)',
        on='rgba(150,110,250,.28)', onbd='rgba(184,152,255,.46)',
        left='rgba(11,7,22,'),
    'ember': dict(
        g0='#a35a2e', g1='#6f3b20', g2='#432618', g3='#281710', g4='#170e0a',
        dark='#1d110c', deep='#120a07',
        glow='rgba(255,176,110,.30)', accent='rgba(250,206,158,.94)',
        link='#f7c295', ink='#fdf1e6', mute='rgba(246,224,204,.80)',
        chipbg='rgba(255,255,255,.08)', chipbd='rgba(255,255,255,.16)',
        card='rgba(40,21,13,.78)', cardbd='rgba(255,255,255,.17)',
        on='rgba(232,150,86,.26)', onbd='rgba(246,182,128,.46)',
        left='rgba(16,9,6,'),
}


TERM_STYLES = {
    'gold':  dict(bg='rgba(244,183,74,.16)', bd='rgba(247,198,110,.55)', fg='#f8d59a', op='rgba(247,198,110,.75)', lab='#f6cf90'),
    'mint':  dict(bg='rgba(94,220,180,.15)', bd='rgba(120,232,196,.52)', fg='#a7ecd4', op='rgba(120,232,196,.72)', lab='#9de8ce'),
    'solid': dict(bg='rgba(255,255,255,.94)', bd='rgba(255,255,255,.94)', fg='#12294b', op='rgba(230,240,255,.8)', lab='rgba(255,255,255,.88)'),
}

CODE = '''<span class="c-k">import</span> pandas <span class="c-k">as</span> pd
<span class="c-k">import</span> numpy <span class="c-k">as</span> np

df = pd.<span class="c-f">read_csv</span>(<span class="c-s">"rnaseq_counts.csv"</span>)
ctrl = df.<span class="c-f">filter</span>(like=<span class="c-s">"ctrl_"</span>).<span class="c-f">mean</span>(axis=<span class="c-n">1</span>)
trt  = df.<span class="c-f">filter</span>(like=<span class="c-s">"treat_"</span>).<span class="c-f">mean</span>(axis=<span class="c-n">1</span>)
lfc  = np.<span class="c-f">log2</span>((trt + <span class="c-n">1</span>) / (ctrl + <span class="c-n">1</span>))

fig.<span class="c-f">savefig</span>(<span class="c-s">"control_vs_treatment_means.png"</span>,
            dpi=<span class="c-n">200</span>)'''

TEXT = {
 'en': dict(cn='', tag='The AI analyst<br>that shows its work.',
            eqlab='Trustworthy research =',
            terms=['agent trace','chart provenance','data transparency'],
            prov='Provenance', tabs=['Code','Log','Messages','Environment'],
            p1='run_python · turn 1 · step 2', p2='general 2026.09.1 · py 3.13 · R 4.5',
            ver='v1 → v2 · human edit'),
 'zh': dict(cn='<div class="cn">造纸机器</div>', tag='用 AI 完成<br>可信的科学研究',
            eqlab='可信研究 =',
            terms=['过程轨迹','图表溯源','数据透明'],
            prov='溯源', tabs=['代码','日志','消息','环境'],
            p1='run_python · 第 1 轮 · 第 2 步', p2='general 2026.09.1 · py 3.13 · R 4.5',
            ver='v1 → v2 · 人工编辑'),
}


def render(pal_name, lang, term_style='gold'):
    p = PALETTES[pal_name]
    ts = TERM_STYLES[term_style]
    t = TEXT[lang]
    terms = '<span class="op">+</span>'.join(f'<span class="term">{x}</span>' for x in t['terms'])
    chips = ''.join(f'<span class="chip">{c}</span>' for c in ['DSH','Python + R','Local first','macOS'])
    tabs = ''.join(f'<span class="{"pt on" if i==0 else "pt"}">{x}</span>' for i, x in enumerate(t['tabs']))
    cn_css = '.cn{font-size:26px;font-weight:500;color:var(--mute);letter-spacing:.06em;}' if lang == 'zh' else ''
    eqsize = '11.5px' if lang == 'en' else '13px'
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
  :root{{--g0:{p['g0']};--g1:{p['g1']};--g2:{p['g2']};--g3:{p['g3']};--g4:{p['g4']};
    --dark:{p['dark']};--deep:{p['deep']};--glow:{p['glow']};--accent:{p['accent']};
    --link:{p['link']};--ink:{p['ink']};--mute:{p['mute']};--chipbg:{p['chipbg']};--chipbd:{p['chipbd']};
    --card:{p['card']};--cardbd:{p['cardbd']};--on:{p['on']};--onbd:{p['onbd']};}}
  html,body{{margin:0;padding:0;background:var(--g4);}}
  #stage{{position:relative;width:1280px;height:640px;overflow:hidden;
    background:radial-gradient(96% 108% at 26% 22%, var(--g0) 0%, var(--g1) 24%, var(--g2) 48%, var(--g3) 74%, var(--g4) 100%);
    font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Segoe UI',sans-serif;color:var(--ink);}}
  .ribbons{{position:absolute;inset:-16%;filter:blur(46px);}}
  .darks{{position:absolute;inset:-16%;filter:blur(76px);}}
  .grain{{position:absolute;inset:0;opacity:.12;mix-blend-mode:overlay;}}
  .grid{{position:absolute;inset:0;
    background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),
                     linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);
    background-size:104px 104px;}}
  .leftwash{{position:absolute;inset:0;background:linear-gradient(200deg, {p['left']}0) 0%, {p['left']}.18) 42%, {p['left']}.62) 78%, {p['left']}.86) 100%);}}
  .vig{{position:absolute;inset:0;background:
    radial-gradient(112% 86% at 34% 30%, rgba(0,0,0,0) 30%, {p['left']}.42) 72%, {p['left']}.78) 100%);}}
  .glow{{position:absolute;left:560px;top:30px;width:760px;height:580px;z-index:2;
    background:radial-gradient(50% 50% at 45% 50%, var(--glow) 0%, rgba(0,0,0,0) 68%);filter:blur(24px);}}
  .scene{{position:absolute;left:0;top:0;width:1280px;height:640px;z-index:4;
    perspective:1900px;perspective-origin:26% 50%;}}
  .win{{position:absolute;left:500px;top:12px;width:856px;
    transform:rotateY(-13deg) rotateX(2deg);transform-origin:0% 50%;
    border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,.22);
    box-shadow:0 54px 120px rgba(0,0,0,.6), 0 8px 30px rgba(0,0,0,.42);}}
  .win img{{display:block;width:856px;}}
  .copy{{position:absolute;left:72px;top:132px;width:404px;display:flex;flex-direction:column;gap:20px;z-index:9;}}
  .name{{font-size:42px;line-height:1;letter-spacing:-.02em;color:#fff;display:flex;align-items:baseline;gap:14px;
    text-shadow:0 2px 28px rgba(0,0,0,.6);}}
  .name b{{font-weight:700}} .name span{{font-weight:400}}
  {cn_css}
  .tag{{font-size:29px;line-height:1.3;font-weight:600;letter-spacing:-.012em;color:#fff;text-shadow:0 2px 28px rgba(0,0,0,.55);}}
  .eqwrap{{display:flex;flex-direction:column;gap:9px;}}
  .eqlab{{font-size:12px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:{ts['lab']};opacity:.9;}}
  .eq{{display:flex;align-items:center;gap:6px;font-size:{eqsize};line-height:1;white-space:nowrap;}}
  .eq .op{{color:{ts['op']};font-weight:600;}}
  .eq .term{{font-weight:600;color:{ts['fg']};padding:6px 9px;border-radius:7px;
    background:{ts['bg']};border:1px solid {ts['bd']};}}
  .chips{{display:flex;gap:7px;flex-wrap:wrap;padding-top:2px;}}
  .chip{{font-size:11.5px;font-weight:600;color:var(--mute);padding:5px 11px;border-radius:13px;
    background:var(--chipbg);border:1px solid var(--chipbd);}}
  .card{{position:absolute;z-index:7;border-radius:12px;padding:13px 15px;color:var(--ink);
    background:var(--card);border:1px solid var(--cardbd);
    backdrop-filter:blur(18px) saturate(1.25);box-shadow:0 26px 54px rgba(0,0,0,.5);}}
  .card .ct{{font-size:9.5px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;
    color:var(--accent);margin-bottom:9px;}}
  .code{{left:832px;top:40px;width:298px;}}
  .code pre{{margin:0;font-family:'SF Mono',Menlo,monospace;font-size:10px;line-height:1.66;white-space:pre;color:var(--mute);}}
  .c-k{{color:#8ab4f8}} .c-s{{color:#96dcae}} .c-f{{color:#e6cb8e}} .c-n{{color:#e8a68e}}
  .chart{{left:868px;top:262px;width:336px;padding:10px 10px 8px 10px;}}
  .chart img{{display:block;width:316px;border-radius:6px;background:#fff;}}
  .chart .cf{{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 4px 1px 4px;
    font-family:'SF Mono',Menlo,monospace;font-size:9.5px;color:var(--mute);}}
  .prov{{left:72px;top:470px;width:322px;}}
  .ptabs{{display:flex;gap:6px;margin-bottom:10px;}}
  .pt{{font-size:10px;padding:4px 8px;border-radius:6px;color:var(--mute);opacity:.85;
    background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);}}
  .pt.on{{color:#fff;background:var(--on);border-color:var(--onbd);font-weight:600;opacity:1;}}
  .prow{{display:flex;align-items:center;gap:7px;font-size:10px;color:var(--mute);
    font-family:'SF Mono',Menlo,monospace;line-height:1.75;}}
  .dot{{width:5px;height:5px;border-radius:3px;background:#5ad18a;flex:0 0 5px;}}
  .link{{position:absolute;left:0;top:0;z-index:6;}}
</style></head><body><div id="stage">
  <svg class="darks" viewBox="0 0 1280 640" preserveAspectRatio="none">
    <ellipse cx="1180" cy="600" rx="420" ry="220" fill="var(--dark)" opacity=".8"/>
    <ellipse cx="150" cy="620" rx="380" ry="210" fill="var(--deep)" opacity=".82"/>
    <ellipse cx="30" cy="40" rx="240" ry="130" fill="var(--dark)" opacity=".28"/>
    <ellipse cx="700" cy="360" rx="220" ry="80" fill="var(--g1)" opacity=".45"/>
  </svg>
  <svg class="ribbons" viewBox="0 0 1280 640" preserveAspectRatio="none">
    <defs>
      <linearGradient id="r1" x1=".05" y1="0" x2=".95" y2=".25">
        <stop offset="0" stop-color="#fff" stop-opacity="0"/>
        <stop offset=".30" stop-color="#fff" stop-opacity=".28"/>
        <stop offset=".62" stop-color="#fff" stop-opacity=".62"/>
        <stop offset=".88" stop-color="#fff" stop-opacity=".26"/>
        <stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="r2" x1=".2" y1="0" x2=".9" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity="0"/>
        <stop offset=".42" stop-color="#fff" stop-opacity=".38"/>
        <stop offset=".78" stop-color="#fff" stop-opacity=".16"/>
        <stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="r3" x1="1" y1="0" x2=".3" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity="0"/>
        <stop offset=".5" stop-color="#fff" stop-opacity=".30"/>
        <stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="M120 176 C 330 74, 520 232, 740 158 S 1060 26, 1300 104 L 1430 84 L 1430 232 C 1250 268, 1080 206, 880 240 S 470 330, 240 288 S 60 256, 60 262 Z" fill="url(#r1)"/>
    <path d="M240 470 C 430 392, 620 502, 830 456 S 1160 336, 1400 404 L 1430 396 L 1430 512 C 1140 502, 920 578, 640 560 S 300 596, 200 556 Z" fill="url(#r2)"/>
    <path d="M660 -80 C 800 60, 700 206, 856 292 S 1120 372, 1240 508 L 1290 700 L 1090 700 C 1000 536, 820 468, 720 330 S 520 96, 520 -80 Z" fill="url(#r3)" opacity=".7"/>
  </svg>
  <svg class="grain" viewBox="0 0 1280 640" preserveAspectRatio="none"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch"/></filter><rect width="1280" height="640" filter="url(#n)"/></svg>
  <div class="grid"></div><div class="leftwash"></div><div class="vig"></div>
  <div class="glow"></div>
  <div class="scene"><div class="win"><img src="pm.png" alt=""></div></div>
  <svg class="link" viewBox="0 0 1280 640" width="1280" height="640">
    <defs><linearGradient id="lk" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="{p['link']}" stop-opacity="0"/>
      <stop offset=".45" stop-color="{p['link']}" stop-opacity=".6"/>
      <stop offset="1" stop-color="{p['link']}" stop-opacity="0"/></linearGradient></defs>
    <path d="M398 500 C 470 500, 486 486, 520 470" fill="none" stroke="url(#lk)" stroke-width="1.3"/>
    <path d="M832 150 C 806 150, 792 168, 772 186" fill="none" stroke="url(#lk)" stroke-width="1.3"/>
  </svg>
  <div class="card code"><div class="ct">run_python · rnaseq_counts.csv</div><pre>{CODE}</pre></div>
  <div class="card chart"><img src="chart.png" alt="">
    <div class="cf"><span>control_vs_treatment_means.png</span><span>{t['ver']}</span></div></div>
  <div class="card prov"><div class="ct">{t['prov']}</div>
    <div class="ptabs">{tabs}</div>
    <div class="prow"><span class="dot"></span>{t['p1']}</div>
    <div class="prow"><span class="dot" style="background:{p['link']}"></span>{t['p2']}</div>
  </div>
  <div class="copy">
    <div class="name"><div><span>Paper</span><b>Machine</b></div>{t['cn']}</div>
    <div class="tag">{t['tag']}</div>
    <div class="eqwrap"><div class="eqlab">{t['eqlab']}</div><div class="eq">{terms}</div></div>
    <div class="chips">{chips}</div>
  </div>
</div></body></html>'''


if __name__ == '__main__':
    pal = sys.argv[1] if len(sys.argv) > 1 else 'blue'
    term = sys.argv[2] if len(sys.argv) > 2 else 'gold'
    for lang, out in (('en', 'hero.html'), ('zh', 'hero.zh.html')):
        open(out, 'w', encoding='utf-8').write(render(pal, lang, term).rstrip('\n') + '\n')
    print(f'wrote hero.html + hero.zh.html ({pal} / {term})')
