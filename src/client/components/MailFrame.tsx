import React from 'react';
import type { ThemeTokens } from '../theme';
import { useT } from '../lib/i18n';
import { buildMailDocument } from '../lib/mailDocument';
import type { EmbeddedImages } from '../lib/mailcrypto/inline';

const NO_EMBEDDED: ReadonlyMap<string, string> = new Map();

interface MailFrameProps {
  html: string;
  t: ThemeTokens;
  /**
   * Opens the pictures the mail carries inside itself (encrypted messages): given the `cid:` references, gives back `data:` URLs.
   * Called only after the reader pressed 'Show images'. Without it a `cid:` picture stays as the sender wrote it.
   */
  loadEmbedded?: (references: string[]) => Promise<EmbeddedImages>;
}

// The document the frame shows, and why nothing in it can reach the network before 'Show images', is lib/mailDocument.ts.
/** The HTML body of a mail in a sandboxed frame. Mount it with `key={message.id}`: 'Show images' is per message. */
export const MailFrame: React.FC<MailFrameProps> = ({ html, t, loadEmbedded }) => {
  const tr = useT();
  const [showImages, setShowImages] = React.useState(false);
  const [opened, setOpened] = React.useState<EmbeddedImages | null>(null);
  // HTML mail is rendered on a light canvas in both themes, like a desktop mail client,
  // so sender-authored colours stay readable.
  const { srcDoc, hasRemoteImages, embedded } = React.useMemo(
    () => buildMailDocument(html, t.accent, showImages, opened?.urls ?? NO_EMBEDDED),
    [html, t.accent, showImages, opened]
  );
  const hasEmbedded = loadEmbedded !== undefined && embedded.length > 0;
  const embeddedKey = embedded.join('\n');
  const loadRef = React.useRef(loadEmbedded);
  React.useEffect(() => {
    loadRef.current = loadEmbedded;
  }, [loadEmbedded]);

  React.useEffect(() => {
    const load = loadRef.current;
    if (!showImages || embeddedKey === '' || load === undefined) {
      return;
    }
    let cancelled = false;
    const references = embeddedKey.split('\n');
    load(references)
      .then((result) => {
        if (!cancelled) {
          setOpened(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOpened({ urls: new Map(), failed: references.length });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [showImages, embeddedKey]);

  const barStyle: React.CSSProperties = {
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
  };

  return (
    <div
      style={{
        border: `1px solid ${t.border}`,
        borderRadius: 12,
        background: '#FFFFFF',
        overflow: 'hidden'
      }}
    >
      {(hasRemoteImages || hasEmbedded) && !showImages ? (
        <div style={barStyle}>
          <span>{hasRemoteImages ? tr('frame.images_blocked') : tr('mailcrypto.images_hidden')}</span>
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
            {tr('action.show_images')}
          </button>
        </div>
      ) : null}
      {showImages && opened !== null && opened.failed > 0 ? (
        <div role="status" style={barStyle}>
          <span>{tr('fail.mailcrypto_images')}</span>
        </div>
      ) : null}
      <iframe
        title={tr('frame.title')}
        srcDoc={srcDoc}
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        style={{ width: '100%', height: 480, border: 0, display: 'block', background: '#FFFFFF' }}
      />
    </div>
  );
};
