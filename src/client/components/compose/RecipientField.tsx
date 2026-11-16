import React from 'react';
import { CircleAlert } from 'lucide-react';
import { announce } from '../../lib/announce';
import { isAddress, matchRange, suggestContacts, type Contact } from '../../lib/contacts';
import { useT } from '../../lib/i18n';
import { Avatar, Chip, Tooltip, VisuallyHidden } from '../../ui';

// What ends an address in the recipient fields (Enter or a separator).
const isCommitKey = (key: string) => key === 'Enter' || [',', ';'].includes(key);

/** `text` with the part that matched what is typed in bold (J6-44): the reason a suggestion is there. */
const Marked: React.FC<{ text: string; typed: string }> = ({ text, typed }) => {
  const range = matchRange(text, typed);
  if (range === null) {
    return text;
  }
  return (
    <>
      {text.slice(0, range[0])}
      <span className="cp-match">{text.slice(range[0], range[1])}</span>
      {text.slice(range[1])}
    </>
  );
};

// A key pressed while an input method composes a word (Vietnamese Telex, Chinese pinyin): it belongs to the input method, not to the field.
const composing = (event: React.KeyboardEvent) => event.nativeEvent.isComposing || event.key === 'Process';

/**
 * A finished address: a removable ui Chip with the person's initials and their name when it is known (from mail already in this browser:
 * "Maya Chen", J6-12), else the whole address (it wraps rather than being cut: a recipient nobody can read in full cannot be checked). With a
 * name, the address is in the chip's accessible text and in its tooltip on hover; its X is named after the address (24 px, 44 px on touch).
 * Backspace or Delete on its X removes it too (J1-24).
 */
const RecipientChip: React.FC<{ address: string; name?: string; onRemove: (key: 'button' | 'Backspace' | 'Delete') => void }> = ({
  address,
  name,
  onRemove
}) => {
  const tr = useT();
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const [tip, setTip] = React.useState(false);
  const named = name !== undefined && name !== '' && name.toLowerCase() !== address.toLowerCase();
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Backspace and Delete on the chip's own X button bubble up to here
    <span
      ref={ref}
      className="cp-chip-wrap"
      onPointerEnter={(event) => setTip(named && event.pointerType === 'mouse')}
      onPointerLeave={() => setTip(false)}
      onPointerDown={() => setTip(false)}
      onKeyDown={(event) => {
        if (event.key === 'Backspace' || event.key === 'Delete') {
          event.preventDefault();
          onRemove(event.key);
        }
      }}
    >
      <Chip
        className="cp-chip"
        icon={<Avatar name={named ? name : address} size="sm" className="cp-avatar" />}
        onRemove={() => onRemove('button')}
        removeLabel={tr('compose.remove_recipient', { address })}
      >
        {named ? (
          <>
            {name}
            <VisuallyHidden>{` <${address}>`}</VisuallyHidden>
          </>
        ) : (
          address
        )}
      </Chip>
      {named ? <Tooltip open={tip} text={address} anchorRef={ref} /> : null}
    </span>
  );
};

interface RecipientFieldProps {
  /** The id of the address input; the label of the row points at it. */
  id: string;
  label: string;
  /** The finished addresses, shown as chips. */
  list: readonly string[];
  /** The names known for addresses (lower-case address -> name), from mail already loaded; a chip shows the name when there is one. */
  names?: ReadonlyMap<string, string>;
  /** The people this browser has seen in its mail (lib/contacts.ts), newest first: what the field suggests while an address is typed. */
  contacts?: readonly Contact[];
  /** The addresses already in the message (every field, lower case): never suggested again. */
  taken?: ReadonlySet<string>;
  /** What is typed and not yet an address. */
  input: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  placeholder?: string;
  onInput: (value: string) => void;
  /** Turns the typed text into addresses: Enter, a comma or a semicolon, and leaving the field. */
  onCommit: () => void;
  /** A suggestion was chosen: its address becomes a chip and the typed text goes. */
  onPick?: (address: string) => void;
  onRemove: (address: string) => void;
  /** At the end of the first line of the row (the Cc/Bcc button): it stays there however many lines the chips take (J3-35). */
  trailing?: React.ReactNode;
  /** What is wrong with what the field holds (not an address, or nobody yet): said on a line of its own under the field, in the flow, so it covers nothing. */
  error?: string;
  className?: string;
}

/**
 * One recipient row of the compose (To, Cc, Bcc): the label, the addresses already finished as chips, and the input for the next one.
 * Only a full address becomes a chip (the compose decides in `onCommit`); the row follows the same hairline group as the other fields.
 *
 * The input is an APG combobox (J6-44): while something is typed it suggests the people of the mail this browser holds (name and address,
 * newest first, at most 6) in a listbox that exists only while it is open. Down and Up move, Enter or Tab take the marked one, Escape closes
 * the list (not the compose), a pointer takes one without the input losing focus, and nothing is taken while an input method composes. The
 * first suggestion is marked as soon as the list opens, unless what is typed is already a whole address (Enter then keeps what was typed).
 *
 * J1-24: removing a chip (its X, or Backspace / Delete on it) says "Removed <address>" and moves focus to the next chip's X, else the
 * previous one, else the input. Backspace in the empty input first moves to the last chip (and says so); a second Backspace removes it and
 * focus comes back to the input.
 */
export const RecipientField: React.FC<RecipientFieldProps> = ({
  id,
  label,
  list,
  names,
  contacts,
  taken,
  input,
  inputRef,
  placeholder,
  onInput,
  onCommit,
  onPick,
  onRemove,
  trailing,
  error,
  className
}) => {
  const tr = useT();
  const fieldRef = React.useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = React.useState(false);
  // Escape closed the list: it stays closed until the text changes.
  const [dismissedFor, setDismissedFor] = React.useState<string | null>(null);
  // The suggestion the arrows are on (aria-activedescendant), -1 for none. Reset whenever the typed text changes (adjusted while rendering).
  const [active, setActive] = React.useState(-1);
  const [activeFor, setActiveFor] = React.useState(input);

  const suggestions = React.useMemo(
    () => (contacts === undefined || onPick === undefined ? [] : suggestContacts(contacts, input, taken)),
    [contacts, onPick, input, taken]
  );
  // A whole address typed: Enter keeps it, nothing is marked until the arrows are used.
  const autoActive = suggestions.length > 0 && !isAddress(input.trim()) ? 0 : -1;
  if (activeFor !== input) {
    setActiveFor(input);
    setActive(autoActive);
  }
  const open = focused && suggestions.length > 0 && dismissedFor !== input;
  const current = open && active >= 0 && active < suggestions.length ? active : -1;
  const listId = `${id}-suggestions`;
  const optionId = (index: number) => `${id}-suggestion-${index}`;

  // A Tab pick: the blur that follows must not commit the typed text as well (the render that clears it has not run yet).
  const pickedRef = React.useRef(false);
  const pick = (contact: Contact, leaving = false) => {
    pickedRef.current = leaving;
    onPick?.(contact.address);
    setActive(-1);
  };

  // J1-24: where focus goes once a chip has gone (the list it leaves is rendered first).
  const pendingFocus = React.useRef<{ index: number; toInput: boolean } | null>(null);
  // The chip that the first Backspace in the empty input moved to: a second Backspace on it removes it and goes back to the input.
  const armedRef = React.useRef<string | null>(null);
  React.useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (pending === null) {
      return;
    }
    pendingFocus.current = null;
    // The chip that took the removed one's place (the next), else the one before it, else the input.
    const buttons = [...(fieldRef.current?.querySelectorAll<HTMLElement>('.cp-chip-wrap .ui-chip-x') ?? [])];
    const next = buttons.at(pending.index);
    const previous = pending.index > 0 ? buttons.at(pending.index - 1) : undefined;
    const target = pending.toInput ? undefined : (next ?? previous);
    (target ?? inputRef.current)?.focus();
  }, [list, inputRef]);

  const remove = (address: string, key: 'button' | 'Backspace' | 'Delete') => {
    const index = list.indexOf(address);
    pendingFocus.current = { index, toInput: key === 'Backspace' && armedRef.current === address };
    armedRef.current = null;
    onRemove(address);
    announce(tr('compose.recipient_removed', { address }));
  };

  return (
    // The row, and under it the suggestions while they are open (outside the row's focus ring; on a desktop they float from here).
    <div className="cp-rcpt">
      <div className={className === undefined ? 'cp-row' : `cp-row ${className}`}>
        <label htmlFor={id} className="cp-label">
          {label}
        </label>
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a press on the free part of the field (beside the chips) types in it; keys are the input's own */}
        <div
          ref={fieldRef}
          className="cp-field"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              inputRef.current?.focus();
            }
          }}
        >
          {list.map((address) => (
            <RecipientChip
              key={address}
              address={address}
              name={names?.get(address.toLowerCase())}
              onRemove={(key) => remove(address, key)}
            />
          ))}
          <input
            id={id}
            ref={inputRef}
            className="cp-input"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={current >= 0 ? optionId(current) : undefined}
            autoComplete="off"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={placeholder}
            value={input}
            // J3-35: an empty input beside chips is small at rest, so it shares their line (it grows back as soon as it has focus).
            data-empty={input === '' && list.length > 0 ? 'true' : undefined}
            aria-invalid={error === undefined ? undefined : true}
            aria-describedby={error === undefined ? undefined : `${id}-error`}
            onChange={(e) => onInput(e.target.value)}
            onFocus={() => setFocused(true)}
            onKeyDown={(e) => {
              if (composing(e)) {
                return;
              }
              if (open) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  // Down from nothing goes to the first, Up to the last; both wrap.
                  const count = suggestions.length;
                  const step = e.key === 'ArrowDown' ? 1 : -1;
                  setActive(current < 0 ? (step > 0 ? 0 : count - 1) : (current + step + count) % count);
                  return;
                }
                if (e.key === 'Escape') {
                  // The list closes; the compose stays open (its own Escape handler is on its root).
                  e.preventDefault();
                  e.stopPropagation();
                  setDismissedFor(input);
                  return;
                }
                if ((e.key === 'Enter' || e.key === 'Tab') && current >= 0 && !e.shiftKey) {
                  // Enter stays in the field (the next address); Tab takes it and goes on to the next control.
                  if (e.key === 'Enter') {
                    e.preventDefault();
                  }
                  pick(suggestions[current], e.key === 'Tab');
                  return;
                }
              } else if (e.key === 'ArrowDown' && suggestions.length > 0) {
                // Closed by Escape: Down opens the list again.
                e.preventDefault();
                setDismissedFor(null);
                setActive(0);
                return;
              }
              if (isCommitKey(e.key)) {
                e.preventDefault();
                onCommit();
              }
              if (e.key === 'Backspace' && input === '' && list.length > 0) {
                // J1-24: the first Backspace moves to the last chip's X and says so; the second (on the chip) removes it.
                e.preventDefault();
                const last = list.at(-1) ?? '';
                armedRef.current = last;
                fieldRef.current?.querySelectorAll<HTMLElement>('.cp-chip-wrap .ui-chip-x')[list.length - 1]?.focus();
                announce(tr('compose.recipient_armed', { address: last }));
              }
            }}
            onBlur={() => {
              setFocused(false);
              if (pickedRef.current) {
                pickedRef.current = false;
                return;
              }
              onCommit();
            }}
          />
          {error === undefined ? null : (
            <p id={`${id}-error`} role="alert" className="cp-error">
              <CircleAlert size={14} strokeWidth={1.75} aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}
        </div>
        {trailing}
      </div>
      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label={tr('compose.suggestions_label')}
          className="cp-suggest"
          // A press on a suggestion must not take focus from the input (the list is the input's, as in ui/Select).
          onPointerDown={(event) => event.preventDefault()}
        >
          {suggestions.map((contact, index) => (
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- keys are handled by the combobox, which keeps focus (aria-activedescendant)
            <div
              key={contact.address}
              id={optionId(index)}
              role="option"
              tabIndex={-1}
              aria-selected={index === current}
              data-active={index === current ? 'true' : undefined}
              className="ui-option cp-option"
              onPointerMove={() => {
                if (index !== current) {
                  setActive(index);
                }
              }}
              onClick={() => pick(contact)}
            >
              <Avatar name={contact.name === '' ? contact.address : contact.name} size="sm" className="cp-avatar" />
              <span className="cp-option-text">
                {contact.name === '' ? null : (
                  <span className="cp-option-name">
                    <Marked text={contact.name} typed={input} />
                  </span>
                )}{' '}
                <span className="cp-option-addr">
                  <Marked text={contact.address} typed={input} />
                </span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};
