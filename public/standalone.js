// An installed app (standalone window) that still opens "/" (its start URL before /app existed) skips the landing page
// and goes straight to the app. A browser tab keeps the landing page. Same-origin file on purpose: the page's CSP has no
// inline scripts. replace(), so Back does not return to the landing page.
// "/" is the Vietnamese landing page, so the app is told so with ?lang=vi, unless the link already names a language or this
// device has a language of its own (the picker's choice, kept under the localStorage key "lang"): then that one wins.
if (location.pathname === '/' && (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true)) {
  const params = new URLSearchParams(location.search);
  let deviceLanguage = null;
  try {
    deviceLanguage = window.localStorage.getItem('lang');
  } catch {
    // storage blocked: no device language
  }
  if (!params.has('lang') && !deviceLanguage) {
    params.set('lang', 'vi');
  }
  const query = params.toString();
  location.replace(`/app${query ? `?${query}` : ''}${location.hash}`);
}
