import { Check, ChevronDown } from 'lucide-react';
import React from 'react';
import { cx } from './cx';
import { describedBy, Field, has } from './Field';
import { firstEnabled, lastEnabled, moveIndex, typeAheadIndex } from './listNav';
import { Popover } from './Popover';
import { useTypeAhead } from './useTypeAhead';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  label: string;
  /** Keeps the label for screen readers only. */
  hideLabel?: boolean;
  hint?: string;
  error?: string;
  options: readonly SelectOption[];
  value: string;
  onChange: (value: string) => void;
  /** Shown while `value` matches no option. */
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** Page Up and Page Down move this many rows. */
const PAGE = 10;

const optionId = (id: string, index: number): string => `${id}-option-${index}`;

/**
 * Chooses one value from a list: a button-like box that opens a list of options. It replaces the browser's `<select>` and follows the
 * ARIA select-only combobox pattern. Closed: Down, Up, Enter or Space open it, letters jump to a matching option. Open: Up and Down move,
 * Home and End jump, letters find an option, Enter or Space choose, Tab chooses and moves on, Escape closes. The list is drawn over
 * everything (no parent clips it), flips upward near the bottom, and has 44 px rows on touch. Use it for 4 or more options; for 2 or 3,
 * prefer RadioGroup.
 */
export function Select({
  label,
  hideLabel,
  hint,
  error,
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  id,
  className
}: SelectProps): React.ReactElement {
  const generated = React.useId();
  const fieldId = id ?? generated;
  const triggerRef = React.useRef<HTMLDivElement | null>(null);
  const optionRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const typeAhead = useTypeAhead();
  const selected = options.findIndex((option) => option.value === value);

  // The active row stays in view while the arrows walk a long list.
  React.useEffect(() => {
    if (open && active !== -1) {
      optionRefs.current[active]?.scrollIntoView({ block: 'nearest' });
    }
  }, [open, active]);

  const openAt = (index: number) => {
    setActive(index >= 0 ? index : firstEnabled(options));
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = index >= 0 ? options[index] : undefined;
    if (option !== undefined && option.disabled !== true) {
      onChange(option.value);
    }
    setOpen(false);
  };

  const onKeyDownOpen = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const move = (to: number) => {
      event.preventDefault();
      setActive(to >= 0 ? to : active);
    };
    switch (event.key) {
      case 'ArrowDown': {
        move(moveIndex(options, active, 1, false));
        break;
      }
      case 'ArrowUp': {
        if (event.altKey) {
          event.preventDefault();
          choose(active);
        } else {
          move(moveIndex(options, active, -1, false));
        }
        break;
      }
      case 'Home': {
        move(firstEnabled(options));
        break;
      }
      case 'End': {
        move(lastEnabled(options));
        break;
      }
      case 'PageDown': {
        move(moveIndex(options, Math.min(active + PAGE - 1, options.length - 1), 1, false));
        break;
      }
      case 'PageUp': {
        move(moveIndex(options, Math.max(active - PAGE + 1, 0), -1, false));
        break;
      }
      case 'Enter':
      case ' ': {
        event.preventDefault();
        choose(active);
        break;
      }
      case 'Tab': {
        // Tab keeps the option the arrows stopped on, then the browser moves focus on.
        choose(active);
        break;
      }
      default: {
        break;
      }
    }
  };

  const onKeyDownClosed = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'Home': {
        event.preventDefault();
        openAt(firstEnabled(options));
        break;
      }
      case 'End': {
        event.preventDefault();
        openAt(lastEnabled(options));
        break;
      }
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Enter':
      case ' ': {
        event.preventDefault();
        openAt(selected);
        break;
      }
      default: {
        break;
      }
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const { key } = event;
    if (disabled || event.ctrlKey || event.metaKey) {
      return;
    }
    const typing = key.length === 1 && !event.altKey && (key !== ' ' || typeAhead.typing());
    if (typing) {
      event.preventDefault();
      const match = typeAheadIndex(options, open ? active : selected, typeAhead.add(key));
      if (open) {
        setActive(match >= 0 ? match : active);
      } else if (match >= 0) {
        openAt(match);
      }
    } else if (open) {
      onKeyDownOpen(event);
    } else {
      onKeyDownClosed(event);
    }
  };

  const current = selected === -1 ? undefined : options[selected];
  const describedby = describedBy(fieldId, hint, error);
  return (
    <Field id={fieldId} label={label} hideLabel={hideLabel} hint={hint} error={error} native={false}>
      <div
        ref={triggerRef}
        id={fieldId}
        role="combobox"
        tabIndex={disabled ? -1 : 0}
        className={cx('ui-select', className)}
        data-invalid={has(error) ? 'true' : undefined}
        aria-labelledby={`${fieldId}-label ${fieldId}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${fieldId}-list` : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(fieldId, active) : undefined}
        aria-disabled={disabled ? true : undefined}
        aria-invalid={has(error) ? true : undefined}
        aria-describedby={describedby}
        onClick={() => {
          if (!disabled) {
            if (open) {
              setOpen(false);
            } else {
              openAt(selected);
            }
          }
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      >
        <span className="ui-select-value" data-placeholder={current === undefined ? 'true' : undefined}>
          {current?.label ?? placeholder}
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </div>
      <Popover
        open={open}
        anchorRef={triggerRef}
        matchWidth
        onClose={() => setOpen(false)}
        id={`${fieldId}-list`}
        role="listbox"
        aria-labelledby={`${fieldId}-label`}
        className="ui-listbox"
        // The pointer must not take focus from the box: the arrows and letters keep working while the list is open.
        onMouseDown={(event) => event.preventDefault()}
      >
        {options.map((option, index) => (
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- keys are handled by the combobox, which keeps focus (aria-activedescendant)
          <div
            key={option.value}
            ref={(element) => {
              optionRefs.current[index] = element;
            }}
            id={optionId(fieldId, index)}
            role="option"
            tabIndex={-1}
            className="ui-option"
            aria-selected={index === selected}
            aria-disabled={option.disabled === true ? true : undefined}
            data-active={index === active ? 'true' : undefined}
            onMouseMove={() => {
              if (option.disabled !== true && index !== active) {
                setActive(index);
              }
            }}
            onClick={() => choose(index)}
          >
            <span>{option.label}</span>
            {index === selected ? <Check size={16} aria-hidden="true" /> : null}
          </div>
        ))}
      </Popover>
    </Field>
  );
}
