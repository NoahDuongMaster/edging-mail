import React from 'react';
import type { ThemeTokens } from '../theme';

// Mail is untrusted: nothing may load except inline styles and data: images/fonts, and the frame cannot navigate.
// The page's own policy (public/_headers) is inherited by this srcdoc frame and is wider (`img-src https:`) because
// 'Show images' must be able to widen the frame's policy; this meta policy is the gate for remote content.
const framePolicy = (images: string) =>
  `default-src 'none'; img-src ${images}; style-src 'unsafe-inline'; font-src data:; frame-src 'none'`;

const REMOTE_URL = /^\s*(?:https?:)?\/\//i;
const REMOTE_SRCSET = /(?:^|,)\s*https?:\/\//i;
const REMOTE_CSS_URL = /url\(\s*["']?\s*(?:https?:)?\/\//i;

function anyAttribute(doc: Document, selector: string, attribute: string, pattern: RegExp): boolean {
  return [...doc.querySelectorAll(selector)].some((element) => pattern.test(element.getAttribute(attribute) ?? ''));
}

function buildMailDocument(html: string, accent: string, allowImages: boolean): { srcDoc: string; hasRemoteImages: boolean } {
  // Parsed inertly (no script runs, nothing loads) so links can be fixed up before the sandboxed frame sees them.
  // The sender's markup lands in the body exactly as it did before, so its own <style> blocks keep working.
  const doc = new DOMParser().parseFromString(
    `<!DOCTYPE html><html><head><meta charset="utf-8" /><base target="_blank" /><style>
        html,body{margin:0;padding:0;background:#ffffff;}
        body{font-family:'Geist',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:24px;color:#1f2430;word-break:break-word;padding:24px;}
        img{max-width:100%;height:auto;} a{color:${accent};}
        blockquote{margin:0 0 0 12px;padding-left:12px;border-left:2px solid #e3e6eb;color:#535a66;}
        table{max-width:100%;}
      </style></head><body>${html}</body></html>`,
    'text/html'
  );

  const hasRemoteImages =
    anyAttribute(doc, 'img[src]', 'src', REMOTE_URL) ||
    anyAttribute(doc, '[srcset]', 'srcset', REMOTE_SRCSET) ||
    anyAttribute(doc, '[background]', 'background', REMOTE_URL) ||
    anyAttribute(doc, '[style]', 'style', REMOTE_CSS_URL) ||
    [...doc.querySelectorAll('style')].some((style) => REMOTE_CSS_URL.test(style.textContent));

  for (const link of doc.querySelectorAll('a[href], area[href]')) {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  }
  // A refresh would navigate the frame to a page of the sender's choosing.
  for (const meta of doc.querySelectorAll('meta[http-equiv="refresh" i]')) {
    meta.remove();
  }

  // First in <head>, so it covers everything after it.
  const policy = doc.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = framePolicy(allowImages ? 'data: https:' : 'data:');
  const referrer = doc.createElement('meta');
  referrer.name = 'referrer';
  referrer.content = 'no-referrer';
  // Not head.prepend(): @cloudflare/workers-types overrides Element.prepend with the HTMLRewriter signature.
  doc.head.insertBefore(referrer, doc.head.firstChild);
  doc.head.insertBefore(policy, referrer);

  return { srcDoc: `<!DOCTYPE html>${doc.documentElement.outerHTML}`, hasRemoteImages };
}

interface MailFrameProps {
  html: string;
  t: ThemeTokens;
}

/** The HTML body of a mail in a sandboxed frame. Mount it with `key={message.id}`: 'Show images' is per message. */
export const MailFrame: React.FC<MailFrameProps> = ({ html, t }) => {
  const [showImages, setShowImages] = React.useState(false);
  // HTML mail is rendered on a light canvas in both themes, like a desktop mail client,
  // so sender-authored colours stay readable.
  const { srcDoc, hasRemoteImages } = React.useMemo(() => buildMailDocument(html, t.accent, showImages), [html, t.accent, showImages]);

  return (
    <div
      style={{
        border: `1px solid ${t.border}`,
        borderRadius: 12,
        background: '#FFFFFF',
        overflow: 'hidden'
      }}
    >
      {hasRemoteImages && !showImages ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0 8px',
            padding: '4px 12px',
            borderBottom: `1px solid ${t.border}`,
            background: t.raised,
            color: t.text2,
            fontSize: 13,
            lineHeight: '20px'
          }}
        >
          <span>Remote images are blocked.</span>
          <button
            type="button"
            className="nm-tap-h"
            onClick={() => setShowImages(true)}
            style={{
              padding: '0 4px',
              border: 0,
              background: 'transparent',
              color: t.link,
              font: 'inherit',
              fontWeight: 500,
              textDecoration: 'underline',
              cursor: 'pointer'
            }}
          >
            Show images
          </button>
        </div>
      ) : null}
      <iframe
        title="Message body"
        srcDoc={srcDoc}
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        style={{ width: '100%', height: 480, border: 0, display: 'block', background: '#FFFFFF' }}
      />
    </div>
  );
};
