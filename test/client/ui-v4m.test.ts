import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingRow, SettingsGroup } from '../../src/client/components/settings/SettingsPage';
import {
  ActionBar,
  Button,
  Checkbox,
  Dialog,
  Disclosure,
  InfoTip,
  PhoneBar,
  RadioGroup,
  Section,
  Select,
  Switch,
  TextArea,
  TextField
} from '../../src/client/ui';
import { placePopup } from '../../src/client/ui/position';

// v4m wave 1 (DESIGN-v4m R1, R3, R4): the toggletip that replaces helper lines, the hint modes of every field, the phone bars and the inline
// touch box, as the server renders them. A screen reader and the stylesheet rely on this markup: the hint stays in the page (visually hidden)
// under its `${id}-hint` id, the control's name stays its label alone (the tip is never inside the <label> or the heading), and nothing of
// the bars' measuring runs on the server. Opening, closing and the look are checked in the browser (the lab).

const noop = (): void => {
  // a callback the test does not look at
};
const render = (element: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(element);
/** The opening tag of the InfoTip button. */
const tipButton = (html: string): string => /<button [^>]*class="ui-infotip"[^>]*>/.exec(html)?.[0] ?? '';

describe('InfoTip', () => {
  it('is a toggletip button named "About {label}", closed, with its glyph hidden and no bubble until it opens', () => {
    const html = render(h(InfoTip, { label: 'Display name', id: 'name-tip', children: 'People see it next to your address.' }));
    expect(html).toBe(
      '<button type="button" id="name-tip" class="ui-infotip" data-size="md" aria-label="About Display name" aria-expanded="false">' +
        `<span class="ui-infotip-glyph">${/<svg[^>]*>[\s\S]*<\/svg>/.exec(html)?.[0] ?? ''}</span></button>`
    );
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).toMatch(/<svg[^>]*width="20"/);
    // The bubble (a Popover in <body>) exists only while open, so aria-controls is only set then.
    expect(html).not.toContain('aria-controls');
    expect(html).not.toContain('People see it');
  });

  it('has a small size, and makes up an id when none is given', () => {
    const html = render(h(InfoTip, { label: 'Notes', size: 'sm', children: 'Words' }));
    expect(tipButton(html)).toContain('data-size="sm"');
    expect(tipButton(html)).toMatch(/id="[^"]+-tip"/);
    expect(html).toMatch(/<svg[^>]*width="16"/);
  });
});

describe('field hints (hintMode, DESIGN-v4m R1)', () => {
  it("TextField: by default the hint is a tip after the label, kept hidden in the page and named by the field's describedby", () => {
    const html = render(h(TextField, { id: 'f', label: 'Display name', hint: 'Shown to the people you write to.' }));
    // The label row holds the real <label> (its words alone: the field's name) and the tip beside it, not inside it.
    expect(html).toContain('<div class="ui-label ui-tip-row"><label id="f-label" for="f">Display name</label><button type="button"');
    expect(tipButton(html)).toContain('aria-label="About Display name"');
    expect(html).toContain('<span id="f-hint" class="ui-visually-hidden">Shown to the people you write to.</span>');
    expect(html).toMatch(/<input id="f"[^>]*aria-describedby="f-hint"/);
    expect(html).not.toContain('class="ui-hint"');
    // The words are said once: only the hidden hint is in describedby (the bubble is not in the page while closed).
    expect(html.match(/Shown to the people you write to\./g)).toHaveLength(1);
  });

  it('TextField and TextArea: hintMode="inline" keeps the visible line under the box, with no tip', () => {
    for (const html of [
      render(h(TextField, { id: 'f', label: 'Password', hint: 'At least 16 characters.', hintMode: 'inline' })),
      render(h(TextArea, { id: 'f', label: 'Password', hint: 'At least 16 characters.', hintMode: 'inline' }))
    ]) {
      expect(html).toContain('<label id="f-label" for="f" class="ui-label">Password</label>');
      expect(html).toContain('<p id="f-hint" class="ui-hint">At least 16 characters.</p>');
      expect(html).not.toContain('ui-infotip');
      expect(html).toContain('aria-describedby="f-hint"');
    }
  });

  it('shows the hint inline when the label is hidden (there is nothing to put a tip on), and joins the error as before', () => {
    const hidden = render(h(TextField, { id: 's', label: 'Search', hideLabel: true, hint: 'Press / to search' }));
    expect(hidden).toContain('<p id="s-hint" class="ui-hint">Press / to search</p>');
    expect(hidden).not.toContain('ui-infotip');
    const both = render(h(TextField, { id: 'e', label: 'Email', hint: 'Your sign-in address.', error: 'Type an address.' }));
    expect(both).toContain('aria-describedby="e-hint e-error"');
    expect(both).toContain('<p id="e-error" class="ui-error">');
  });

  it('Select: the tip sits after the label span the combobox is named by', () => {
    const html = render(
      h(Select, {
        id: 'lang',
        label: 'Language',
        hint: 'For the sign-in screens.',
        options: [{ value: 'en', label: 'English' }],
        value: 'en',
        onChange: noop
      })
    );
    expect(html).toContain('<div class="ui-label ui-tip-row"><span id="lang-label">Language</span><button type="button"');
    expect(html).toContain('aria-labelledby="lang-label lang"');
    expect(html).toContain('<span id="lang-hint" class="ui-visually-hidden">For the sign-in screens.</span>');
    expect(html).toContain('aria-describedby="lang-hint"');
  });

  it('Checkbox: a row whose <label for> holds the words alone, the tip outside the label, the hint hidden and described', () => {
    const html = render(
      h(Checkbox, { id: 'c', label: 'Shared device', hint: 'Signs out when the tab closes.', checked: false, onChange: noop })
    );
    expect(html).toMatch(/^<div class="ui-check" data-tip="true">/);
    expect(html).toContain('<label for="c" class="ui-check-label">Shared device</label>');
    expect(/<label[\s\S]*?<\/label>/.exec(html)?.[0]).not.toContain('ui-infotip');
    expect(tipButton(html)).toContain('aria-label="About Shared device"');
    expect(html).toContain('<span id="c-hint" class="ui-visually-hidden">Signs out when the tab closes.</span>');
    expect(html).toMatch(/<input id="c" type="checkbox"[^>]*aria-describedby="c-hint"/);
  });

  it('Checkbox: hintMode="inline" (and no hint at all) is the one label round the box, the words and the line (C-12)', () => {
    const inline = render(h(Checkbox, { id: 'c', label: 'Saved', hint: 'Tick once they are stored.', hintMode: 'inline', checked: false }));
    expect(inline).toMatch(/^<label class="ui-check">/);
    expect(inline).toContain('<span id="c-hint" class="ui-hint">Tick once they are stored.</span>');
    expect(inline).not.toContain('ui-infotip');
    expect(render(h(Checkbox, { id: 'd', label: 'Select all', checked: false }))).toMatch(/^<label class="ui-check">/);
  });

  it('Checkbox: a label that is an element names its tip by its words, or by tipLabel', () => {
    const element = render(h(Checkbox, { id: 'x', label: h('span', { id: 'x-label' }, 'Shared device'), hint: 'Hint' }));
    expect(tipButton(element)).toContain('aria-label="About Shared device"');
    const named = render(h(Checkbox, { id: 'y', label: h('span', null, 'A'), tipLabel: 'Keep me', hint: 'Hint' }));
    expect(tipButton(named)).toContain('aria-label="About Keep me"');
  });

  it('Switch: the tip after the label words, outside the <label>; inline keeps the line', () => {
    const tip = render(h(Switch, { id: 'sw', label: 'Shortcuts', hint: 'Single keys act at once.', checked: true, onChange: noop }));
    expect(tip).toContain('<span class="ui-label ui-tip-row"><label for="sw">Shortcuts</label><button type="button"');
    expect(tip).toContain('<span id="sw-hint" class="ui-visually-hidden">Single keys act at once.</span>');
    expect(tip).toMatch(/<button type="button" role="switch" id="sw" aria-checked="true" aria-describedby="sw-hint"/);
    const inline = render(h(Switch, { id: 'sw', label: 'Push', hint: 'Blocked.', hintMode: 'inline', checked: false, onChange: noop }));
    expect(inline).toContain('<label for="sw" class="ui-label">Push</label><span id="sw-hint" class="ui-hint">Blocked.</span>');
    expect(inline).not.toContain('ui-infotip');
  });

  it("RadioGroup: an option with a hint keeps the radio as the row's direct child, its label for it, the tip beside", () => {
    const html = render(
      h(RadioGroup, {
        label: 'Motion',
        name: 'm',
        value: 'system',
        onChange: noop,
        options: [
          { value: 'system', label: 'Follow the system', hint: 'Uses the device setting.' },
          { value: 'reduce', label: 'Reduce', hint: 'No movement.', hintMode: 'inline' },
          { value: 'full', label: 'Full' }
        ]
      })
    );
    expect(html).toContain('<div class="ui-check" data-tip="true"><input id="m-system" type="radio" class="ui-radio-input"');
    expect(html).toContain('<label for="m-system" class="ui-check-label">Follow the system</label>');
    expect(html).toContain('<span id="m-system-hint" class="ui-visually-hidden">Uses the device setting.</span>');
    expect(html).toContain('aria-describedby="m-system-hint"');
    // Per option: inline keeps today's row, and an option without a hint is the plain label row.
    expect(html).toContain('<span id="m-reduce-hint" class="ui-hint">No movement.</span>');
    expect(html).toMatch(/<label class="ui-check"><input type="radio" class="ui-radio-input" name="m" value="full"/);
  });

  it('SettingRow: a labelled hint becomes a tip after the label (its id kept); a row without a label keeps its line', () => {
    const tip = render(
      h(SettingRow, { label: 'Desktop alerts', hint: 'Only on this device.', hintId: 'alerts-hint' }, h(Button, null, 'Test'))
    );
    expect(tip).toContain('<span class="st-row-label ui-tip-row"><span>Desktop alerts</span><button type="button"');
    expect(tip).toContain('<span id="alerts-hint" class="ui-visually-hidden">Only on this device.</span>');
    const bare = render(h(SettingRow, { hint: 'Turn alerts on first.', hintId: 'test-hint' }, h(Button, null, 'Test')));
    expect(bare).toContain('<span id="test-hint" class="st-row-hint">Turn alerts on first.</span>');
    const inline = render(h(SettingRow, { label: 'A', hint: 'B', hintMode: 'inline' }));
    expect(inline).toContain('<span class="st-row-label">A</span><span class="st-row-hint">B</span>');
  });
});

describe('titles with an InfoTip (`info`)', () => {
  it('Section and SettingsGroup: the tip stands beside the heading, which keeps its words alone', () => {
    const html = render(h(Section, { title: 'Motion', info: 'Applies to this device only.', headingLevel: 3 }, 'rows'));
    expect(html).toMatch(/<div class="ui-tip-row"><h3 id="[^"]+" class="ui-section-title">Motion<\/h3><button type="button"/);
    expect(tipButton(html)).toContain('aria-label="About Motion"');
    const group = render(h(SettingsGroup, { title: 'Density', info: 'Applies here only.', children: h('div', null, 'row') }));
    expect(group).toMatch(/<h4 id="[^"]+" class="ui-section-title">Density<\/h4><button type="button"/);
    expect(render(h(Section, { title: 'Plain' }, 'x'))).not.toContain('ui-tip-row');
  });

  it('Dialog: `info` puts the tip after the title (the dialog stays named by the h2 alone); without it the head is unchanged', () => {
    const html = render(
      h(Dialog, { open: true, inline: true, onClose: noop, title: 'New account', info: 'They choose their own password next.' }, 'x')
    );
    const titleId = /aria-labelledby="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(html).toContain(
      `<div class="ui-dialog-heading ui-tip-row"><h2 id="${titleId}" class="ui-dialog-title">New account</h2><button type="button"`
    );
    expect(tipButton(html)).toContain('aria-label="About New account"');
    const plain = render(h(Dialog, { open: true, inline: true, onClose: noop, title: 'Title' }, 'x'));
    expect(plain).toMatch(/<div class="ui-dialog-head"><h2 id="[^"]+" class="ui-dialog-title">Title<\/h2>/);
    // The scroll states are the browser's (data-scrolls, data-scrolled): nothing on the server.
    expect(plain).not.toMatch(/data-scroll/);
  });
});

describe('PhoneBar and ActionBar (DESIGN-v4m R3)', () => {
  it('PhoneBar: a header with the start slot, the title as an h1 (or the element asked for) and the end slot', () => {
    const html = render(
      h(PhoneBar, {
        title: 'Security',
        titleId: 'bar-title',
        start: h('button', { type: 'button' }, 'Back'),
        end: h('button', { type: 'button' }, 'Add')
      })
    );
    expect(html).toBe(
      '<header class="ui-phonebar"><div class="ui-phonebar-start"><button type="button">Back</button></div>' +
        '<h1 id="bar-title" class="ui-phonebar-title">Security</h1><div class="ui-phonebar-end"><button type="button">Add</button></div></header>'
    );
    expect(render(h(PhoneBar, { title: 'Mail', as: 'div', className: 'xx-bar' }))).toBe(
      '<header class="ui-phonebar xx-bar"><div class="ui-phonebar-title">Mail</div></header>'
    );
  });

  it('ActionBar: a plain row on the server unless docked everywhere; it passes its props through', () => {
    const phone = render(h(ActionBar, { className: 'xx-actions', id: 'acts' }, h(Button, { variant: 'primary' }, 'Save')));
    expect(phone).toMatch(/^<div class="ui-actionbar xx-actions" id="acts"><button/);
    expect(phone).not.toContain('data-docked');
    const always = render(h(ActionBar, { dock: 'always' }, h(Button, null, 'Cancel'), h(Button, { variant: 'primary' }, 'Save')));
    expect(always).toMatch(/^<div class="ui-actionbar" data-docked="true"><button/);
    // No measured defaults in the server markup (the browser writes them).
    expect(always).not.toContain('--ui-actionbar-auto');
  });
});

describe('inline text buttons (DESIGN-v4m R4)', () => {
  it('Button and Disclosure `inline` add data-inline (ui.css grows the target without moving the text); default markup unchanged', () => {
    expect(render(h(Button, { variant: 'ghost', size: 'sm', inline: true }, 'See why'))).toContain('data-inline="true"');
    expect(render(h(Button, null, 'Save'))).not.toContain('data-inline');
    const text = render(h(Disclosure, { open: false, onOpenChange: noop, inline: true, children: '6 more notices' }));
    expect(text).toMatch(/^<button type="button" class="ui-disclosure" data-look="text" data-inline="true" aria-expanded="false">/);
    const button = render(h(Disclosure, { open: false, onOpenChange: noop, look: 'button', inline: true, children: 'Show all (4)' }));
    expect(button).toContain('data-inline="true"');
  });
});

describe('popup placement for the tip (position.ts)', () => {
  const viewport = { width: 320, height: 568 };
  const glyph = { top: 300, left: 280, width: 20, height: 20 };
  it('prefers above when asked, flips when it does not fit, and `auto` takes the side with more room', () => {
    expect(placePopup(glyph, { width: 300, height: 80 }, viewport, 'start', 4, 8, 'above').side).toBe('above');
    expect(placePopup({ ...glyph, top: 40 }, { width: 300, height: 80 }, viewport, 'start', 4, 8, 'above').side).toBe('below');
    expect(placePopup({ ...glyph, top: 400 }, { width: 300, height: 80 }, viewport, 'start', 4, 8, 'auto').side).toBe('above');
    expect(placePopup({ ...glyph, top: 100 }, { width: 300, height: 80 }, viewport, 'start', 4, 8, 'auto').side).toBe('below');
  });
  it('starts the bubble 12 px before the glyph and keeps it 8 px inside a 320 px screen', () => {
    const near = placePopup({ ...glyph, left: 60 }, { width: 200, height: 60 }, viewport, 'start', 4, 8, 'below', -12);
    expect(near.left).toBe(48);
    const edge = placePopup(glyph, { width: 300, height: 60 }, viewport, 'start', 4, 8, 'below', -12);
    expect(edge.left).toBe(12);
    expect(edge.left + 300).toBeLessThanOrEqual(viewport.width - 8);
  });
});
