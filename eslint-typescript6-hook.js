import { registerHooks } from 'node:module';

// TypeScript 7 (the project's compiler, run by `tsc`) ships no JavaScript compiler API, and typescript-eslint
// needs one for type information. Microsoft's documented workaround is to run the TS 6 API side by side:
// https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0
// `@typescript/typescript6` is a lint-only devDependency (it installs a `tsc6` bin, never `tsc`), and this hook
// points only typescript-eslint's own `import 'typescript'` / `'typescript/lib/*'` at it. The project's `typescript`
// stays on 7.x. Import this file before anything that loads typescript-eslint.
// Remove it once typescript-eslint supports TS >= 7.1.
const typescriptEslintPackages = /[\\/]node_modules[\\/](?:@typescript-eslint[\\/]|typescript-eslint[\\/]|ts-api-utils[\\/])/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const isTypescript = specifier === 'typescript' || specifier.startsWith('typescript/');
    if (isTypescript && context.parentURL !== undefined && typescriptEslintPackages.test(context.parentURL)) {
      return nextResolve(specifier.replace(/^typescript/, '@typescript/typescript6'), context);
    }
    return nextResolve(specifier, context);
  }
});
