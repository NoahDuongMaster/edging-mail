import { describe, expect, it } from 'vitest';
import { LABEL } from '../../src/shared/crypto/constants';

// Static rules over the source tree (crypto-review.md CR-1, CR-2, CR-5, KAT-8): they read the files as text, so a violation fails the
// suite whoever adds it and wherever. The Worker bundle itself is checked by scripts/check-worker-bundle.mjs.

const load = (files: Record<string, unknown>): Map<string, string> =>
  new Map(Object.entries(files).map(([path, source]) => [path.replace(/^(?:\.\.\/)+/, ''), source as string]));

const crypto = load(import.meta.glob('../../src/shared/crypto/*.ts', { query: '?raw', import: 'default', eager: true }));
const sources = load(import.meta.glob(['../../src/**/*.ts', '../../src/**/*.tsx'], { query: '?raw', import: 'default', eager: true }));

/** The source without comments, so a rule matches code and not the sentence that explains why the code is absent. */
const code = (source: string): string => source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');

const importsOf = (source: string): string[] =>
  [...code(source).matchAll(/(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);

/** The files reachable from an entry through relative imports, as names inside src/shared/crypto. */
function closure(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    const source = crypto.get(`src/shared/crypto/${name}.ts`);
    if (source === undefined) {
      throw new Error(`${name} is imported but is not in src/shared/crypto`);
    }
    for (const specifier of importsOf(source)) {
      if (specifier.startsWith('./')) {
        queue.push(specifier.slice(2));
      }
    }
  }
  return seen;
}

describe('labels (CR-5)', () => {
  it('are distinct, and each is used by exactly one expression outside constants.ts', () => {
    const values = Object.values(LABEL);
    expect(new Set(values).size).toBe(values.length);
    for (const name of Object.keys(LABEL)) {
      // Counted over the whole source tree: the token labels are used by the Worker's token module, the rest inside src/shared/crypto.
      const uses = [...sources]
        .filter(([file]) => !file.endsWith('constants.ts'))
        .flatMap(([, source]) => code(source).match(new RegExp(String.raw`LABEL\.${name}\b`, 'g')) ?? []);
      expect(uses, `LABEL.${name}`).toHaveLength(1);
    }
  });

  it('are prefix-free: no label is the start of another (blobKey is concatenated with a closed list of purposes)', () => {
    const entries = Object.entries(LABEL).filter(([name]) => name !== 'blobKey');
    for (const [name, value] of entries) {
      for (const [otherName, other] of entries) {
        if (name !== otherName) {
          expect(other.startsWith(value), `${name} is a prefix of ${otherName}`).toBe(false);
        }
      }
      expect(value.startsWith(LABEL.blobKey), `${name} starts with the blobKey prefix`).toBe(false);
    }
  });

  it('appear as string literals nowhere but constants.ts', () => {
    const literal = /['"`]edging-mail\/v\d/;
    for (const [file, source] of sources) {
      if (!file.endsWith('src/shared/crypto/constants.ts')) {
        expect(code(source), file).not.toMatch(literal);
      }
    }
  });
});

describe('the server entry is seal-only (CR-1)', () => {
  const FORBIDDEN_IN_SERVER =
    /createRecipientContext|unwrapKey|wrapKey\(|\.decrypt\(|\.open\(|['"]pkcs8['"]|['"]jwk['"]|['"]ECDH['"][^)]*deriveBits|deriveBits[^)]*['"]ECDH['"]/;

  it('reaches exactly these files, and not the open, KDF, key-wrap or recovery-key modules', () => {
    expect([...closure('server')].toSorted()).toEqual(
      ['blob', 'bytes', 'constants', 'data-key', 'envelope', 'hkdf', 'hpke-seal', 'public-key', 'server', 'verifier'].toSorted()
    );
  });

  // DATA_KEY is the server's OWN secret: data-key.ts opens values the server sealed for itself (pending content keys, TOTP secrets). That is the
  // one place the server entry decrypts; it still never opens HPKE, unwraps or imports a private key, or does ECDH.
  const DECRYPTS_ITS_OWN_DATA = 'data-key';

  it('has no call that opens, unwraps or imports a private key anywhere in its import closure', () => {
    for (const name of closure('server')) {
      const rule =
        name === DECRYPTS_ITS_OWN_DATA ? new RegExp(FORBIDDEN_IN_SERVER.source.replace(String.raw`\.decrypt\(|`, '')) : FORBIDDEN_IN_SERVER;
      expect(code(crypto.get(`src/shared/crypto/${name}.ts`) ?? ''), name).not.toMatch(rule);
    }
  });

  it('is the only part of the module the Worker imports', () => {
    const workerFiles = [...sources].filter(([file]) => file.startsWith('src/worker/'));
    expect(workerFiles.length).toBeGreaterThan(20);
    let imports = 0;
    for (const [file, source] of workerFiles) {
      for (const specifier of importsOf(source).filter((path) => path.includes('shared/crypto'))) {
        imports += 1;
        expect(specifier, file).toMatch(/\/shared\/crypto\/server$/);
      }
    }
    expect(imports).toBeGreaterThan(0);
  });
});

// push.ts holds the VAPID signing key (an ECDSA key of the deployment, not a user key: it is exported and imported as JWK to be sealed
// in D1) and reads `url.password` to refuse push endpoints that carry credentials. RR-5 moves the sealing to DATA_KEY.
const tolerated = (file: string, line: string): boolean =>
  file === 'src/worker/push.ts' && (line.includes("'jwk'") || line.includes('url.password'));

describe('source rules over src/ (KAT-8, CR-2)', () => {
  // The one existing use is reconnect jitter in the client's WebSocket code (not secret-dependent); its owner replaces it with
  // crypto.getRandomValues and this entry goes away.
  const MATH_RANDOM_TOLERATED = new Set(['src/client/lib/realtime.ts']);

  it('never uses Math.random', () => {
    for (const [file, source] of sources) {
      if (!MATH_RANDOM_TOLERATED.has(file)) {
        expect(code(source), file).not.toMatch(/Math\.random/);
      }
    }
  });

  it('keeps the tolerated Math.random list honest (an entry that no longer uses it must be removed)', () => {
    for (const file of MATH_RANDOM_TOLERATED) {
      expect(code(sources.get(file) ?? ''), file).toMatch(/Math\.random/);
    }
  });

  it('has no request or response field named like a password or private key outside a wrapped_ prefix (Worker)', () => {
    const word = String.raw`(?:password|temp_password|recovery_key|pkcs8|jwk|private_key(?!_sealed)\w*|org_private\w*|secret_key)`;
    // (`private_key_sealed`, the VAPID key sealed under a server secret, is the one accepted name)
    // a property being declared or read (`password:`, `body.password`) or a quoted key name; not a sentence that mentions the word
    const named = new RegExp(String.raw`(?:^|[\s{,(])${word}\??\s*:|\.${word}\b|['"]${word}['"]`);
    for (const [file, source] of sources) {
      if (file.startsWith('src/worker/')) {
        const hits = code(source)
          .split('\n')
          .filter((line) => named.test(line) && !tolerated(file, line));
        expect(hits, file).toEqual([]);
      }
    }
  });
});
