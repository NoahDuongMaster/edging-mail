// @vitest-environment node
import ts from '@typescript/typescript6';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, clientFiles, parse } from './helpers/scan';

// A phone tap target is 44 px (truong C-12). The classes `nm-tap-h` (44 px high) and `nm-tap` (44 x 44) do that with `min-height` and `min-width` at 900 px
// and below, and an INLINE `minHeight` or `minWidth` of a smaller number beats the class: the E2E badge and the locked-mail buttons were 28 and 36 px high
// on a phone for that reason. (`height: 40` does not matter: `min-height` wins over it.) This scan finds the same mistake wherever it is made again: an
// element with one of the classes whose `style` is an object, or names a constant of the same file, that sets a smaller `minHeight` / `minWidth`.

const TAP = /(^|\s)(nm-tap-h|nm-tap)(\s|$)/;

const propertyName = (name: ts.PropertyName): string | undefined =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;

/** The object literals a style expression is made of, one level of spreads and same-file constants deep. */
function literalsOf(
  expression: ts.Expression,
  constants: ReadonlyMap<string, ts.Expression>,
  seen = new Set<string>()
): ts.ObjectLiteralExpression[] {
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return literalsOf(expression.expression, constants, seen);
  }
  if (ts.isObjectLiteralExpression(expression)) {
    const nested = expression.properties.flatMap((property) =>
      ts.isSpreadAssignment(property) ? literalsOf(property.expression, constants, seen) : []
    );
    return [expression, ...nested];
  }
  if (ts.isIdentifier(expression) && !seen.has(expression.text)) {
    seen.add(expression.text);
    const known = constants.get(expression.text);
    return known === undefined ? [] : literalsOf(known, constants, seen);
  }
  if (ts.isConditionalExpression(expression)) {
    return [...literalsOf(expression.whenTrue, constants, seen), ...literalsOf(expression.whenFalse, constants, seen)];
  }
  return [];
}

/** The findings in one parsed source; `name` is what the finding calls the file. */
function problemsOf(source: ts.SourceFile, name: string): string[] {
  const constants = new Map<string, ts.Expression>();
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      constants.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
      const className = attributes.find((attribute) => attribute.name.getText(source) === 'className')?.initializer;
      const classText = className !== undefined && ts.isStringLiteral(className) ? className.text : '';
      const style = attributes.find((attribute) => attribute.name.getText(source) === 'style')?.initializer;
      if (TAP.test(classText) && style !== undefined && ts.isJsxExpression(style) && style.expression !== undefined) {
        const classes = new Set(classText.split(/\s+/));
        for (const literal of literalsOf(style.expression, constants)) {
          for (const property of literal.properties) {
            if (!ts.isPropertyAssignment(property)) {
              continue;
            }
            const propertyNameOf = propertyName(property.name);
            const guarded = propertyNameOf === 'minHeight' || (propertyNameOf === 'minWidth' && classes.has('nm-tap'));
            const value = ts.isNumericLiteral(property.initializer) ? Number(property.initializer.text) : Number.NaN;
            // A number of 44 or more is fine; anything else (a smaller number, an expression) is flagged.
            if (guarded && !(value >= 44)) {
              const line = source.getLineAndCharacterOfPosition(property.getStart(source)).line + 1;
              found.push(`${name}:${line} ${propertyNameOf}: ${property.initializer.getText(source)} on class "${classText}"`);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('phone tap targets: the class and the inline size do not fight (C-12)', () => {
  const files = clientFiles().filter((file) => file.endsWith('.tsx'));

  it('no element with nm-tap-h or nm-tap sets an inline minHeight (or minWidth for nm-tap) under 44 px', () => {
    expect(files.flatMap((file) => problemsOf(parse(file), path.relative(ROOT, file)))).toEqual([]);
  });

  it('the scan sees the mistake it is for: a constant, an inline value and a spread of the constant, but not a plain height or a 44', () => {
    const sample = [
      'const button = { minHeight: 36 };',
      'export const A = () => <button className="nm-tap-h" style={button} />;',
      'export const B = () => <button className="nm-tap-h" style={{ minHeight: 28 }} />;',
      'export const C = () => <button className="nm-tap-h" style={{ height: 40 }} />;',
      'export const D = () => <button className="nm-tap-h" style={{ ...button, width: 1 }} />;',
      'export const E = () => <button className="nm-tap-h" style={{ minHeight: 44 }} />;',
      'export const F = () => <button className="nm-tap" style={{ minWidth: 30 }} />;',
      'export const G = () => <button className="other" style={{ minHeight: 10 }} />;'
    ].join('\n');
    const found = problemsOf(ts.createSourceFile('sample.tsx', sample, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), 'sample');
    expect(found.map((line) => line.split(' ', 1)[0])).toEqual(['sample:1', 'sample:3', 'sample:1', 'sample:7']);
  });
});
