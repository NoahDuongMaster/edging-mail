// Builds dist/kat/index.html: the known-answer tests of test/crypto/kat.test.ts (KAT-1..5 and the rest of that file) as ONE self-contained page, so a
// browser engine can run exactly the code that runs on the Workers runtime. No server, no network, no account. Run: npm run kat:browser
//
// Then open the page in each engine you want to test (Chrome, Firefox, Safari; also a phone). The title and the text on the page say PASS or FAIL for
// every test, and <body data-result="pass|fail"> carries the verdict for a script. WebCrypto needs a secure context: file:// works in current engines;
// if yours refuses, serve the folder from localhost, for example `python3 -m http.server --bind 127.0.0.1 --directory dist/kat 8000`.
// The PBKDF2 tests do 600,000 iterations several times, so the page takes up to a minute on a slow device.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.resolve(root, 'dist/kat/index.html');

const { outputFiles } = await build({
  stdin: {
    contents: "import './test/crypto/kat.test.ts';\nimport { runAll } from './test/crypto/browser-shim.ts';\nawait runAll();\n",
    resolveDir: root,
    sourcefile: 'kat-entry.ts',
    loader: 'ts'
  },
  alias: { vitest: path.resolve(root, 'test/crypto/browser-shim.ts') },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  write: false,
  logLevel: 'warning'
});

const script = (outputFiles[0]?.text ?? '').replaceAll('</script', String.raw`<\/script`);
const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Running known-answer tests…</title>
  </head>
  <body>
    <h1>Edging Mail: known-answer tests</h1>
    <p>Each line is one test. This can take up to a minute.</p>
    <pre id="out"></pre>
    <script type="module">
${script}
    </script>
  </body>
</html>
`;

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, page);
process.stdout.write(`Wrote ${outFile}\nOpen it in a browser (file:// or served from localhost): the title says PASS or FAIL.\n`);
