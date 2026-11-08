// The landing page's stylesheet, inlined in every page (one request less, no flash of unstyled text). The colours are the app's
// own tokens (src/client/theme.ts); the font is the system stack, which covers Vietnamese, so nothing is fetched from anywhere.
// The Chinese page adds the system CJK families to that stack (no web font, no download). Line heights stay at 1.2 or more:
// Vietnamese stacks two marks on one letter and loses them on a tighter line.
export const LANDING_CSS = `
:root{--bg:#f4f5f7;--surface:#fff;--text:#15171c;--muted:#535a66;--line:#e3e6eb;--accent:#2f5bea;--link:#2950ce;--ring:#2f5bea;--soft:#eaeffd;--glow:rgba(47,91,234,.14);--shadow:0 1px 2px rgba(16,24,40,.05);color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0d0f13;--surface:#14171c;--text:#ecedf2;--muted:#a6adba;--line:#262b33;--link:#97adf5;--ring:#8aa5f6;--soft:#18224a;--glow:rgba(47,91,234,.24);--shadow:none}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:1rem/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif;-webkit-font-smoothing:antialiased;overflow-wrap:break-word}
img{display:block;max-width:100%;height:auto}
a{color:var(--link)}
a:focus-visible,.btn:focus-visible{outline:2px solid var(--ring);outline-offset:3px;border-radius:.5rem}
main:focus{outline:none}
.wrap{width:min(100% - 2rem,68rem);margin-inline:auto}
.skip{position:absolute;left:.75rem;top:-6rem;z-index:10;padding:.75rem 1rem;border:2px solid var(--accent);border-radius:.5rem;background:var(--surface);color:var(--text);font-weight:600;text-decoration:none}
.skip:focus{top:.75rem}
.top{padding-block:.5rem}
.top .wrap{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.25rem 1rem}
.brand{display:inline-flex;align-items:center;gap:.625rem;min-height:44px;color:var(--text);font-size:1.0625rem;font-weight:700;text-decoration:none}
.brand img{border-radius:.5rem}
.lang{display:inline-flex;align-items:center;min-height:44px;padding-inline:.25rem;font-weight:500}
.langs{display:flex;flex-wrap:wrap;gap:0 .75rem}
.hero{padding-block:clamp(1.5rem,5vw,4rem) clamp(2.5rem,6vw,4.5rem);background:radial-gradient(48rem 22rem at 85% 0,var(--glow),transparent 70%)}
.hero-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:2rem;align-items:center}
.hero-grid>*{min-width:0}
h1,h2,h3,p,li{overflow-wrap:break-word;overflow-wrap:anywhere}
h1{margin:0 0 1rem;font-size:clamp(2rem,1.2rem + 3.6vw,3.25rem);font-weight:700;line-height:1.2;letter-spacing:-.015em}
.lead{max-width:38rem;margin:0 0 1.75rem;color:var(--muted);font-size:clamp(1.0625rem,1rem + .4vw,1.25rem)}
.mascot{width:min(100%,26rem);margin-inline:auto}
.cta{display:flex;flex-wrap:wrap;align-items:flex-start;gap:.75rem 1rem}
.cta-alt{display:flex;flex-direction:column;gap:.25rem}
.note{color:var(--muted);font-size:.875rem;line-height:1.4}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:.5rem 1.375rem;border:1px solid var(--line);border-radius:.75rem;background:var(--surface);color:var(--text);font-weight:600;line-height:1.3;text-align:center;text-decoration:none}
.btn-primary{border-color:var(--accent);background:var(--accent);color:#fff}
.band{padding-block:clamp(2.5rem,6vw,4.5rem);border-top:1px solid var(--line)}
.band h2{margin:0 0 1.5rem;font-size:clamp(1.5rem,1.1rem + 1.6vw,2.125rem);line-height:1.25;letter-spacing:-.01em}
.sub{max-width:44rem;margin:-.75rem 0 1.5rem;color:var(--muted)}
.grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,19rem),1fr));margin:0;padding:0;list-style:none}
.grid>*{min-width:0}
.card{padding:1.25rem 1.25rem 1.375rem;border:1px solid var(--line);border-radius:1rem;background:var(--surface);box-shadow:var(--shadow)}
.card h3{margin:0 0 .5rem;font-size:1.0625rem;line-height:1.35}
.card p{margin:0;color:var(--muted)}
.step{border-left:4px solid var(--accent)}
.checks{display:grid;grid-template-columns:minmax(0,1fr);gap:.75rem;margin:.75rem 0 0;padding:0;list-style:none;color:var(--muted)}
.checks li{position:relative;padding-left:1.5rem}
.checks li::before{content:"";position:absolute;left:.2rem;top:.6em;width:.55rem;height:.55rem;border-radius:50%;background:var(--accent)}
.caveat{max-width:46rem;margin:1.5rem 0 0;padding-left:1rem;border-left:4px solid var(--accent)}
.faq{display:grid;grid-template-columns:minmax(0,1fr);gap:1.5rem;max-width:46rem}
.faq h3{margin:0 0 .375rem;font-size:1.0625rem;line-height:1.35}
.faq p{margin:0;color:var(--muted)}
.closing .panel{padding:clamp(1.5rem,4vw,3rem);border:1px solid var(--line);border-radius:1.25rem;background:var(--soft);text-align:center}
.closing h2{margin-bottom:.75rem}
.closing p{max-width:34rem;margin:0 auto 1.5rem;color:var(--muted)}
.closing .cta{justify-content:center}
.closing .cta-alt{align-items:center}
.foot{padding-block:2rem;border-top:1px solid var(--line)}
.foot p{max-width:40rem;margin:0 0 .5rem;color:var(--muted)}
.foot ul{display:flex;flex-wrap:wrap;gap:0 1.25rem;margin:0;padding:0;list-style:none}
.foot a,.foot li span{display:inline-flex;align-items:center;min-height:44px}
.foot li span{color:var(--text);font-weight:600}
@media (min-width:56rem){.hero-grid{grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr)}}
@media (max-width:30rem){.cta{flex-direction:column;align-items:stretch}.cta .btn{width:100%;overflow-wrap:anywhere}.cta-alt{align-items:stretch}.note{text-align:center}}
.btn:hover{border-color:var(--accent)}
.btn-primary:hover{border-color:#2549c2;background:#2549c2}
@media (prefers-reduced-motion:no-preference){.btn{transition:background-color .15s,border-color .15s}}
html:lang(zh-CN) body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Helvetica Neue",Arial,sans-serif}
html:lang(zh-CN) h1,html:lang(zh-CN) .band h2{letter-spacing:0;text-wrap:balance}
html:lang(zh-CN) .lead{text-wrap:pretty}
`.trim();
