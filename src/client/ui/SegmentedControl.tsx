import React from 'react';
import { cx } from './cx';
import { firstEnabled, lastEnabled, moveIndex } from './listNav';

export interface SegmentOption<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<V extends string> {
  /** What the choice is about ("Filter", "Show the message as"): the accessible name of the group. */
  label: string;
  options: readonly SegmentOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /**
   * `radio` (default): a radiogroup with one Tab stop; the arrows, Home and End move AND choose, as radio buttons do. `toggle`: a row of
   * buttons that say `aria-pressed`, each its own Tab stop, for a row of filters that has always been toggle buttons.
   */
  mode?: 'radio' | 'toggle';
  /** 28 px (sm) or 32 px (md) high on a desktop; a 44 px target on a phone or a touch screen. */
  size?: 'sm' | 'md';
  /** Where the row is too narrow (a phone, a long language), the segments wrap onto a second line instead of being cut: two by two, so four
   *  of them make two even rows. */
  wrap?: boolean;
  className?: string;
}

/**
 * The option a key moves to in a radio segmented control, or -1 when the key is not one of its keys: Left/Up and Right/Down go round,
 * Home and End jump to the first and the last option that can be chosen.
 */
export function segmentTarget(options: readonly SegmentOption[], current: number, key: string): number {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown': {
      return moveIndex(options, current, 1, true);
    }
    case 'ArrowLeft':
    case 'ArrowUp': {
      return moveIndex(options, current, -1, true);
    }
    case 'Home': {
      return firstEnabled(options);
    }
    case 'End': {
      return lastEnabled(options);
    }
    default: {
      return -1;
    }
  }
}

/** A track that may wrap holds its segments two by two (ui.css `.ui-seg-pair`), so four make one row or two even rows, never 3 + 1. */
function inPairs(segments: React.ReactElement[]): React.ReactElement[] {
  const pairs: React.ReactElement[] = [];
  for (let first = 0; first < segments.length; first += 2) {
    pairs.push(
      <div key={`pair-${first}`} className="ui-seg-pair">
        {segments.slice(first, first + 2)}
      </div>
    );
  }
  return pairs;
}

/**
 * Two to four short choices side by side in one track, the chosen one raised (a view switch, the filters of a list). The choice applies at
 * once; use RadioGroup for a setting in a form and Tabs for panels of content. Every segment is named by its text.
 */
export function SegmentedControl<V extends string>({
  label,
  options,
  value,
  onChange,
  mode = 'radio',
  size = 'sm',
  wrap = false,
  className
}: SegmentedControlProps<V>): React.ReactElement {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const chosen = options.findIndex((option) => option.value === value);
  // The one Tab stop of a radiogroup: the chosen option, or the first one that can be chosen.
  const stop = chosen !== -1 && options[chosen].disabled !== true ? chosen : firstEnabled(options);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = segmentTarget(options, chosen, event.key);
    if (target === -1) {
      return;
    }
    event.preventDefault();
    onChange(options[target].value);
    refs.current[target]?.focus();
  };

  const common = {
    'aria-label': label,
    className: cx('ui-seg', className),
    'data-size': size,
    'data-wrap': wrap ? 'true' : undefined
  };

  if (mode === 'toggle') {
    const segments = options.map((option) => (
      <button
        key={option.value}
        type="button"
        className="ui-seg-item"
        aria-pressed={option.value === value}
        disabled={option.disabled}
        onClick={() => onChange(option.value)}
      >
        <span className="ui-seg-label">{option.label}</span>
      </button>
    ));
    return (
      <div role="group" {...common}>
        {wrap ? inPairs(segments) : segments}
      </div>
    );
  }

  const segments = options.map((option, index) => (
    <button
      key={option.value}
      ref={(element) => {
        refs.current[index] = element;
      }}
      type="button"
      role="radio"
      className="ui-seg-item"
      aria-checked={option.value === value}
      tabIndex={index === stop ? 0 : -1}
      disabled={option.disabled}
      onClick={() => onChange(option.value)}
    >
      <span className="ui-seg-label">{option.label}</span>
    </button>
  ));
  return (
    // The arrow keys are handled on the group, for the option that has focus: the options themselves are the controls (roving tabindex).
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- the radios inside are the focusable parts
    <div role="radiogroup" {...common} onKeyDown={onKeyDown}>
      {wrap ? inPairs(segments) : segments}
    </div>
  );
}
