import type React from 'react';
import type { QuoteNode } from '../../lib/mailQuote';

/**
 * The quoted part of a plain-text reply once "Show quoted text" opened it (J6-29): paragraphs, and each deeper level of quoting as a nested
 * blockquote with a hairline edge in text2 (reader.css `.rd-quoted`), without the '>' markers the text carried.
 */
export function QuoteNodes({ nodes }: { nodes: QuoteNode[] }): React.ReactElement {
  return (
    <>
      {nodes.map((node, i) =>
        node.kind === 'p' ? (
          // eslint-disable-next-line react/no-array-index-key -- quoted paragraphs are plain strings that can repeat and are never reordered
          <p key={i}>{node.text}</p>
        ) : (
          // eslint-disable-next-line react/no-array-index-key -- the same: a fixed, never reordered tree
          <blockquote key={i} className="rd-quoted">
            <QuoteNodes nodes={node.children} />
          </blockquote>
        )
      )}
    </>
  );
}
