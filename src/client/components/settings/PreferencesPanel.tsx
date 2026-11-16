import type React from 'react';
import { useT } from '../../lib/i18n';
import { UNDO_SEND_CHOICES, setPref, usePrefs } from '../../lib/prefs';
import { SHOW_SHORTCUTS_EVENT } from '../../lib/shortcuts';
import { Button, RadioGroup, Section, Select, Switch } from '../../ui';
import { ShortcutList } from '../ShortcutList';
import { SettingRow, SettingsGroup } from './SettingsPage';
import './settings.css';

/**
 * Motion on this device: follow the system setting, or reduce it here whatever the system says (`data-motion` on <html>). The choices are
 * the rows of the group they sit in (settings.css), the group's title says what they are about.
 */
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
 * choices, so a list (ui/Select) rather than a row of radios: one row of a group, its label and hint on the left, the list on the right.
 */
export function UndoSendPreference(): React.ReactElement {
  const tr = useT();
  const { undoSend } = usePrefs();
  return (
    <div className="st-field-row">
      <Select
        id="prefs-undo-send"
        label={tr('prefs.undo_send_label')}
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
 * the same component from the same source (lib/shortcuts SHORTCUT_GROUPS), so the two never disagree. The switch and the way to that dialog
 * anywhere (the ? key, and a button: the mailbox listens for SHOW_SHORTCUTS_EVENT) are one group; the keys follow on a card of their own.
 */
export function ShortcutsPreference(): React.ReactElement {
  const tr = useT();
  const { shortcuts } = usePrefs();
  return (
    <>
      <SettingsGroup>
        <Switch
          id="prefs-shortcuts"
          label={tr('prefs.shortcuts')}
          hint={tr('prefs.shortcuts_hint')}
          checked={shortcuts}
          onChange={(on) => setPref('shortcuts', on)}
        />
        <SettingRow hint={tr('shortcuts.anywhere')}>
          <Button size="sm" onClick={() => window.dispatchEvent(new Event(SHOW_SHORTCUTS_EVENT))}>
            {tr('shortcuts.open')}
          </Button>
        </SettingRow>
      </SettingsGroup>
      <section aria-labelledby="prefs-keys" className="st-block">
        <h4 id="prefs-keys" className="st-subtitle">
          {tr('prefs.shortcuts_table')}
        </h4>
        <ShortcutList headingLevel={5} idPrefix="prefs-keys" />
      </section>
    </>
  );
}

/**
 * The preferences of this device (kept in its browser, not in the account): Motion, Density, Undo send and Keyboard, each a group as in
 * Settings (Appearance, Mail and Keyboard place them there). Alone, for the lab; `headingLevel` follows the page it is placed in.
 */
export function PreferencesPanel({ headingLevel = 3 }: { headingLevel?: 2 | 3 | 4 }): React.ReactElement {
  const tr = useT();
  return (
    <div className="st-page">
      <SettingsGroup headingLevel={headingLevel} title={tr('prefs.motion')} description={tr('prefs.device_only')}>
        <MotionPreference />
      </SettingsGroup>
      <SettingsGroup headingLevel={headingLevel} title={tr('prefs.density')} description={tr('prefs.device_only')}>
        <DensityPreference />
      </SettingsGroup>
      <SettingsGroup headingLevel={headingLevel} title={tr('prefs.undo_send')} description={tr('prefs.device_only')}>
        <UndoSendPreference />
      </SettingsGroup>
      <Section className="st-block" headingLevel={headingLevel} title={tr('prefs.keyboard_title')} description={tr('prefs.device_only')}>
        <ShortcutsPreference />
      </Section>
    </div>
  );
}
