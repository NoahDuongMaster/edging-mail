// The keys that send from the compose window (its root takes Ctrl+Enter and Cmd+Enter alike: e.metaKey || e.ctrlKey). What the window
// SAYS follows the keyboard in front of the person: Command on an Apple device, Ctrl everywhere else. One helper, read once per render.

interface PlatformHints {
  userAgentData?: { platform?: string };
}

/** An Apple keyboard (macOS, iPadOS, iOS): User-Agent Client Hints where the browser has them, else the user agent string. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const hinted = (navigator as Navigator & PlatformHints).userAgentData?.platform;
  return /mac|iphone|ipad|ipod/i.test(hinted ?? navigator.userAgent);
}

/** The modifier of the send shortcut as drawn on its key cap ('⌘' on Apple, else the translated Ctrl), and its aria-keyshortcuts form. */
export function sendModifier(apple: boolean, ctrlName: string): { cap: string; aria: string } {
  return apple ? { cap: '⌘', aria: 'Meta+Enter' } : { cap: ctrlName, aria: 'Control+Enter' };
}
