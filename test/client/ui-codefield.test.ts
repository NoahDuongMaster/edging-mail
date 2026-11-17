import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CodeField } from '../../src/client/ui';
import { nextCode } from '../../src/client/ui/CodeField';

// ui CodeField: the one-time code in six boxes. The boxes are drawing only (aria-hidden); the field itself is ONE ordinary input with
// its label, so the phone's code autofill, paste and a screen reader all see one text field. Typing, paste and the caret are checked
// in the browser (the lab); this pins the markup they rely on.

const noop = (): void => {
  // a callback the test does not look at
};
const render = (props: Partial<Parameters<typeof CodeField>[0]> = {}): string =>
  renderToStaticMarkup(h(CodeField, { id: 'code', label: 'Six-digit code', value: '', onChange: noop, ...props }));
const inputTag = (html: string): string => /<input [^>]*>/.exec(html)?.[0] ?? '';

describe('CodeField', () => {
  it('is one labelled input that asks for a one-time code with the number pad, and six boxes hidden from screen readers', () => {
    const html = render();
    expect(html).toContain('<label id="code-label" for="code" class="ui-label">Six-digit code</label>');
    const input = inputTag(html);
    expect(input).toContain('id="code"');
    expect(input).toContain('autoComplete="one-time-code"');
    expect(input).toContain('inputMode="numeric"');
    expect(input).toContain('type="text"');
    // No maxLength: a pasted "123 456" would be cut before its space is dropped.
    expect(input).not.toMatch(/maxLength/i);
    expect(html.match(/<input /g)).toHaveLength(1);
    expect(html).toMatch(/<div class="ui-otp-slots" aria-hidden="true">/);
    expect(html.match(/class="ui-otp-slot"/g)).toHaveLength(6);
    // The wider gap is after the third box, where the app prints its space.
    expect(html.match(/data-split="true"/g)).toHaveLength(1);
    expect(html).toMatch(/<span class="ui-otp-slot"[^>]*data-next="true"[^>]*><span class="ui-otp-caret"><\/span><\/span>/);
  });

  it('draws the digits it has, one per box, and keeps only digits', () => {
    const html = render({ value: '12 3a4' });
    expect(inputTag(html)).toContain('value="1234"');
    const filled = [...html.matchAll(/<span class="ui-otp-slot" data-filled="true"[^>]*>(\d)<\/span>/g)].map((match) => match[1]);
    expect(filled).toEqual(['1', '2', '3', '4']);
    // The fifth box takes the next digit.
    expect(html).toMatch(/<span class="ui-otp-slot" data-next="true"><span class="ui-otp-caret"><\/span><\/span>/);
  });

  it('says what is wrong with every box red and the error read with the field; a hint stays in the page for screen readers', () => {
    const html = render({ error: 'Enter the six digits.', hint: 'The code the app shows now.' });
    expect(html).toMatch(/<div class="ui-otp" data-invalid="true">/);
    const input = inputTag(html);
    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain('aria-describedby="code-hint code-error"');
    expect(html).toContain('<span id="code-hint" class="ui-visually-hidden">The code the app shows now.</span>');
    expect(html).toContain('id="code-error"');
  });

  it('marks the row invalid when the screen says so on the input (a sign-in error line of its own)', () => {
    const html = render({ 'aria-invalid': true, 'aria-describedby': 'signin-error' });
    expect(html).toMatch(/<div class="ui-otp" data-invalid="true">/);
    expect(inputTag(html)).toContain('aria-describedby="signin-error"');
  });
});

describe('nextCode (the code after an edit; the caret is always at the end)', () => {
  it.each([
    ['types a digit after the code', '12', '123', '123'],
    ['drops what is not a digit', '12', '12a', '12'],
    ['ignores a seventh digit on a full code', '123456', '1234567', '123456'],
    ['erases from the end', '1234', '123', '123'],
    ['takes a pasted code with its space', '', '123 456', '123456'],
    ['replaces a half-typed code with a whole one pasted or autofilled after it', '12', '12987 654', '987654'],
    ['adds a part of a code pasted after it', '12', '1234', '1234'],
    ['takes what replaced the whole selected code', '123456', '7', '7'],
    ['empties with the whole code selected and Backspace', '123456', '', '']
  ])('%s', (_name, previous, text, expected) => {
    expect(nextCode(previous, text, 6)).toBe(expected);
  });
});
