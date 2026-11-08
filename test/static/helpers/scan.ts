import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from '@typescript/typescript6';

// Static scans of the client source for the i18n tests (node only: the TypeScript compiler API and the disk). In the client the
// translate function is called `tr` (`const tr = useT()`), because `t` is already the theme in almost every component.

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const CLIENT = path.join(ROOT, 'src', 'client');

/** Names under which the client calls the translator. `tDyn` builds keys at run time (see families.ts). */
export const TRANSLATE_CALLS = new Set(['tr', 't', 'tRich']);
export const DYNAMIC_CALLS = new Set(['tDyn']);

/** JSX attributes and object properties that carry text a person reads (or a screen reader speaks). */
export const TEXT_ATTRIBUTES = new Set([
  'alt',
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'label',
  'title',
  'placeholder',
  'description',
  'hint',
  'heading',
  'caption',
  'tooltip',
  'helper',
  'helperText',
  'confirmLabel',
  'cancelLabel',
  'submitLabel',
  'body',
  'text',
  'message',
  'subtitle',
  'summary',
  'emptyText'
]);

/** Browser dialogs that show their argument to the person. */
export const DIALOG_CALLS = new Set(['alert', 'confirm', 'prompt']);

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly kind: string;
  readonly text: string;
}

export function walk(dir: string, extensions: readonly string[]): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const entry = path.join(dir, name);
    if (statSync(entry).isDirectory()) {
      found.push(...walk(entry, extensions));
    } else if (extensions.some((extension) => name.endsWith(extension))) {
      found.push(entry);
    }
  }
  return found.toSorted();
}

export const clientFiles = (): string[] => walk(CLIENT, ['.ts', '.tsx']).filter((file) => !file.endsWith('.d.ts'));

export function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

const hasLetters = (text: string): boolean => /\p{L}/u.test(text.replaceAll(/&[a-zA-Z0-9#]+;/g, ''));

/** Text that is a brand name or has no letters is not translatable text. */
const isAllowed = (text: string): boolean => !hasLetters(text) || ['Edging Mail', 'Edgar'].includes(text.trim());

const lineOf = (source: ts.SourceFile, node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

/** The static text of a string or template literal, or undefined for anything else. */
function literalText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((span) => span.literal.text).join('');
  }
  return undefined;
}

/** The string literals a JSX expression can print as they are: itself, the branches of ?: and the right side of && || ??. */
function outputLiterals(node: ts.Expression): ts.Expression[] {
  if (ts.isParenthesizedExpression(node)) {
    return outputLiterals(node.expression);
  }
  if (ts.isConditionalExpression(node)) {
    return [...outputLiterals(node.whenTrue), ...outputLiterals(node.whenFalse)];
  }
  if (ts.isBinaryExpression(node)) {
    const kind = node.operatorToken.kind;
    if (kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return outputLiterals(node.right);
    }
    if (kind === ts.SyntaxKind.BarBarToken || kind === ts.SyntaxKind.QuestionQuestionToken) {
      return [...outputLiterals(node.left), ...outputLiterals(node.right)];
    }
    if (kind === ts.SyntaxKind.PlusToken) {
      return [...outputLiterals(node.left), ...outputLiterals(node.right)];
    }
  }
  return literalText(node) === undefined ? [] : [node];
}

const propertyName = (name: ts.PropertyName): string | undefined =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;

const calleeName = (call: ts.CallExpression): string | undefined => {
  if (ts.isIdentifier(call.expression)) {
    return call.expression.text;
  }
  return ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : undefined;
};

/**
 * Looks like a sentence or a label rather than an identifier, a path or a code: a capitalised word followed by more words, a
 * single capitalised word of three letters or more (a folder or a button name), or a sentence that ends in punctuation.
 */
export function isProse(text: string): boolean {
  const s = text.trim().replaceAll(/\s+/g, ' ');
  if (/^[A-Z][a-z]+( [A-Za-z0-9'’(){}.,:;!?/-]+)+/.test(s)) {
    return true;
  }
  if (/^[A-Z][a-z]{2,}[.!?…]?$/.test(s)) {
    return true;
  }
  return s.includes(' ') && /\p{L}{3,}.*[.!?…]$/u.test(s);
}

/** Calls whose arguments are never shown to a person: logging, the translators and module loading. */
const QUIET_CALLS = /^(console\.\w+|tr|t|tRich|tDyn|require|import|describe|it|test)$/;

function inQuietContext(node: ts.Node, source: ts.SourceFile): boolean {
  let current: ts.Node = node.parent;
  while (!ts.isSourceFile(current)) {
    if (ts.isCallExpression(current) && QUIET_CALLS.test(current.expression.getText(source))) {
      return true;
    }
    if (ts.isImportDeclaration(current) || ts.isExportDeclaration(current) || ts.isLiteralTypeNode(current) || ts.isCaseClause(current)) {
      return true;
    }
    if (
      ts.isBinaryExpression(current) &&
      [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(current.operatorToken.kind)
    ) {
      return true;
    }
    if (ts.isElementAccessExpression(current) || ts.isStatement(current)) {
      return false;
    }
    current = current.parent;
  }
  return false;
}

/** Every text of the client source that a person can read and that is not in the catalogue. */
export function hardcoded(file: string, allow: (finding: Finding) => boolean = () => false): Finding[] {
  const source = parse(file);
  const name = path.relative(ROOT, file);
  const found: Finding[] = [];
  const reported = new Set<number>();
  const add = (node: ts.Node, kind: string, text: string): void => {
    reported.add(node.getStart(source));
    const finding = { file: name, line: lineOf(source, node), kind, text: text.trim().replaceAll(/\s+/g, ' ') };
    if (!isAllowed(text) && !allow(finding)) {
      found.push(finding);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      add(node, 'jsx-text', node.text);
    } else if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      for (const literal of outputLiterals(node.expression)) {
        add(literal, 'jsx-expression', literalText(literal) ?? '');
      }
    } else if (ts.isJsxAttribute(node) && TEXT_ATTRIBUTES.has(node.name.getText(source)) && node.initializer) {
      const attribute = node.name.getText(source);
      if (ts.isStringLiteral(node.initializer)) {
        add(node.initializer, `attribute ${attribute}`, node.initializer.text);
      } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        for (const literal of outputLiterals(node.initializer.expression)) {
          add(literal, `attribute ${attribute}`, literalText(literal) ?? '');
        }
      }
    } else if (ts.isPropertyAssignment(node)) {
      const key = propertyName(node.name);
      if (key !== undefined && TEXT_ATTRIBUTES.has(key) && !ts.isJsxAttribute(node.parent)) {
        for (const literal of outputLiterals(node.initializer)) {
          add(literal, `property ${key}`, literalText(literal) ?? '');
        }
      }
    } else if (ts.isCallExpression(node)) {
      const callee = calleeName(node);
      if (callee !== undefined && DIALOG_CALLS.has(callee)) {
        for (const argument of node.arguments) {
          for (const literal of outputLiterals(argument)) {
            add(literal, `${callee}()`, literalText(literal) ?? '');
          }
        }
      }
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      node.left.getText(source) === 'document.title'
    ) {
      for (const literal of outputLiterals(node.right)) {
        add(literal, 'document.title', literalText(literal) ?? '');
      }
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) &&
      !reported.has(node.getStart(source)) &&
      !(ts.isPropertyAssignment(node.parent) && node.parent.name === node) &&
      !inQuietContext(node, source)
    ) {
      const text = literalText(node) ?? '';
      if (isProse(text)) {
        add(node, 'text', text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

export interface TranslateCall {
  readonly file: string;
  readonly line: number;
  readonly callee: string;
  /** The literal key, or undefined when the first argument is not a literal. */
  readonly key: string | undefined;
  /** The key is put together in place (a template with substitutions, or a `+`): only tDyn may do that. A variable or a property holding a typed key is fine. */
  readonly built: boolean;
  /** For tDyn: the static start of the key it builds. */
  readonly prefix: string | undefined;
}

const isBuilt = (node: ts.Expression): boolean =>
  ts.isTemplateExpression(node) || (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken);

function staticPrefix(node: ts.Expression): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return node.head.text;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return staticPrefix(node.left);
  }
  return undefined;
}

export function translateCalls(file: string): TranslateCall[] {
  const source = parse(file);
  const found: TranslateCall[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callee = node.expression.text;
      if (node.arguments.length > 0 && TRANSLATE_CALLS.has(callee)) {
        const first = node.arguments[0];
        found.push({
          file: path.relative(ROOT, file),
          line: lineOf(source, node),
          callee,
          key: literalText(first),
          built: isBuilt(first),
          prefix: undefined
        });
      } else if (node.arguments.length > 0 && DYNAMIC_CALLS.has(callee)) {
        const first = node.arguments[0];
        found.push({
          file: path.relative(ROOT, file),
          line: lineOf(source, node),
          callee,
          key: undefined,
          built: true,
          prefix: staticPrefix(first)
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Every string literal in a file: a catalogue key written anywhere (a lookup table of keys, a typed constant) counts as used. */
export function stringLiterals(file: string): Set<string> {
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file));
  return found;
}

/** Calls that format with a locale the UI did not choose: toLocale*String() and the Intl formatters (use `fmt` instead). */
export function localeProblems(file: string): Finding[] {
  const source = parse(file);
  const found: Finding[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      /^toLocale(Date|Time)?String$/.test(node.expression.name.text)
    ) {
      found.push({
        file: path.relative(ROOT, file),
        line: lineOf(source, node),
        kind: 'toLocale*String',
        text: node.getText(source).slice(0, 80)
      });
    }
    if (
      (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'Intl' &&
      /^(DateTimeFormat|NumberFormat|RelativeTimeFormat|ListFormat|PluralRules|Collator|DisplayNames)$/.test(node.expression.name.text)
    ) {
      found.push({
        file: path.relative(ROOT, file),
        line: lineOf(source, node),
        kind: `Intl.${node.expression.name.text}`,
        text: node.getText(source).slice(0, 80)
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
