import { DARK, FONT_FACE_CSS, FONT_MONO, FONT_SANS, LIGHT, MOTION, paletteToCssVars } from '../../shared/design/tokens';

// The mini UI inside a picture well on a dark ground (dark mode everywhere, and the dark encryption tile in light mode): a level lighter
// than the well, with hairlines a level lighter than that and a lifted third text colour so its small text keeps 4.5:1. Token values
// only (custom properties cannot refer to themselves, so the dark palette is named here).
const DARK_MINI = `--bg:color-mix(in srgb,${DARK.raised} 25%,${DARK.border});--surface:color-mix(in srgb,${DARK.border} 50%,${DARK.borderStrong});--raised:color-mix(in srgb,${DARK.borderStrong} 75%,${DARK.border});--border:${DARK.borderStrong};--border-strong:color-mix(in srgb,${DARK.borderStrong} 60%,${DARK.control});--text3:color-mix(in srgb,${DARK.text3} 40%,${DARK.text2})`;

// The landing page's stylesheet, inlined in every page (one request less, no flash of unstyled text). Colours, fonts and motion come
// from src/shared/design/tokens.ts, the same source as the app: light in :root, dark under prefers-color-scheme (the page follows
// the visitor's system setting, it has no switch). The code surface is dark in both themes, so it reads the DARK palette by name.
// The font is served from this origin (/fonts, see FONT_FACE_CSS); the system stack behind it covers the Chinese page's CJK.
// Depth is restrained: one soft accent glow behind the product window and the closing band, a faint hairline grid that fades out in
// those two places only (never in a card well), and fades at the edge of a cropped fragment. No gradient text, no blur, no
// animation; transitions only when the visitor allows motion. Surfaces step page < band < card < mini UI (--band, --card, --well,
// --mini: plain tokens in light mode, color-mix steps of the dark palette in dark mode).
// Line heights stay at 1.2 or more where Vietnamese can appear (two marks stack on one letter).
// Each rule is one line: test/site/layout.test.ts finds the rules it guards by the start of the line. Groups follow the components.
export const LANDING_CSS = `
${FONT_FACE_CSS}
:root{${paletteToCssVars(LIGHT)};color-scheme:light dark;--gut:1rem;--ctl:36px;--seg:36px;--top:3.75rem;--mono:${FONT_MONO};--h1:clamp(2.5rem,1.4rem + 3.6vw,4rem);--glow:color-mix(in srgb,var(--accent) 22%,transparent);--code-bg:${DARK.surface};--code-bar:${DARK.raised};--code-border:${DARK.borderStrong};--code-text:${DARK.text};--code-text2:${DARK.text2};--code-text3:${DARK.text3};--code-accent:${DARK.accentText};--band:var(--surface);--card:var(--surface);--well:var(--bg);--mini:var(--surface)}
@media (prefers-color-scheme:dark){:root{${paletteToCssVars(DARK)}}}
@media (prefers-color-scheme:dark){:root{--glow:color-mix(in srgb,var(--accent) 14%,transparent);--code-bg:${DARK.bg};--code-bar:${DARK.raised};--band:color-mix(in srgb,var(--surface) 55%,var(--raised));--card:color-mix(in srgb,var(--raised) 25%,var(--border));--well:var(--card);--mini:color-mix(in srgb,var(--border) 50%,var(--border-strong))}}
@media (pointer:coarse),(max-width:40rem){:root{--ctl:44px;--seg:44px}}
@media (min-width:40rem){:root{--gut:1.5rem}}
@media (min-width:64rem){:root{--gut:2rem}}
/* base */
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:400 1rem/1.6 ${FONT_SANS};font-synthesis:none;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;overflow-wrap:break-word}
img{display:block;max-width:100%;height:auto}
.ic{flex:none;width:1rem;height:1rem}
a{color:var(--accent-text);text-underline-offset:.2em}
a:focus-visible,summary:focus-visible,pre:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}
main:focus{outline:none}
.wrap{width:min(100% - 2 * var(--gut),72rem);margin-inline:auto}
.vh{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.mono{font-family:var(--mono)}
.skip{position:absolute;left:.75rem;top:-6rem;z-index:50;padding:.625rem 1rem;border:2px solid var(--accent);border-radius:6px;background:var(--surface);color:var(--text);font-weight:600;text-decoration:none}
.skip:focus{top:.75rem}
h1,h2,h3,p,li{overflow-wrap:break-word;overflow-wrap:anywhere}
h2[id]{scroll-margin-top:calc(var(--top) + 1px + 1rem + 1.875rem)}
h3{margin:0 0 .5rem;font-size:1rem;font-weight:600;line-height:1.5rem;letter-spacing:-.01em;text-wrap:pretty}
/* button */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;min-height:44px;padding:.5rem 1.25rem;border:1px solid var(--border-strong);border-radius:6px;background:linear-gradient(180deg,var(--surface),var(--raised));box-shadow:0 1px 2px color-mix(in srgb,var(--text) 6%,transparent),inset 0 1px 0 color-mix(in srgb,white 80%,transparent);color:var(--text);font-size:.9375rem;font-weight:500;line-height:1.3;letter-spacing:-.01em;text-align:center;text-decoration:none}
.btn:hover{border-color:var(--control);background:var(--raised);box-shadow:0 2px 6px color-mix(in srgb,var(--text) 8%,transparent),inset 0 1px 0 color-mix(in srgb,white 90%,transparent)}
.btn:active{background:var(--border);box-shadow:inset 0 1px 2px color-mix(in srgb,black 12%,transparent)}
.btn-primary{border-color:var(--accent);background:linear-gradient(180deg,var(--accent),var(--accent-hover));color:white;box-shadow:0 1px 2px color-mix(in srgb,var(--accent) 35%,transparent),0 3px 12px -2px color-mix(in srgb,var(--accent) 30%,transparent),inset 0 1px 0 color-mix(in srgb,white 28%,transparent);text-shadow:0 1px 1px color-mix(in srgb,black 20%,transparent)}
.btn-primary:hover{border-color:var(--accent-hover);background:var(--accent-hover);box-shadow:0 2px 4px color-mix(in srgb,var(--accent) 40%,transparent),0 6px 20px -2px color-mix(in srgb,var(--accent) 40%,transparent),inset 0 1px 0 color-mix(in srgb,white 35%,transparent)}
.btn-primary:active{background:var(--accent-hover);box-shadow:inset 0 1px 3px color-mix(in srgb,black 25%,transparent)}
.btn-sm{min-height:var(--ctl);padding-inline:.875rem;font-size:.875rem}
.cta{display:flex;flex-wrap:wrap;align-items:flex-start;gap:.75rem}
.cta-alt{display:flex;flex-direction:column;gap:.375rem}
.note{color:var(--text2);font-size:.8125rem;line-height:1.4;text-align:center}
.pill{display:inline-flex;align-items:center;gap:.5rem;min-height:30px;padding:.25rem .875rem .25rem .6875rem;border:1px solid var(--border-strong);border-radius:999px;background:linear-gradient(180deg,var(--surface),var(--raised));box-shadow:0 1px 2px color-mix(in srgb,var(--text) 5%,transparent),inset 0 1px 0 color-mix(in srgb,white 60%,transparent);color:var(--text);font-size:.8125rem;font-weight:500;line-height:1.25;letter-spacing:-.01em}
.pill .ic{width:.875rem;height:.875rem;color:var(--accent-text)}
/* top bar and its menus */
.top{position:sticky;top:0;z-index:30;border-bottom:1px solid var(--border);background:var(--bg)}
.top::after{content:"";position:absolute;top:calc(100% + 1px);right:0;left:0;height:.625rem;background:linear-gradient(var(--bg),transparent);pointer-events:none}
.bar{position:relative;display:flex;align-items:center;gap:.5rem;min-height:var(--top)}
.brand{display:inline-flex;align-items:center;gap:.625rem;min-height:44px;margin-right:auto;border-radius:6px;color:var(--text);font-size:.9375rem;font-weight:600;letter-spacing:-.015em;text-decoration:none;white-space:nowrap}
.brand img{width:28px;height:28px}
.links{display:none}
.nav-link{display:inline-flex;align-items:center;gap:.5rem;min-height:var(--ctl);padding-inline:.875rem;border-radius:6px;color:var(--text2);font-size:.875rem;font-weight:500;line-height:1.25;letter-spacing:-.01em;text-decoration:none;white-space:nowrap}
.nav-link:hover{background:var(--hover);color:var(--text)}
.nav-link:active{background:var(--border)}
.gh{display:none}
.drop{position:relative}
.drop>summary{display:inline-flex;align-items:center;justify-content:center;gap:.375rem;min-width:var(--ctl);min-height:var(--ctl);padding-inline:.75rem;border:1px solid transparent;border-radius:6px;color:var(--text2);font-size:.875rem;font-weight:500;line-height:1.25;white-space:nowrap;cursor:pointer;list-style:none}
.drop>summary::-webkit-details-marker{display:none}
.drop>summary:hover{background:var(--hover);color:var(--text)}
.drop>summary:active{background:var(--border)}
.drop[open]>summary{border-color:var(--border);background:var(--surface);box-shadow:var(--shadow-sm);color:var(--text)}
.drop[open] .chev{transform:rotate(180deg)}
.pop{position:absolute;top:calc(100% + .5rem);right:0;z-index:40;min-width:13.5rem;padding:.375rem;border:1px solid var(--border);border-radius:10px;background:var(--surface);box-shadow:0 8px 24px -4px color-mix(in srgb,var(--text) 10%,transparent),0 2px 6px color-mix(in srgb,var(--text) 5%,transparent)}
.seg{display:grid;gap:2px}
.seg a,.seg span{display:flex;align-items:center;justify-content:space-between;gap:.75rem;min-height:var(--seg);padding-inline:.75rem;border-radius:6px;color:var(--text);font-size:.875rem;line-height:1.25;text-decoration:none}
.seg a:hover{background:var(--hover)}
.seg a:active{background:var(--border)}
.seg span{background:var(--accent-soft);color:var(--accent-text);font-weight:600}
.menu{position:static}
.menu>summary{border-color:var(--border);background:var(--surface);color:var(--text)}
.menu .pop{left:0;right:0;top:calc(100% + 1px);border-radius:0 0 10px 10px}
.menu-links{display:grid;gap:2px}
.menu-link{display:flex;align-items:center;gap:.625rem;min-height:44px;padding-inline:.75rem;border-radius:6px;color:var(--text);font-size:.9375rem;font-weight:500;text-decoration:none}
.menu-link:hover{background:var(--hover)}
.menu-link:active{background:var(--border)}
.menu-sep{height:1px;margin:.25rem .75rem;background:var(--border)}
@media (min-width:40rem){.gh{display:inline-flex}.menu-gh,.menu-sep{display:none}}
@media (min-width:64rem){.links{display:flex;align-items:center;gap:.125rem;margin-right:auto}.brand{margin-right:1rem}.menu{display:none}}
@media (max-width:40rem){.lang-name,.lang .chev{display:none}.drop>summary{padding-inline:0;border-color:var(--border);background:var(--surface)}}
@media (max-width:22.4375rem){.brand-name{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}}
/* hero: pills, headline, product window */
.hero{position:relative;isolation:isolate;overflow:hidden;padding-top:clamp(2.5rem,1.25rem + 4vw,4.5rem)}
.hero::before{content:"";position:absolute;inset:0 0 auto;z-index:-2;height:52rem;background-image:linear-gradient(color-mix(in srgb,var(--border) 50%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--border) 50%,transparent) 1px,transparent 1px);background-size:48px 48px;background-position:calc(50% - 24px) 23px;-webkit-mask-image:linear-gradient(transparent 2rem,black 9rem),radial-gradient(ellipse 85% 70% at 50% 0,black 30%,transparent 78%);mask-image:linear-gradient(transparent 2rem,black 9rem),radial-gradient(ellipse 85% 70% at 50% 0,black 30%,transparent 78%);-webkit-mask-composite:source-in;mask-composite:intersect}
.hero-grid{display:grid;grid-template-columns:minmax(0,1fr);justify-items:start}
.hero-grid>*{min-width:0}
.pills{display:flex;flex-wrap:wrap;gap:.5rem;margin:0 0 1.5rem}
h1{max-width:15em;margin:0 0 1.25rem;font-size:var(--h1);font-weight:600;line-height:1.08;letter-spacing:-.035em;text-wrap:balance}
.lead{max-width:38rem;margin:0 0 2rem;color:var(--text2);font-size:clamp(1.0625rem,1rem + .35vw,1.25rem);line-height:1.6;letter-spacing:-.01em;text-wrap:pretty}
@media (min-width:64rem){.hero-grid{grid-template-columns:minmax(0,calc(8.4 * var(--h1))) minmax(0,1fr);column-gap:3rem;align-items:start}.pills{grid-column:1 / -1}.hero-grid h1{margin-bottom:0}.hero-side{padding-top:.125rem}.hero-side .lead{max-width:none;margin-bottom:1.75rem;font-size:1.125rem}}
@media (min-width:72rem){.hero-grid{column-gap:4rem}}
@media (min-width:64rem){html:lang(vi) .hero-grid{grid-template-columns:minmax(0,calc(9.1 * var(--h1))) minmax(0,1fr)}html:lang(vi) .hero-side{padding-top:.3125rem}html:lang(zh-CN) .hero-grid{grid-template-columns:minmax(0,calc(6.25 * var(--h1))) minmax(0,1fr)}html:lang(zh-CN) .hero-side .lead{max-width:34rem}}
.shot{position:relative;margin-top:clamp(2.5rem,1rem + 3.5vw,4.5rem)}
.shot::before{content:"";position:absolute;left:5%;right:5%;top:-16%;z-index:-1;height:95%;background:radial-gradient(ellipse 70% 55% at 50% 35%,var(--glow),transparent);pointer-events:none}
.shot::after{content:"";position:absolute;right:-3rem;bottom:0;left:-3rem;z-index:1;height:10rem;background:linear-gradient(transparent,var(--bg) 82%);pointer-events:none}
@media (min-width:40rem){.frame picture{aspect-ratio:1440/560;overflow:hidden}}
.frame{overflow:hidden;border:1px solid var(--border-strong);border-radius:12px;background:var(--surface);box-shadow:0 0 0 1px color-mix(in srgb,var(--border-strong) 65%,transparent),0 1px 3px color-mix(in srgb,var(--text) 6%,transparent),0 8px 24px -4px color-mix(in srgb,var(--text) 8%,transparent),0 24px 60px -12px color-mix(in srgb,var(--text) 12%,transparent),0 40px 90px -20px color-mix(in srgb,var(--accent) 22%,transparent)}
@media (prefers-color-scheme:dark){.frame{border-color:color-mix(in srgb,var(--text) 18%,var(--border-strong));box-shadow:0 0 0 1px color-mix(in srgb,var(--text) 14%,transparent),0 2px 8px color-mix(in srgb,black 50%,transparent),0 16px 40px -8px color-mix(in srgb,black 75%,transparent),0 32px 80px -16px color-mix(in srgb,black 85%,transparent),0 40px 100px -24px color-mix(in srgb,var(--accent) 30%,transparent)}}
.frame-bar{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:1rem;height:2.625rem;padding-inline:1rem;border-bottom:1px solid var(--border);background:linear-gradient(180deg,var(--raised),color-mix(in srgb,var(--raised) 85%,var(--surface)))}
.dots{display:flex;flex:none;align-items:center;gap:7px}
.dots i{width:11px;height:11px;border-radius:999px;background:var(--border-strong)}
.dots i:nth-child(1){background:var(--danger);box-shadow:inset 0 0 0 1px color-mix(in srgb,black 18%,transparent),0 1px 2px color-mix(in srgb,var(--danger) 35%,transparent)}
.dots i:nth-child(2){background:var(--warning);box-shadow:inset 0 0 0 1px color-mix(in srgb,black 18%,transparent),0 1px 2px color-mix(in srgb,var(--warning) 35%,transparent)}
.dots i:nth-child(3){background:var(--success);box-shadow:inset 0 0 0 1px color-mix(in srgb,black 18%,transparent),0 1px 2px color-mix(in srgb,var(--success) 35%,transparent)}
.url{display:inline-flex;align-items:center;gap:.4375rem;min-width:0;padding:.25rem 1.125rem;border:1px solid var(--border);border-radius:999px;background:var(--surface);box-shadow:inset 0 1px 1px color-mix(in srgb,var(--text) 4%,transparent),0 1px 2px color-mix(in srgb,var(--text) 3%,transparent);color:var(--text2);font:500 .75rem/1.25 var(--mono);letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.url .ic{width:.75rem;height:.75rem;color:var(--success)}
.url>span{min-width:0;overflow:hidden;text-overflow:ellipsis}
.frame picture{display:block}
.frame img{width:100%}
@media (max-width:40rem){.frame img{aspect-ratio:3/4;object-fit:cover;object-position:0 0}}
/* technology strip */
.strip{border-block:1px solid var(--border)}
.strip-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:1rem 2.75rem;padding-block:1.75rem}
.strip-label{margin:0;color:var(--text3);font-size:.75rem;font-weight:600;line-height:1rem;letter-spacing:.08em;text-transform:uppercase}
.marks{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:.875rem 2.75rem;margin:0;padding:0;list-style:none}
.marks li{display:inline-flex;align-items:center;gap:.5rem;color:var(--text2);font-size:.9375rem;font-weight:600;letter-spacing:-.01em;white-space:nowrap}
.marks li:hover{color:var(--text)}
.marks .ic{width:1.125rem;height:1.125rem;color:var(--text3)}
.marks li:hover .ic{color:var(--accent-text)}
/* section bands and headers */
.band{padding-block:clamp(4rem,1.5rem + 5vw,6rem)}
.band-alt{border-block:1px solid var(--border);background:var(--band)}
.strip+.band-alt{border-top:0}
.sh{display:grid;gap:.875rem;max-width:44rem;margin-bottom:clamp(2.5rem,1.5rem + 2.5vw,3.5rem)}
.eyebrow{margin:0;color:var(--accent-text);font-size:.75rem;font-weight:600;line-height:1rem;letter-spacing:.08em;text-transform:uppercase}
.band h2{margin:0;font-size:clamp(1.75rem,1.2rem + 1.6vw,2.5rem);font-weight:600;line-height:1.2;letter-spacing:-.025em;text-wrap:balance}
.sub{max-width:40rem;margin:0;color:var(--text2);font-size:1.0625rem;line-height:1.75rem}
/* benefit cards */
.cards{display:grid;grid-template-columns:minmax(0,1fr);gap:1.25rem}
.card{display:flex;flex-direction:column;min-width:0;overflow:hidden;border:1px solid var(--border);border-radius:12px;background:var(--card);box-shadow:0 1px 3px color-mix(in srgb,var(--text) 4%,transparent),0 0 0 1px var(--border)}
.card:hover{border-color:color-mix(in srgb,var(--accent) 35%,var(--border-strong));box-shadow:0 8px 24px -4px color-mix(in srgb,var(--text) 8%,transparent),0 0 20px -4px color-mix(in srgb,var(--accent) 15%,transparent)}
.card-visual{position:relative;display:grid;place-items:start center;min-height:16.5rem;padding:1.5rem;overflow:hidden;border-bottom:1px solid var(--border);background:var(--well)}
.card-visual>*{width:100%;max-width:20.5rem}
.card-visual .fx{border-color:var(--border-strong);font-size:.8125rem;line-height:1.375rem}
.card-visual .badge,.card-visual .fx-none s{font-size:.75rem}
.card-body{padding:1.5rem}
.card-body h3{margin:0 0 .5rem;font-size:1.0625rem;font-weight:600;line-height:1.4;letter-spacing:-.015em}
.card-body p,.tile-body p,.step p{margin:0;color:var(--text2);font-size:.9375rem;line-height:1.55;text-wrap:pretty}
@media (min-width:56rem){.cards{grid-template-columns:repeat(3,minmax(0,1fr))}.card-visual{height:16.5rem}}
/* features bento: plain picture wells (the page's only textures are the hero's and the closing band's), one soft glow behind the phone;
   the encryption tile is the emphasised one: on the dark palette in light mode, an accent edge and an accent key in dark mode */
.bento{display:grid;grid-template-columns:minmax(0,1fr);gap:1.25rem}
.tile{position:relative;display:flex;flex-direction:column;min-width:0;overflow:hidden;border:1px solid var(--border);border-radius:12px;background:var(--card);box-shadow:0 1px 3px color-mix(in srgb,var(--text) 4%,transparent),0 0 0 1px var(--border)}
.tile:hover{border-color:color-mix(in srgb,var(--accent) 40%,var(--border-strong));box-shadow:0 8px 28px -4px color-mix(in srgb,var(--text) 8%,transparent),0 0 24px -4px color-mix(in srgb,var(--accent) 18%,transparent)}
.tile-art{position:relative;display:grid;flex:none;place-items:center;min-height:16rem;padding:1.5rem;overflow:hidden;border-bottom:1px solid var(--border);background:var(--well)}
.tile-d .tile-art{background:radial-gradient(ellipse 75% 60% at 50% 0,color-mix(in srgb,var(--accent) 14%,transparent),transparent),var(--well)}
.tile-e{${paletteToCssVars(DARK)};border-color:var(--border-strong);background:var(--surface);box-shadow:inset 0 1px 0 color-mix(in srgb,white 12%,transparent),0 2px 8px color-mix(in srgb,black 35%,transparent);color:var(--text)}
.tile-e .tile-art{border-bottom-color:var(--border);background:var(--bg)}
.tile-e:hover{border-color:var(--accent);box-shadow:inset 0 1px 0 color-mix(in srgb,white 18%,transparent),0 8px 30px -4px color-mix(in srgb,black 50%,transparent),0 0 24px -4px color-mix(in srgb,var(--accent) 30%,transparent)}
.tile-e .fx{${DARK_MINI}}
.tile-e .fx-lock{background:var(--accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 25%,transparent),0 2px 8px color-mix(in srgb,var(--accent) 40%,transparent);color:white}
@media (prefers-color-scheme:dark){.tile-e{border-color:color-mix(in srgb,var(--accent) 60%,var(--border-strong));background:var(--card);box-shadow:inset 0 1px 0 color-mix(in srgb,white 8%,transparent),0 4px 16px color-mix(in srgb,black 50%,transparent)}.tile-e:hover{border-color:var(--accent);box-shadow:inset 0 1px 0 color-mix(in srgb,white 15%,transparent),0 8px 32px -4px color-mix(in srgb,black 70%,transparent),0 0 28px -4px color-mix(in srgb,var(--accent) 35%,transparent)}.tile-e .tile-art{background:var(--well)}}
.tile-body{flex:1;padding:1.5rem}
.tile-body h3{margin:0 0 .5rem;font-size:1.0625rem;font-weight:600;line-height:1.4;letter-spacing:-.015em}
.tile-wide .tile-body p,.tile-full .tile-body p{max-width:38rem}
.tile-small .tile-art{place-items:start center}
.tile-phone .tile-art{height:21rem;min-height:0;place-items:start center;padding-bottom:0}
.tile-phone .tile-art::after{content:"";position:absolute;right:0;bottom:0;left:0;height:6rem;background:linear-gradient(transparent,var(--well) 85%);pointer-events:none}
@media (min-width:48rem){.bento{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-areas:"a a" "b c" "d e" "f f"}.tile-a{grid-area:a}.tile-b{grid-area:b}.tile-c{grid-area:c}.tile-d{grid-area:d}.tile-e{grid-area:e}.tile-f{grid-area:f}.tile-art{height:21rem;min-height:0}}
@media (min-width:72rem){.bento{grid-template-columns:repeat(3,minmax(0,1fr));grid-template-areas:"a a d" "b c e" "f f f"}.tile-full{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,3fr)}.tile-full .tile-art{order:2;height:auto;min-height:0;padding:2rem 2.5rem;border-bottom:0;border-left:1px solid var(--border)}.tile-full .fx-admin{max-width:none}.tile-full .tile-body{align-self:start;padding:2rem 1.5rem}}
/* product fragments (decorative sample UI, aria-hidden) */
.fx{position:relative;width:100%;overflow:hidden;border:1px solid var(--border);border-radius:10px;background:var(--surface);box-shadow:0 4px 16px -2px color-mix(in srgb,var(--text) 6%,transparent),0 0 0 1px var(--border);color:var(--text);font-size:.75rem;line-height:1.25rem;text-align:left}
.fx b{font-weight:600}
.fx time{color:var(--text3);font-size:.6875rem;font-variant-numeric:tabular-nums}
.fx .mono{font-size:.6875rem}
.addr{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fx-bar{display:flex;align-items:center;justify-content:space-between;gap:.5rem;height:2.25rem;padding-inline:.75rem;border-bottom:1px solid var(--border);background:linear-gradient(180deg,var(--raised),color-mix(in srgb,var(--raised) 85%,var(--surface)));color:var(--text2);font-weight:500}
.fx-bar-title{display:inline-flex;align-items:center;gap:.4375rem;min-width:0;white-space:nowrap}
.av{display:inline-grid;flex:none;place-items:center;width:1.5rem;height:1.5rem;border-radius:999px;background:var(--raised);box-shadow:inset 0 0 0 1px var(--border);color:var(--text2);font-size:.6875rem;font-weight:600;letter-spacing:.02em}
.av-a{background:var(--accent-soft);box-shadow:none;color:var(--accent-text)}
.av-ghost{background:transparent;box-shadow:inset 0 0 0 1px var(--border-strong);color:var(--text3)}
.is-picked .av-a{background:var(--surface)}
.chip .av{width:1.375rem;height:1.375rem;font-size:.6875rem}
.badge{display:inline-flex;flex:none;align-items:center;gap:.25rem;padding:.0625rem .5rem;border:1px solid var(--border);border-radius:999px;background:var(--raised);box-shadow:0 1px 2px color-mix(in srgb,var(--text) 3%,transparent);color:var(--text2);font-size:.6875rem;font-weight:500;line-height:1rem;white-space:nowrap}
.badge .ic{width:.75rem;height:.75rem}
.badge-accent{border-color:transparent;background:var(--accent-soft);color:var(--accent-text)}
.badge-success{border-color:transparent;background:var(--success-soft);color:var(--success)}
.fx-row{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr);gap:.625rem;align-items:start;padding:.5625rem .625rem .5625rem 1.375rem}
.fx-row+.fx-row{border-top:1px solid var(--border)}
.fx-row-text{display:grid;gap:.3125rem;min-width:0}
.fx-row-top{display:flex;align-items:baseline;justify-content:space-between;gap:.5rem;min-width:0;line-height:1rem;white-space:nowrap}
.fx-row-top b{overflow:hidden;font-weight:500;text-overflow:ellipsis}
.fx-subject{display:block;min-width:0;overflow:hidden;color:var(--text2);line-height:1rem;text-overflow:ellipsis;white-space:nowrap}
.is-unread .fx-subject{color:var(--text);font-weight:500}
.fx-field .fx-subject{flex:1;color:var(--text)}
.is-unread .fx-row-top b{font-weight:600}
.is-unread::before{content:"";position:absolute;left:.5625rem;top:1.0625rem;width:.3125rem;height:.3125rem;border-radius:999px;background:var(--accent);box-shadow:0 0 6px var(--accent)}
.is-picked{background:var(--accent-soft)}
.fx-mailbox{display:grid;grid-template-columns:minmax(0,9.5rem) minmax(0,1fr);max-width:46rem}
.fx-reader{display:none;align-content:start;gap:.5rem;min-width:0;padding:.875rem 1rem;border-left:1px solid var(--border)}
.fx-reader-subject{font-size:.875rem;line-height:1.25rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fx-reader-from{display:flex;align-items:center;gap:.5rem;min-width:0;margin-bottom:.375rem;white-space:nowrap}
.fx-reader-who{display:grid;min-width:0;line-height:1rem}
.fx-reader-who .addr{color:var(--text3);font-size:.6875rem}
.fx-reader-from time{margin-left:auto}
.fx-reader-body{display:-webkit-box;overflow:hidden;color:var(--text2);line-height:1.25rem;-webkit-box-orient:vertical;-webkit-line-clamp:4}
.fx-reader .fx-file{justify-self:start;margin:.375rem 0 0;padding-right:.75rem}
.fx-reader-actions{display:flex;gap:.5rem;margin-top:.25rem}
.fx-ghost{display:inline-flex;align-items:center;gap:.375rem;height:1.75rem;padding-inline:.625rem;border:1px solid var(--border-strong);border-radius:6px;color:var(--text2);font-weight:500}
.fx-ghost .ic{width:.75rem;height:.75rem}
@media (min-width:48rem){.fx-mailbox{grid-template-columns:minmax(0,9rem) minmax(0,15rem) minmax(0,1fr)}.fx-reader{display:grid}}
.fx-side{padding:.625rem .5rem;border-right:1px solid var(--border)}
.fx-compose{display:flex;align-items:center;justify-content:center;gap:.375rem;height:1.875rem;margin-bottom:.5rem;border-radius:6px;background:var(--accent);box-shadow:0 2px 6px color-mix(in srgb,var(--accent) 30%,transparent);color:white;font-weight:500;white-space:nowrap}
.fx-folders{display:grid;gap:1px;margin:0;padding:0;list-style:none}
.fx-folders li{display:flex;align-items:center;gap:.5rem;height:1.5rem;padding-inline:.5rem;border-radius:6px;color:var(--text2);white-space:nowrap;overflow-wrap:normal}
.fx-folders li span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.fx-folders li b{color:var(--text3);font-weight:500;font-variant-numeric:tabular-nums}
.fx-folders .is-on{background:var(--accent-soft);color:var(--accent-text);font-weight:500}
.fx-folders .is-on b{color:var(--accent-text);font-weight:600}
.fx-list{display:grid;align-content:start;gap:2px;padding:.625rem .5rem}
.fx-search{display:flex;align-items:center;gap:.5rem;height:1.875rem;margin-bottom:.375rem;padding-inline:.5rem;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text3)}
.fx-search span{flex:1}
.fx-search kbd{padding:0 .3125rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);font:500 .6875rem/1rem var(--mono)}
.fx-list .fx-row{border-radius:6px}
.fx-list .fx-row+.fx-row{border-top:0}
.fx-compose-win{width:100%;max-width:19rem}
.fx-field{display:flex;align-items:center;gap:.5rem;min-height:2.25rem;padding-inline:.75rem;border-bottom:1px solid var(--border)}
.fx-label{flex:none;width:3.5rem;color:var(--text3)}
.chip{display:inline-flex;align-items:center;gap:.375rem;min-width:0;padding:.125rem .5rem .125rem .1875rem;border:1px solid var(--border);border-radius:999px;background:var(--raised);box-shadow:0 1px 2px color-mix(in srgb,var(--text) 3%,transparent);white-space:nowrap}
.chip .addr{overflow:hidden;text-overflow:ellipsis}
.fx-body{display:grid;gap:.5rem;padding:.875rem .75rem;min-height:4.5rem}
.fx-typing{color:var(--text)}
.fx-typing::after{content:"";display:inline-block;width:1px;height:1em;margin-left:2px;vertical-align:-.15em;background:var(--accent)}
.fx-file{display:inline-flex;align-items:center;gap:.5rem;margin:0 .75rem .75rem;padding:.375rem .5rem;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text2)}
.fx-foot{display:flex;align-items:center;gap:.75rem;padding:.625rem .75rem;border-top:1px solid var(--border);color:var(--text3)}
.fx-send{display:inline-flex;align-items:center;gap:.375rem;height:1.75rem;padding-inline:.75rem;border-radius:6px;background:var(--accent);box-shadow:0 2px 6px color-mix(in srgb,var(--accent) 30%,transparent);color:white;font-weight:500}
.fx-send .ic{width:.75rem;height:.75rem}
.fx-feedwrap{position:relative;width:100%;max-width:19rem;padding-top:4rem}
.fx-toast{position:absolute;top:0;left:0;right:0;z-index:1;display:flex;align-items:center;gap:.625rem;width:auto;padding:.625rem .75rem;border:1px solid var(--border);border-radius:8px;background:var(--surface);box-shadow:0 8px 24px -4px color-mix(in srgb,black 35%,transparent)}
.fx-toast>.ic{color:var(--accent-text)}
.fx-toast-text{display:grid;min-width:0;line-height:1.125rem}
.fx-toast-text span{overflow:hidden;color:var(--text2);text-overflow:ellipsis;white-space:nowrap}
.fx-dot{flex:none;width:.5rem;height:.5rem;margin-left:auto;border-radius:999px;background:var(--accent);box-shadow:0 0 6px var(--accent)}
.fx-phone{width:16rem;max-width:100%;padding:.4375rem;border:1px solid var(--border-strong);border-radius:1.75rem;background:var(--surface);box-shadow:0 20px 48px -12px color-mix(in srgb,black 40%,transparent),0 0 0 1px var(--border-strong);color:var(--text);font-size:.75rem;line-height:1.25rem;text-align:left}
.fx-phone-screen{position:relative;height:27rem;overflow:hidden;border:1px solid var(--border);border-radius:1.375rem;background:var(--surface)}
.fx-phone-status{display:flex;align-items:center;justify-content:space-between;height:1.875rem;padding-inline:1rem;font-size:.6875rem;font-weight:600}
.fx-phone-status time{color:var(--text);font-size:.6875rem}
.fx-island{width:2.75rem;height:.75rem;border-radius:999px;background:var(--code-bg);box-shadow:0 0 0 1px var(--code-border)}
.fx-batt{width:.875rem;height:.4375rem;border:1px solid var(--text3);border-radius:2px}
.fx-phone-head{display:flex;align-items:center;justify-content:space-between;padding:.25rem .875rem .5rem;font-size:.9375rem;line-height:1.5rem}
.fx-phone-head .ic{color:var(--text3)}
.fx-phone .fx-row{padding-inline:1.375rem .875rem}
.fx-phone time{color:var(--text3);font-size:.6875rem;font-variant-numeric:tabular-nums}
.fx-fab{position:absolute;right:.75rem;bottom:1.5rem;display:grid;place-items:center;width:2.25rem;height:2.25rem;border-radius:.75rem;background:var(--accent);box-shadow:0 4px 12px color-mix(in srgb,var(--accent) 40%,transparent);color:white}
.fx-home{position:absolute;bottom:.4375rem;left:50%;width:4rem;height:.25rem;margin-left:-2rem;border-radius:999px;background:var(--text)}
.fx-key{width:100%;max-width:19rem;padding:1rem}
.fx-key-head{display:flex;align-items:center;gap:.75rem;margin-bottom:.875rem}
.fx-lock{display:grid;flex:none;place-items:center;width:2.25rem;height:2.25rem;border-radius:999px;background:var(--accent-soft);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 15%,transparent);color:var(--accent-text)}
.fx-key-name{display:grid;min-width:0;line-height:1.125rem}
.fx-key-name span{color:var(--text3)}
.fx-fp{display:block;margin-bottom:.875rem;padding:.5rem .625rem;border:1px dashed var(--border-strong);border-radius:6px;background:var(--bg);color:var(--text2);font:500 .6875rem/1.125rem var(--mono);letter-spacing:.04em;word-spacing:.2em}
.fx-sealed{display:grid;gap:.375rem}
.fx-sealed-title{color:var(--text3);font-size:.6875rem;font-weight:500;line-height:1rem}
.fx-sealed-row{display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.375rem .5rem;border-radius:6px;background:var(--raised);box-shadow:0 1px 2px color-mix(in srgb,var(--text) 3%,transparent);color:var(--text2)}
.fx-sealed-row code{display:inline-flex;align-items:center;gap:.25rem;color:var(--text3);font:500 .6875rem/1rem var(--mono)}
.fx-sealed-row .ic{width:.75rem;height:.75rem;color:var(--accent-text)}
.fx-admin{max-width:34rem}
.fx-tr{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1.5fr) minmax(0,.9fr);gap:.75rem;align-items:center;min-height:2.5rem;padding-inline:.75rem;border-bottom:1px solid var(--border)}
.fx-th{min-height:1.875rem;background:var(--bg);color:var(--text3);font-size:.6875rem;font-weight:600;letter-spacing:.02em;text-transform:uppercase}
.fx-person{display:flex;align-items:center;gap:.5rem;min-width:0;font-weight:500;white-space:nowrap}
.fx-person>span:last-child,.fx-tr>.addr{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fx-tr>.addr{color:var(--text2)}
.fx-audit{display:flex;align-items:center;gap:.75rem;min-width:0;padding:.5625rem .75rem;color:var(--text2);white-space:nowrap}
.fx-audit-label{display:inline-flex;flex:none;align-items:center;gap:.375rem;color:var(--text2);font-weight:500}
.fx-audit-text{min-width:0;overflow:hidden;text-overflow:ellipsis}
@media (max-width:40rem){.fx-audit{align-items:flex-start;white-space:normal}.fx-audit-label{display:none}.fx-audit-text{overflow-wrap:anywhere}}
.fx-audit b{color:var(--text);font-weight:500}
.fx-audit .addr{color:var(--text2)}
.fx-audit time{margin-left:auto}
.fx-domain{max-width:20.5rem}
.fx-domain-head{display:flex;align-items:center;gap:.5rem;padding:.625rem .75rem;border-bottom:1px solid var(--border);font-weight:600}
.fx-domain-head .badge{margin-left:auto}
.fx-addrs{display:grid;gap:.5rem;margin:0;padding:.75rem;list-style:none}
.fx-addrs li{display:flex;align-items:center;gap:.5rem;min-width:0;white-space:nowrap;overflow-wrap:normal}
.fx-addrs .addr{overflow:hidden;text-overflow:ellipsis}
.fx-addrs .badge{margin-left:auto}
.fx-account{max-width:20.5rem}
.fx-account-label{display:flex;align-items:center;gap:.5rem;min-width:0;padding:.625rem .75rem;border-bottom:1px solid var(--border);color:var(--text);font-weight:600;line-height:1.25rem}
.fx-stack{display:grid;grid-template-columns:1fr 1fr;gap:2rem .75rem;padding:.875rem .875rem 0}
.fx-node{position:relative;display:flex;align-items:center;justify-content:center;gap:.375rem;height:2.25rem;border:1px solid var(--border-strong);border-radius:6px;background:var(--surface);box-shadow:var(--shadow-sm);font-weight:600}
.fx-node-main{grid-column:1 / -1;border-color:color-mix(in srgb,var(--accent) 45%,var(--border));background:var(--accent-soft);color:var(--accent-text)}
.fx-node-main::before{content:"";position:absolute;top:100%;left:50%;height:1rem;border-left:1px solid var(--control)}
.fx-node-main::after{content:"";position:absolute;top:calc(100% + 1rem);left:25%;right:25%;height:1rem;border:1px solid var(--control);border-bottom:0;border-radius:4px 4px 0 0}
.fx-none{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:.375rem;margin-top:1rem;padding:.75rem .5rem .875rem;border-top:1px dashed var(--border-strong);color:var(--text2)}
.fx-none .ic{width:.875rem;height:.875rem}
.fx-none s{padding:0 .4375rem;border:1px solid var(--border-strong);border-radius:999px;background:var(--surface);color:var(--text2);font-size:.75rem;line-height:1.375rem;text-decoration:line-through;text-decoration-color:var(--text2);text-decoration-thickness:1.5px;white-space:nowrap}
.fx-licence{max-width:20.5rem}
.fx-code{display:grid;padding:.5rem 0;color:var(--text2);font:400 .6875rem/1.125rem var(--mono)}
.card-visual .fx-code{font-size:.6875rem;line-height:1.25rem}
.fx-code span{display:grid;grid-template-columns:1.5rem minmax(0,1fr);min-height:1.125rem;padding-inline:.75rem}
.fx-code span::before{content:attr(data-n);color:var(--text3);font-variant-numeric:tabular-nums}
.fx-code .hl{background:var(--accent-soft);color:var(--accent-text);font-weight:500}
.fx-code .hl::before{color:var(--accent-text)}
/* how it works: stepper and code block */
.how{display:grid;grid-template-columns:minmax(0,1fr);gap:3rem}
.how-steps,.how-code{min-width:0}
.steps{display:grid;margin:0;padding:0;list-style:none}
.step{position:relative;display:grid;grid-template-columns:2.25rem minmax(0,1fr);gap:1.25rem;padding-bottom:2.25rem}
.step::before{content:"";position:absolute;top:2.375rem;bottom:0;left:calc(1.125rem - 1px);width:2px;background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 60%,var(--border-strong)),var(--border))}
.step:last-child{padding-bottom:0}
.step:last-child::before{display:none}
.step-num{position:relative;z-index:1;display:grid;place-items:center;width:2.25rem;height:2.25rem;border:1px solid color-mix(in srgb,var(--accent) 35%,var(--border-strong));border-radius:999px;background:var(--surface);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 12%,transparent),var(--shadow-sm);color:var(--text);font-size:.875rem;font-weight:600;font-variant-numeric:tabular-nums}
.step-start{border-color:var(--accent);background:var(--accent-soft);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 20%,transparent);color:var(--accent-text)}
.step h3{margin:.25rem 0 .5rem;font-size:1.0625rem;font-weight:600;line-height:1.4;letter-spacing:-.015em}
.code-caption{display:flex;align-items:center;gap:.875rem;margin:0 0 1rem;color:var(--text);font-size:.9375rem;font-weight:600;line-height:1.4;letter-spacing:-.01em}
.step-start{flex:none;color:var(--accent-text)}
.step-start .ic{width:1rem;height:1rem}
.how-lead{margin-bottom:1.75rem}
.code{margin:0;overflow:hidden;border:1px solid var(--code-border);border-radius:12px;background:var(--code-bg);box-shadow:0 0 0 1px color-mix(in srgb,white 8%,transparent) inset,0 12px 36px -6px color-mix(in srgb,black 60%,transparent),0 2px 8px color-mix(in srgb,black 40%,transparent)}
.code-bar{display:flex;align-items:center;gap:1rem;height:2.625rem;padding-inline:1rem;border-bottom:1px solid var(--code-border);background:linear-gradient(180deg,var(--code-bar),color-mix(in srgb,var(--code-bar) 80%,var(--code-bg)));color:var(--code-text2);font-size:.75rem;font-weight:500}
.code-bar .dots{display:flex;flex:none;align-items:center;gap:7px}
.code-bar .dots i{width:11px;height:11px;border-radius:999px;background:var(--code-border)}
.code-bar .dots i:nth-child(1){background:var(--danger);box-shadow:inset 0 0 0 1px color-mix(in srgb,black 20%,transparent),0 1px 2px color-mix(in srgb,var(--danger) 35%,transparent)}
.code-bar .dots i:nth-child(2){background:var(--warning);box-shadow:inset 0 0 0 1px color-mix(in srgb,black 20%,transparent),0 1px 2px color-mix(in srgb,var(--warning) 35%,transparent)}
.code-bar .dots i:nth-child(3){background:var(--success);box-shadow:inset 0 0 0 1px color-mix(in srgb,black 20%,transparent),0 1px 2px color-mix(in srgb,var(--success) 35%,transparent)}
.code-title{display:inline-flex;align-items:center;gap:.5rem;color:var(--code-text);font-weight:600;letter-spacing:-.01em}
.code-title .ic{width:.875rem;height:.875rem;color:var(--code-accent)}
.code-lang{margin-left:auto;padding:.125rem .5rem;border:1px solid var(--code-border);border-radius:4px;background:color-mix(in srgb,var(--code-bg) 60%,transparent);color:var(--code-text3);font:500 .6875rem/1.2 var(--mono);letter-spacing:.05em;text-transform:uppercase}
.code pre{margin:0;padding:1.375rem 1.25rem 1.5rem;overflow-x:auto;color:var(--code-text);font:400 .8125rem/1.85 var(--mono);tab-size:2;scrollbar-color:var(--code-border) transparent;scrollbar-width:thin}
.code pre:focus-visible{outline-offset:-2px}
@media (max-width:40rem){.code pre{white-space:pre-wrap;overflow-wrap:anywhere}}
.code code{font:inherit}
.code .cm{color:color-mix(in srgb,var(--code-text3) 65%,var(--code-text2));font-style:italic}
.code .cmd::before{content:"$ ";color:color-mix(in srgb,var(--code-accent) 70%,var(--code-text3));font-weight:600;-webkit-user-select:none;user-select:none}
.code .k{color:var(--code-accent);font-weight:600}
.guide{display:inline-flex;align-items:center;gap:.5rem;min-height:44px;margin-top:.875rem;color:var(--accent-text);font-size:.9375rem;font-weight:600;text-decoration:none}
.guide:hover{text-decoration:underline}
.guide:active{color:var(--text)}
.guide .ic{width:1rem;height:1rem}
@media (min-width:64rem){.how{grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:4rem;align-items:start}}
/* security: the diagram as the centrepiece, then the lists in two columns of compact rows, and the caveat */
.arch{margin:0 0 3rem}
.arch-flow{display:grid;grid-template-columns:minmax(0,1fr)}
.node{position:relative;display:grid;grid-template-columns:2.5rem minmax(0,1fr);grid-template-rows:1fr auto;gap:.75rem 1rem;min-width:0;padding:1.25rem;border:1px solid var(--border-strong);border-radius:10px;background:var(--card);box-shadow:0 1px 3px color-mix(in srgb,var(--text) 4%,transparent),0 4px 12px color-mix(in srgb,var(--text) 4%,transparent)}
.node-icon{display:grid;place-items:center;width:2.5rem;height:2.5rem;border:1px solid var(--border);border-radius:8px;background:var(--raised);box-shadow:inset 0 1px 1px color-mix(in srgb,white 40%,transparent);color:var(--text2)}
.node-icon .ic{width:1.25rem;height:1.25rem}
.node-key{border-color:color-mix(in srgb,var(--accent) 65%,var(--border-strong));box-shadow:0 0 0 4px var(--accent-soft),0 6px 20px -2px color-mix(in srgb,var(--accent) 22%,transparent)}
.node-key .node-icon{border-color:transparent;background:var(--accent-soft);color:var(--accent-text);box-shadow:none}
.node-words{display:grid;align-content:start;gap:.25rem;min-width:0}
.node-title{font-size:1rem;font-weight:600;line-height:1.4;letter-spacing:-.01em}
.node-text{color:var(--text2);font-size:.875rem;line-height:1.55;text-wrap:pretty}
.node-tag{display:inline-flex;grid-column:1 / -1;align-items:center;align-self:end;justify-self:start;gap:.4375rem;padding:.25rem .6875rem;border:1px solid var(--border);border-radius:999px;background:var(--raised);box-shadow:0 1px 2px color-mix(in srgb,var(--text) 3%,transparent);color:var(--text);font-size:.8125rem;font-weight:500;line-height:1.25rem}
.node-tag .ic{width:.875rem;height:.875rem;color:var(--accent-text)}
.node-key .node-tag{border-color:transparent;background:var(--accent-soft);color:var(--accent-text)}
.arch-zone{position:relative;display:grid;grid-template-columns:minmax(0,1fr);padding:2.75rem 1.125rem 1.125rem;border:1.5px dashed color-mix(in srgb,var(--control) 65%,var(--border-strong));border-radius:14px;background:color-mix(in srgb,var(--raised) 35%,transparent)}
.arch-zone-label{position:absolute;top:.875rem;left:1.125rem;display:inline-flex;align-items:center;gap:.4375rem;color:var(--text2);font-size:.8125rem;font-weight:600;line-height:1rem;letter-spacing:-.01em;pointer-events:none}
.arch-zone-label .ic{width:.875rem;height:.875rem;color:var(--accent-text)}
.wire{position:relative;display:grid;place-items:center;min-height:3.25rem}
.wire::before{content:"";position:absolute;top:0;bottom:0;left:calc(50% - 1px);border-left:2px solid var(--accent);box-shadow:0 0 6px color-mix(in srgb,var(--accent) 45%,transparent)}
.wire-badge{position:relative;z-index:1;display:grid;place-items:center;width:2.125rem;height:2.125rem;border:1px solid color-mix(in srgb,var(--accent) 65%,var(--border));border-radius:999px;background:var(--surface);box-shadow:0 0 0 3px var(--accent-soft),0 2px 6px color-mix(in srgb,var(--accent) 25%,transparent);color:var(--accent-text)}
.wire-badge .ic{width:.9375rem;height:.9375rem}
.wire-both .ic{transform:rotate(90deg)}
.arch figcaption{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.75rem 2rem;margin-top:1.25rem;color:var(--text2);font-size:.875rem;line-height:1.5}
.legend{display:inline-flex;flex-wrap:wrap;gap:.5rem 1.25rem;color:var(--text2);font-size:.8125rem;font-weight:500}
.legend>span{display:inline-flex;align-items:center;gap:.5rem}
@media (min-width:48rem){.arch-flow{grid-template-columns:minmax(0,1fr) 3.5rem minmax(0,1fr) 3.5rem minmax(0,1fr);padding:2.5rem 1rem 1rem 0}.arch-flow>*,.arch-zone>*{grid-row:1}.arch-zone{display:contents}.arch-zone-label{position:relative;top:auto;left:auto;grid-column:3 / 6;align-items:flex-start;margin:-2.5rem -1rem -1rem;padding:.8125rem 1rem;border:1.5px dashed color-mix(in srgb,var(--control) 65%,var(--border-strong));border-radius:14px;background:color-mix(in srgb,var(--raised) 35%,transparent)}.arch-zone .node:first-of-type{grid-column:3}.arch-zone .wire{grid-column:4}.arch-zone .node:last-child{grid-column:5}.wire{min-height:0}.wire::before{top:calc(50% - 1px);right:0;bottom:auto;left:0;border-top:2px solid var(--accent);border-left:0;box-shadow:0 0 6px color-mix(in srgb,var(--accent) 45%,transparent)}.wire-both .ic{transform:none}}
@media (min-width:48rem) and (max-width:63.9375rem){.node{grid-template-columns:minmax(0,1fr)}}
.groups{display:grid;grid-template-columns:minmax(0,1fr);gap:2.5rem;align-items:start}
.group{min-width:0}
.group h3{margin:0 0 1rem;padding-bottom:.75rem;border-bottom:1px solid var(--border-strong);font-size:1.0625rem;font-weight:600;line-height:1.5rem;letter-spacing:-.015em}
.checks{display:grid;grid-template-columns:minmax(0,1fr);gap:1rem;margin:0;padding:0;list-style:none;color:var(--text2);font-size:.9375rem;line-height:1.5rem}
.checks li{display:grid;grid-template-columns:1.5rem minmax(0,1fr);gap:.875rem;align-items:start;padding:.875rem 1.125rem .9375rem 1rem;border:1px solid var(--border);border-radius:10px;background:var(--card);box-shadow:var(--shadow-sm);text-wrap:pretty}
.checks li.is-limit{border-color:color-mix(in srgb,var(--warning) 32%,var(--border))}
.checks li:hover{border-color:var(--border-strong);box-shadow:var(--shadow-md)}
.check-text{max-width:65ch}
.checks b{display:block;margin-bottom:.25rem;color:var(--text);font-size:.9375rem;font-weight:600;line-height:1.375rem}
.mark{width:1.5rem;height:1.5rem;padding:.3125rem;border-radius:999px;stroke-width:2.25;flex:none}
.mark-protected{background:var(--success-soft);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--success) 35%,transparent);color:var(--success)}
.mark-limit{background:var(--warning-soft);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--warning) 45%,transparent);color:var(--warning)}
.callout{display:grid;grid-template-columns:2rem minmax(0,1fr);gap:1rem;align-items:start;margin-top:2.5rem;padding:1.25rem 1.5rem;border:1px solid var(--border-strong);border-radius:10px;background:var(--card);box-shadow:var(--shadow-sm);color:var(--text)}
.callout-mark{width:2rem;height:2rem;padding:.4375rem;border-radius:999px;background:var(--warning-soft);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--warning) 45%,transparent);color:var(--warning);stroke-width:2.25;flex:none}
.callout p{max-width:90ch;margin:.25rem 0 0;font-size:.9375rem;line-height:1.55;text-wrap:balance}
.callout b{font-weight:600}
@media (min-width:64rem){.groups{grid-template-columns:repeat(2,minmax(0,1fr))}.group:last-child{grid-column:1 / -1}.group:last-child .checks{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:2.5rem}}
/* questions: header beside the accordion */
.split{display:grid;grid-template-columns:minmax(0,1fr);gap:0 4.5rem}
.split-head{min-width:0}
.faq{display:grid;grid-template-columns:minmax(0,1fr);gap:.75rem;min-width:0}
.qa{overflow:hidden;border:1px solid var(--border);border-radius:10px;background:var(--card);box-shadow:var(--shadow-sm)}
.qa:hover{border-color:var(--border-strong);box-shadow:var(--shadow-md)}
.qa[open]{border-color:color-mix(in srgb,var(--accent) 40%,var(--border-strong));box-shadow:0 4px 16px -2px color-mix(in srgb,var(--text) 6%,transparent)}
.qa>summary{display:flex;align-items:center;justify-content:space-between;gap:1rem;min-height:44px;padding:1.125rem 1.25rem;border-radius:9px;cursor:pointer;list-style:none}
.qa>summary::-webkit-details-marker{display:none}
.qa>summary:hover h3{color:var(--accent-text)}
.qa>summary:active h3{color:var(--text)}
.qa h3{margin:0;font-size:1rem;font-weight:600;line-height:1.5;letter-spacing:-.01em;color:var(--text)}
.qa .chev{display:grid;place-items:center;width:1.625rem;height:1.625rem;border-radius:999px;background:var(--raised);color:var(--text2);flex:none}
.qa>summary:hover .chev{background:var(--accent-soft);color:var(--accent-text)}
.qa[open] .chev{background:var(--accent-soft);color:var(--accent-text);transform:rotate(180deg)}
.qa>p{max-width:none;margin:0;padding:.875rem 1.25rem 1.25rem;border-top:1px solid color-mix(in srgb,var(--border) 60%,transparent);color:var(--text2);font-size:.9375rem;line-height:1.6;text-wrap:pretty}
@media (min-width:64rem){.split{grid-template-columns:minmax(0,5fr) minmax(0,7fr)}.split-head{position:sticky;top:6rem;align-self:start}.split .sh{margin-bottom:0}}
/* closing band: full bleed on the dark palette in both themes. On a light page it is the inverse; on a dark page it stays neutral
   (the page's own ground, never a navy tint: a tint dulled the accent button), framed by hairlines so its edges are soft. A faint grid
   and a glow sit behind the buttons (with the hero's, the page's only textures). */
.closing{position:relative;isolation:isolate;overflow:hidden;${paletteToCssVars(DARK)};--band-glow:color-mix(in srgb,var(--accent) 24%,transparent);background:var(--bg);color:var(--text)}
@media (prefers-color-scheme:dark){.closing{--band-glow:color-mix(in srgb,var(--accent) 8%,transparent)}}
.closing::before{content:"";position:absolute;inset:0;z-index:-1;background-image:linear-gradient(color-mix(in srgb,var(--text) 5%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--text) 5%,transparent) 1px,transparent 1px);background-size:48px 48px;background-position:calc(50% - 24px) 0;-webkit-mask-image:radial-gradient(ellipse 55% 95% at 80% 50%,black,transparent 72%);mask-image:radial-gradient(ellipse 55% 95% at 80% 50%,black,transparent 72%)}
.closing::after{content:"";position:absolute;top:-25%;right:-6%;z-index:-1;width:52%;height:150%;background:radial-gradient(closest-side,var(--band-glow),transparent);pointer-events:none}
.closing-inner{display:grid;grid-template-columns:minmax(0,1fr);gap:2.25rem;align-items:end}
.closing-text{min-width:0}
.closing h2{margin-bottom:1rem;font-size:clamp(2.25rem,1.5rem + 2.2vw,3.25rem);line-height:1.1;letter-spacing:-.03em}
.closing p{max-width:36rem;margin:0;color:var(--text2);font-size:1.125rem;line-height:1.6;text-wrap:pretty}
.closing .btn:not(.btn-primary){border-color:color-mix(in srgb,var(--text) 42%,transparent);background:color-mix(in srgb,var(--surface) 60%,transparent);box-shadow:inset 0 1px 0 color-mix(in srgb,white 10%,transparent);color:var(--text)}
.closing .btn:not(.btn-primary):hover{border-color:color-mix(in srgb,var(--text) 65%,transparent);background:var(--hover)}
.closing .btn-primary{box-shadow:0 0 0 1px color-mix(in srgb,white 20%,transparent),0 2px 8px color-mix(in srgb,black 40%,transparent),0 8px 24px color-mix(in srgb,var(--accent) 35%,transparent)}
.closing a:focus-visible{outline-color:var(--accent-text)}
@media (min-width:56rem){.closing-inner{grid-template-columns:minmax(0,1fr) auto;gap:4rem}}
/* dark mode: four levels from the tokens, each a visible step: page (--bg) < band (--band) < card and its picture well (--card) <
   the mini UI inside the well (--mini, with its own lighter hairlines and a lifted --text3 so its small text stays above 4.5:1);
   edges that read, glows at half strength or less */
@media (prefers-color-scheme:dark){.card,.tile:not(.tile-e){border-color:var(--border-strong);box-shadow:inset 0 1px 0 color-mix(in srgb,white 6%,transparent),0 4px 16px color-mix(in srgb,black 40%,transparent)}.card:hover,.tile:not(.tile-e):hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--border-strong));box-shadow:inset 0 1px 0 color-mix(in srgb,white 10%,transparent),0 8px 30px -4px color-mix(in srgb,black 60%,transparent),0 0 24px -4px color-mix(in srgb,var(--accent) 22%,transparent)}.band-alt,.strip,.foot,.foot-bottom{border-color:var(--border-strong)}.faq,.qa{border-color:var(--border-strong)}.btn{border-color:color-mix(in srgb,var(--control) 45%,var(--border-strong));background:linear-gradient(180deg,var(--raised),var(--surface));box-shadow:inset 0 1px 0 color-mix(in srgb,white 10%,transparent),0 1px 2px color-mix(in srgb,black 40%,transparent)}.btn-primary{border-color:var(--accent);background:linear-gradient(180deg,var(--accent),var(--accent-hover));box-shadow:inset 0 1px 0 color-mix(in srgb,white 25%,transparent),0 2px 8px color-mix(in srgb,black 50%,transparent),0 6px 20px -2px color-mix(in srgb,var(--accent) 40%,transparent)}.btn-primary:hover{border-color:var(--accent-hover);background:var(--accent-hover);box-shadow:inset 0 1px 0 color-mix(in srgb,white 30%,transparent),0 4px 12px color-mix(in srgb,black 60%,transparent),0 8px 26px -2px color-mix(in srgb,var(--accent) 50%,transparent)}.step-num{background:var(--raised);border-color:color-mix(in srgb,var(--accent) 45%,var(--border-strong));box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 16%,transparent)}.node{border-color:var(--border-strong);box-shadow:inset 0 1px 0 color-mix(in srgb,white 5%,transparent),0 4px 16px color-mix(in srgb,black 40%,transparent)}.node-key{border-color:color-mix(in srgb,var(--accent) 60%,var(--border-strong));box-shadow:0 0 0 4px var(--accent-soft),0 0 24px -4px color-mix(in srgb,var(--accent) 25%,transparent)}.node-icon,.node-tag{background:var(--mini)}.arch-zone{border-color:color-mix(in srgb,var(--control) 50%,var(--border-strong));background:color-mix(in srgb,var(--surface) 40%,transparent)}.wire-badge{background:var(--raised);border-color:color-mix(in srgb,var(--accent) 60%,var(--border-strong))}.checks li{box-shadow:inset 0 1px 0 color-mix(in srgb,white 4%,transparent)}.checks li.is-protected,.callout{border-color:var(--border-strong)}.checks li.is-limit{border-color:color-mix(in srgb,var(--warning) 40%,var(--border-strong))}.tile-art,.card-visual{border-color:var(--border-strong)}.qa{box-shadow:inset 0 1px 0 color-mix(in srgb,white 4%,transparent)}.qa[open]{border-color:color-mix(in srgb,var(--accent) 55%,var(--border-strong));box-shadow:inset 0 1px 0 color-mix(in srgb,white 8%,transparent),0 0 20px -4px color-mix(in srgb,var(--accent) 20%,transparent)}.qa .chev{background:var(--surface)}}
@media (prefers-color-scheme:dark){.fx,.fx-phone{${DARK_MINI}}.tile-d .tile-art{background:radial-gradient(ellipse 75% 60% at 50% 0,color-mix(in srgb,var(--accent) 6%,transparent),transparent),var(--well)}}
/* footer */
.foot{border-top:1px solid var(--border);background:var(--surface)}
.foot-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2.5rem 2rem;padding-block:3.5rem 3rem}
.foot-brand{grid-column:1 / -1;min-width:0}
.foot-about{max-width:22rem;margin:.75rem 0 0;color:var(--text2);font-size:.875rem;line-height:1.6}
.foot-col{min-width:0}
.foot-title{display:flex;align-items:center;min-height:var(--ctl);margin:0 0 -.25rem;color:var(--text);font-size:.875rem;font-weight:600;line-height:1.25rem}
.foot ul{display:grid;margin:0;padding:0;list-style:none}
.foot li a,.foot li span{display:inline-flex;align-items:center;min-height:var(--ctl);color:var(--text2);font-size:.875rem;text-decoration:none}
.foot li a:hover{color:var(--text);text-decoration:underline}
.foot li a:active{color:var(--accent-text)}
.foot li span{gap:.375rem;color:var(--text);font-weight:600}
.foot li span .ic{width:.875rem;height:.875rem;color:var(--accent-text);stroke-width:2}
.foot-brand .brand{min-height:var(--ctl)}
.foot-bottom{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-start;gap:1rem;padding-block:1.5rem 3rem;border-top:1px solid var(--border)}
.foot-bottom .foot-pills{gap:.25rem 1.25rem}
.foot-bottom .pill{padding-inline:0;border-color:transparent;background:transparent;box-shadow:none;color:var(--text2);font-weight:400}
.foot-bottom .pill .ic{color:var(--text3)}
.foot-pills{display:flex;flex-wrap:wrap;gap:.5rem;margin:0}
@media (min-width:56rem){.foot-grid{grid-template-columns:minmax(0,2fr) repeat(3,minmax(0,1fr))}.foot-brand{grid-column:auto}}
/* phones, motion, languages */
@media (max-width:30rem){.cta{flex-direction:column;align-items:stretch}.cta .btn{width:100%;overflow-wrap:anywhere}.cta-alt{align-items:stretch}.note{text-align:center}.frame picture{aspect-ratio:402/543;overflow:hidden}.frame img{width:358.21%;max-width:none;height:auto;margin:-15.92% 0 0 -61.94%;aspect-ratio:auto}.foot-col:last-child{grid-column:1 / -1}.foot-col:last-child ul{display:flex;flex-wrap:wrap;column-gap:1.5rem}.tile-art,.card-visual{padding-inline:1rem}.fx-mailbox{grid-template-columns:minmax(0,1fr);max-width:15rem}.fx-mailbox .fx-list{display:none}.fx-mailbox .fx-side{border-right:0}.fx-tr{grid-template-columns:minmax(0,1fr) auto}.fx-tr>:nth-child(2){display:none}}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}.btn,.nav-link,.menu-link,.seg a,.drop>summary,.card,.tile,.qa,.qa>summary,.qa h3,.foot a,.guide,.marks li,.step-num,.node,.wire-badge{transition:background-color ${MOTION.fast}ms ease-out,border-color ${MOTION.fast}ms ease-out,color ${MOTION.fast}ms ease-out,box-shadow ${MOTION.base}ms ease-out,transform ${MOTION.fast}ms ease-out}.chev{transition:transform ${MOTION.base}ms ease-out}}
html:lang(vi) h1{line-height:1.2}
html:lang(zh-CN) body{line-height:1.7}
html:lang(zh-CN) h1,html:lang(zh-CN) .band h2{letter-spacing:0;text-wrap:balance}
html:lang(zh-CN) .lead{text-wrap:pretty}
`.trim();
