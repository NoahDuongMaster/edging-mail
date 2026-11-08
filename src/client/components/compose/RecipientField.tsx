import type React from 'react';
import { CircleAlert } from 'lucide-react';
import { useT } from '../../lib/i18n';
import { Chip } from '../../ui';

// What ends an address in the recipient fields (Enter or a separator).
const isCommitKey = (key: string) => key === 'Enter' || [',', ';'].includes(key);

/** A finished address: a removable ui Chip that shows the whole address and names its X after it. */
const RecipientChip: React.FC<{ address: string; onRemove: () => void }> = ({ address, onRemove }) => {
  const tr = useT();
  return (
    <Chip onRemove={onRemove} removeLabel={tr('compose.remove_recipient', { address })}>
      {address}
    </Chip>
  );
};

interface RecipientFieldProps {
  /** The id of the address input; the label of the row points at it. */
  id: string;
  label: string;
  /** The finished addresses, shown as chips. */
  list: readonly string[];
  /** What is typed and not yet an address. */
  input: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  placeholder?: string;
  onInput: (value: string) => void;
  /** Turns the typed text into addresses: Enter, a comma or a semicolon, and leaving the field. */
  onCommit: () => void;
  onRemove: (address: string) => void;
  /** Backspace in an empty field takes the last address back (the To field). */
  onBackspace?: () => void;
  /** At the end of the line of the field (the Cc/Bcc button). */
  trailing?: React.ReactNode;
  /** What is wrong with what the field holds (not an address): said on a line of its own under the field, in the flow, so it covers nothing. */
  error?: string;
  className?: string;
}

/**
 * One recipient row of the compose (To, Cc, Bcc): the label, the addresses already finished as chips, and the input for the next one.
 * Only a full address becomes a chip (the compose decides in `onCommit`); the row follows the same hairline group as the other fields.
 */
export const RecipientField: React.FC<RecipientFieldProps> = ({
  id,
  label,
  list,
  input,
  inputRef,
  placeholder,
  onInput,
  onCommit,
  onRemove,
  onBackspace,
  trailing,
  error,
  className
}) => (
  <div className={className === undefined ? 'cp-row' : `cp-row ${className}`}>
    <label htmlFor={id} className="cp-label">
      {label}
    </label>
    <div className="cp-field">
      {list.map((address) => (
        <RecipientChip key={address} address={address} onRemove={() => onRemove(address)} />
      ))}
      <input
        id={id}
        ref={inputRef}
        className="cp-input"
        type="text"
        autoComplete="off"
        inputMode="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder}
        value={input}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
        onChange={(e) => onInput(e.target.value)}
        onKeyDown={(e) => {
          if (isCommitKey(e.key)) {
            e.preventDefault();
            onCommit();
          }
          if (e.key === 'Backspace' && input === '' && list.length > 0) {
            onBackspace?.();
          }
        }}
        onBlur={onCommit}
      />
      {trailing}
      {error === undefined ? null : (
        <p id={`${id}-error`} role="alert" className="cp-error">
          <CircleAlert size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  </div>
);
