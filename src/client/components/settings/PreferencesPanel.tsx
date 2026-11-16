import type React from 'react';
import { useT } from '../../lib/i18n';
import { UNDO_SEND_CHOICES, setPref, usePrefs } from '../../lib/prefs';
import { SHOW_SHORTCUTS_EVENT } from '../../lib/shortcuts';
import { Button, Card, RadioGroup, Select, Switch } from '../../ui';
import { ShortcutList } from '../ShortcutList';
import './settings.css';

/** Motion on this device: follow the system setting, or reduce it here whatever the system says (`data-motion` on <html>). */
export function MotionPreference(): React.ReactElement {
  const tr = useT();
  const { motion } = usePrefs();
  return (
    <RadioGroup
      className="st-choices"
      label={tr('prefs.motion_choice')}
      options={[
        { value: 'system', label: tr('prefs.motion_system'), hint: tr('prefs.motion_system_hint') },
        { value: 'reduce', label: tr('prefs.motion_reduce'), hint: tr('prefs.motion_reduce_hint') }
      ]}
      value={motion}
      onChange={(value) => setPref('motion', value === 'reduce' ? 'reduce' : 'system')}
    />
  );
}

/** How tall a message row is on this device: comfortable (the avatar and a preview line) or compact (one line). `data-density` on <html>. */
export function DensityPreference(): React.ReactElement {
  const tr = useT();
  const { density } = usePrefs();
  return (
    <RadioGroup
      className="st-choices"
      label={tr('prefs.density')}
      options={[
        { value: 'comfortable', label: tr('prefs.density_comfortable'), hint: tr('prefs.density_comfortable_hint') },
        { value: 'compact', label: tr('prefs.density_compact'), hint: tr('prefs.density_compact_hint') }
      ]}
      value={density}
      onChange={(value) => setPref('density', value === 'compact' ? 'compact' : 'comfortable')}
    />
  );
}

/**
 * How long a sent message waits in this browser, so Undo can take it back (WCAG 2.2.1: the person sets the time, or turns it off). Five
 * choices, so a list (ui/Select) rather than a row of radios.
 */
export function UndoSendPreference(): React.ReactElement {
  const tr = useT();
  const { undoSend } = usePrefs();
  return (
    <div className="st-undo">
      {/* The card's title says what this is; the list keeps its own name for screen readers. */}
      <Select
        id="prefs-undo-send"
        label={tr('prefs.undo_send_label')}
        hideLabel
        hint={tr('prefs.undo_send_hint')}
        options={UNDO_SEND_CHOICES.map((seconds) => ({
          value: String(seconds),
          label: seconds === 0 ? tr('prefs.undo_send_off') : tr('prefs.undo_send_seconds', { seconds })
        }))}
        value={String(undoSend)}
        onChange={(value) => {
          const seconds = UNDO_SEND_CHOICES.find((choice) => String(choice) === value);
          if (seconds !== undefined) {
            setPref('undoSend', seconds);
          }
        }}
      />
    </div>
  );
}

/**
 * The switch for single-key shortcuts (WCAG 2.1.4) and EVERY key of the mailbox (J4-29, J6-28): the same list the ? dialog shows, drawn by
 * the same component from the same source (lib/shortcuts SHORTCUT_GROUPS), so the two never disagree. It ends with how to see it anywhere
 * (the ? key) and a button that opens that dialog (the mailbox listens for SHOW_SHORTCUTS_EVENT).
 */
export function ShortcutsPreference(): React.ReactElement {
  const tr = useT();
  const { shortcuts } = usePrefs();
  return (
    <>
      <Switch
        id="prefs-shortcuts"
        label={tr('prefs.shortcuts')}
        hint={tr('prefs.shortcuts_hint')}
        checked={shortcuts}
        onChange={(on) => setPref('shortcuts', on)}
      />
      <h4 id="prefs-keys" className="st-subtitle st-keys-title">
        {tr('prefs.shortcuts_table')}
      </h4>
      <ShortcutList headingLevel={5} idPrefix="prefs-keys" />
      <div className="sk-more">
        <p className="sk-more-text">{tr('shortcuts.anywhere')}</p>
        <Button size="sm" onClick={() => window.dispatchEvent(new Event(SHOW_SHORTCUTS_EVENT))}>
          {tr('shortcuts.open')}
        </Button>
      </div>
    </>
  );
}

/**
 * The preferences of this device (kept in its browser, not in the account): Motion, Density, Undo send and Keyboard, each a card as in
 * Settings (Appearance, Mail and Keyboard place them there). Alone, for the lab; `headingLevel` follows the page it is placed in.
 */
export function PreferencesPanel({ headingLevel = 3 }: { headingLevel?: 2 | 3 | 4 }): React.ReactElement {
  const tr = useT();
  return (
    <div className="st-cards">
      <Card headingLevel={headingLevel} title={tr('prefs.motion')} description={tr('prefs.device_only')}>
        <MotionPreference />
      </Card>
      <Card headingLevel={headingLevel} title={tr('prefs.density')} description={tr('prefs.device_only')}>
        <DensityPreference />
      </Card>
      <Card headingLevel={headingLevel} title={tr('prefs.undo_send')} description={tr('prefs.device_only')}>
        <UndoSendPreference />
      </Card>
      <Card headingLevel={headingLevel} title={tr('prefs.keyboard_title')} description={tr('prefs.device_only')}>
        <ShortcutsPreference />
      </Card>
    </div>
  );
}
