// CR-1 and PA-5 of crypto-review.md, on the BUILT Worker: bundles the Worker exactly as a deploy would (every dependency inlined) and checks the
// result. The server entry of src/shared/crypto is seal-only, so no module of OURS in the bundle may open an HPKE message, unwrap or
// import a private key, or compute ECDH with a stored key. Run: npm run check:bundle
//
// Two bundles are scanned: the real entry (src/worker/index.ts), and the server entry of the crypto module with EVERYTHING it exports kept
// (the worst case of what the Worker could one day call, and a control that the scan really sees the HPKE seal code).
// The @hpke/core library is bundled whole: its CipherSuite class carries a createRecipientContext method of its own and a bundler cannot
// remove a method from a class. That text is expected inside the library's modules; what must hold is that no module of ours reaches it,
// so the scan covers every module outside node_modules and fails if one of ours names the open path.
import { builtinModules } from 'node:module';
import { build } from 'esbuild';

const FORBIDDEN = [
  [/createRecipientContext/, 'HPKE open (createRecipientContext)'],
  [/\bunwrapKey\b/, 'unwrapKey'],
  [/\.wrapKey\(/, 'wrapKey'],
  [/\.open\(/, 'a .open( call'],
  [/importKey\(\s*["'](?:pkcs8|jwk)["']/, "importKey('pkcs8'|'jwk')"]
];
// Modules of ours that hold the ECDSA signing key of the deployment (Web Push, VAPID: exported and imported as JWK to be sealed in D1).
// It is never a user key, and RR-5 moves its sealing to DATA_KEY. Only the JWK pattern is tolerated there.
const SIGNING_KEY_MODULES = new Set(['src/worker/push.ts']);
const JWK_LABELS = new Set(["importKey('pkcs8'|'jwk')"]);
// PA-5 (crypto-review.md 13.2): an ALLOW-LIST of the crypto.subtle methods each module of ours may call. A new use fails until it is reviewed
// and added here. Decrypt exists only where the server opens what it sealed for itself (data-key.ts, under DATA_KEY); ECDH (deriveBits in
// push.ts) is the Web Push one with a key made for the message; ECDSA sign is the VAPID signature; HMAC is tokens, TOTP and the setup-key check.
// Every other module of ours may not touch crypto.subtle at all.
const SUBTLE_ALLOWED = new Map([
  ['src/shared/crypto/blob.ts', ['encrypt']],
  ['src/shared/crypto/data-key.ts', ['decrypt', 'encrypt', 'importKey', 'sign']],
  ['src/shared/crypto/envelope.ts', ['importKey']],
  ['src/shared/crypto/hkdf.ts', ['deriveBits', 'importKey']],
  ['src/shared/crypto/public-key.ts', ['digest', 'exportKey', 'importKey']],
  ['src/shared/crypto/verifier.ts', ['deriveBits', 'importKey']],
  ['src/worker/auth/setup.ts', ['generateKey', 'sign', 'verify']],
  ['src/worker/auth/tokens.ts', ['importKey', 'sign', 'verify']],
  ['src/worker/auth/totp.ts', ['importKey', 'sign']],
  ['src/worker/push.ts', ['deriveBits', 'encrypt', 'exportKey', 'generateKey', 'importKey', 'sign']]
]);
// importKey and unwrapKey take their format as a literal, so a scan can see what is imported.
const FORMAT_ARGUMENT = /\b(?:importKey|unwrapKey)\(\s*(\S)/g;
// Modules that must NOT be in the Worker bundle at all.
const BROWSER_ONLY = [
  'shared/crypto/client',
  'shared/crypto/open',
  'shared/crypto/hpke-open',
  'shared/crypto/kdf',
  'shared/crypto/keys',
  'shared/crypto/recovery-key'
];

const common = {
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  target: 'es2024',
  conditions: ['workerd', 'worker', 'browser'],
  mainFields: ['module', 'main'],
  // Node built-ins come from the nodejs_compat flag at run time, not from the bundle
  external: ['cloudflare:*', 'node:*', ...builtinModules],
  logLevel: 'silent',
  legalComments: 'none'
};

/** The bundle as text, and its modules by path (esbuild writes "// <path>" before the code of each module). */
async function bundle(options) {
  const { outputFiles } = await build({ ...common, ...options });
  const text = outputFiles[0].text;
  const marks = [...text.matchAll(/^\/\/ (\S+\.(?:[cm]?[jt]sx?))$/gm)];
  const modules = new Map();
  for (const [index, mark] of marks.entries()) {
    const end = marks[index + 1]?.index ?? text.length;
    modules.set(mark[1], (modules.get(mark[1]) ?? '') + text.slice(mark.index, end));
  }
  return { text, modules };
}

const problems = [];

function scan(name, { modules }) {
  for (const [path, code] of modules) {
    if (path.includes('node_modules/')) {
      continue;
    }
    for (const [pattern, label] of FORBIDDEN) {
      if (pattern.test(code) && !(SIGNING_KEY_MODULES.has(path) && JWK_LABELS.has(label))) {
        problems.push(`${name}: ${path}: ${label}`);
      }
    }
    const subtle = [...code.matchAll(/\bsubtle\s*\.\s*(\w+)\s*\(/g)].map((match) => match[1]);
    if ((code.match(/\bsubtle\b/g) ?? []).length !== subtle.length) {
      problems.push(`${name}: ${path}: crypto.subtle is used other than as subtle.<method>( (aliased or passed around)`);
    }
    const allowed = SUBTLE_ALLOWED.get(path) ?? [];
    for (const method of new Set(subtle)) {
      if (!allowed.includes(method)) {
        problems.push(`${name}: ${path}: crypto.subtle.${method} is not on the allow-list (review it, then add it to SUBTLE_ALLOWED)`);
      }
    }
    if ([...code.matchAll(FORMAT_ARGUMENT)].some((match) => !['"', "'", '`'].includes(match[1]))) {
      problems.push(`${name}: ${path}: importKey/unwrapKey is called with a format that is not a literal`);
    }
    if (BROWSER_ONLY.some((part) => path.includes(part))) {
      problems.push(`${name}: ${path}: a browser-only module is in the Worker bundle`);
    }
  }
}

const worker = await bundle({ entryPoints: ['src/worker/index.ts'] });
const everything = await bundle({
  stdin: {
    contents: "export * from './src/shared/crypto/server.ts';",
    resolveDir: process.cwd(),
    loader: 'ts',
    sourcefile: 'server-entry.ts'
  }
});
scan('worker', worker);
scan('server entry', everything);

const sealModule = [...everything.modules].find(([path]) => path.endsWith('shared/crypto/hpke-seal.ts'));
if (sealModule === undefined || !sealModule[1].includes('createSenderContext')) {
  problems.push('control: the HPKE seal module is not in the server-entry bundle, so this check proves nothing');
}
if (!everything.text.includes('createRecipientContext')) {
  problems.push('control: the library no longer carries createRecipientContext, update this script');
}

const describeBundle = (name, { text, modules }) => {
  const mine = [...modules.keys()].filter((path) => !path.includes('node_modules/')).length;
  return `${name}: ${(text.length / 1024).toFixed(0)} KiB, ${modules.size} modules, ${mine} ours`;
};
process.stdout.write(`${describeBundle('Worker bundle', worker)}\n${describeBundle('Server entry (all exports kept)', everything)}\n`);
if (problems.length > 0) {
  process.stderr.write(`${problems.map((problem) => `FAIL ${problem}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    'OK: no module of ours opens HPKE, unwraps or imports a private key, reaches the browser-only crypto files, or uses crypto.subtle beyond its allow-list.\n'
  );
}
