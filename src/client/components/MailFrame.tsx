import React from 'react';
import type { ThemeTokens } from '../theme';
import { useT } from '../lib/i18n';
import { buildMailDocument } from '../lib/mailDocument';
import type { EmbeddedImages } from '../lib/mailcrypto/inline';
import { Banner, Button } from '../ui';

const NO_EMBEDDED: ReadonlyMap<string, string> = new Map();

/**
 * A guess, from the HTML text alone, that a mail runs past one view: about 80 characters to a line plus a line for each block or picture,
 * over 24 lines (576px). Nothing is parsed, rendered or loaded; the tag strip is one linear pass. reader.css gives a long mail a frame as
 * tall as the column, a short one what the page leaves; a wrong guess costs some scrolling inside the frame or some white, never content.
 */
function looksLong(html: string): boolean {
  const blocks = html.match(/<(?:p|br|tr|li|div|h[1-6]|img|blockquote)\b/gi)?.length ?? 0;
  const text = html
    .replaceAll(/<[^>]*>/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
  return text.length / 80 + blocks > 24;
}

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
  const tall = React.useMemo(() => looksLong(html), [html]);
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

  // The chrome around the frame is `.rd-*` in reader.css (imported by MessageView): the notices stand above the white canvas of the mail.
  return (
    <div className="rd-mail">
      {(hasRemoteImages || hasEmbedded) && !showImages ? (
        <Banner
          className="rd-images"
          action={
            <Button size="sm" onClick={() => setShowImages(true)}>
              {tr('action.show_images')}
            </Button>
          }
        >
          {hasRemoteImages ? tr('frame.images_blocked') : tr('mailcrypto.images_hidden')}
        </Banner>
      ) : null}
      {showImages && opened !== null && opened.failed > 0 ? (
        <Banner tone="warning" className="rd-images">
          {tr('fail.mailcrypto_images')}
        </Banner>
      ) : null}
      <div className="rd-frame" data-tall={tall}>
        {/* Its height is set in reader.css: nothing can measure the mail inside, so it fills the page, or the column for a long mail. */}
        <iframe
          title={tr('frame.title')}
          srcDoc={srcDoc}
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          style={{ width: '100%', border: 0, display: 'block', background: '#FFFFFF' }}
        />
      </div>
    </div>
  );
};
