import React from 'react';
import { Check, Copy } from 'lucide-react';
import { useT } from '../lib/i18n';
import { Button, type ButtonProps } from './Button';

export type CopyResult = 'copied' | 'failed';

/**
 * Puts `text` on the clipboard: true when it is there, false when the page has no clipboard (an insecure page) or the browser refuses.
 * The text is not kept or logged anywhere.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export interface CopyButtonProps extends Omit<ButtonProps, 'onClick' | 'children' | 'leadingIcon' | 'trailingIcon' | 'loading' | 'type'> {
  /** What goes on the clipboard. The button never shows, logs or keeps it. */
  text: string;
  /** After every press: `copied`, or `failed` so the screen can say how to copy it by hand (select the text, Ctrl+C). */
  onResult?: (result: CopyResult) => void;
}

/**
 * Copy for a key, a code or a password shown on screen: it says Copy, then Copied (with a tick) once the text is on the clipboard, and a
 * screen reader hears "Copied" politely. When it fails, the button says Copy again and the screen shows its own words for it (`onResult`).
 */
export function CopyButton({ text, onResult, variant = 'secondary', ...rest }: CopyButtonProps): React.ReactElement {
  const tr = useT();
  const [copied, setCopied] = React.useState(false);
  const press = async () => {
    const ok = await copyText(text);
    setCopied(ok);
    onResult?.(ok ? 'copied' : 'failed');
  };
  return (
    <>
      <Button
        variant={variant}
        leadingIcon={copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        onClick={() => {
          void press();
        }}
        {...rest}
      >
        {/* Both words are in the button, the one not shown invisible (ui.css `ui-copy-label`), so its width does not change. */}
        <span className="ui-copy-label">
          <span data-shown={!copied} aria-hidden={copied ? true : undefined}>
            {tr('common.copy')}
          </span>
          <span data-shown={copied} aria-hidden={copied ? undefined : true}>
            {tr('common.copied')}
          </span>
        </span>
      </Button>
      <span role="status" className="ui-visually-hidden">
        {copied ? tr('common.copied') : ''}
      </span>
    </>
  );
}
