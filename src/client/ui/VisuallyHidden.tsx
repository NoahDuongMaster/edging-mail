import type React from 'react';

/** Text for screen readers only: it takes no room and is not seen. Use it for a label that the layout already makes obvious (an icon, a search box). */
export function VisuallyHidden({ children }: { children: React.ReactNode }): React.ReactElement {
  return <span className="ui-visually-hidden">{children}</span>;
}
