// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLIENT, ROOT, walk } from './helpers/scan';

// Profile pictures, read from the sources: what a render cannot show (a picture that fails to load, the lifecycle of the upload, the privacy
// rule that no picture address is ever made from an email address or fetched from outside, and that the words about where a picture comes
// from stay true) and the size of the new files.

const read = (...parts: string[]): string => readFileSync(path.join(ROOT, 'src', 'client', ...parts), 'utf8');
const withoutComments = (code: string): string => code.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');

const NEW_FILES = [
  ['lib', 'avatar.ts'],
  ['lib', 'avatarImage.ts'],
  ['lib', 'avatarCanvas.ts'],
  ['components', 'settings', 'ProfilePicture.tsx']
];

describe('the picture on a tile (ui/Avatar)', () => {
  const avatar = read('ui', 'Avatar.tsx');
  const code = withoutComments(avatar);

  it('is an img with no text alternative, loaded lazily, not draggable, under the tile that stays aria-hidden', () => {
    expect(code).toMatch(
      /<img\s+className="ui-avatar-img"\s+src=\{picture\}\s+alt=""\s+loading="lazy"\s+decoding="async"\s+draggable=\{false\}/
    );
    expect(code).toMatch(/aria-hidden="true"/);
    expect(code.indexOf('{initials}')).toBeLessThan(code.indexOf('<img'));
  });

  it('falls back to the initials when the picture fails, and never asks again (no timer, no retry, no changing address)', () => {
    expect(code).toMatch(/onError=\{\(\) => setSeen\(\{ src: picture, status: 'failed' \}\)\}/);
    expect(code).toMatch(/onLoad=\{\(\) => setSeen\(\{ src: picture, status: 'loaded' \}\)\}/);
    expect(code).not.toMatch(/setTimeout|setInterval|retry|Date\.now|Math\.random|\?v=|\?t=/);
  });

  it('is drawn by ui.css inside the printed field of a stamp (the same inset as the field itself), clipped by the circle, hairline over it', () => {
    const css = read('ui', 'ui.css');
    const field = /\.ui-avatar\[data-shape='stamp'\]::after \{\s*inset: (calc\([^;]+\));/.exec(css)?.[1] ?? '';
    expect(field).not.toBe('');
    const stamp = /\.ui-avatar\[data-shape='stamp'\] > \.ui-avatar-img \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(stamp).toContain(`--ui-stamp-field: ${field};`);
    expect(css).toMatch(/\.ui-avatar\[data-image\]:not\(\[data-shape='stamp'\]\) \{\s*overflow: hidden;/);
    expect(css).toMatch(/\.ui-avatar-img \{[^}]*object-fit: cover;[^}]*outline: 1px solid var\(--ui-photo-ring\);/);
    // The letters are hidden by their fill, never by `color`: the stamp's perforation mask is painted in currentColor.
    expect(css).toMatch(/\.ui-avatar\[data-image='loaded'\] \{\s*-webkit-text-fill-color: transparent;/);
    expect(css).not.toMatch(/\.ui-avatar\[data-image='loaded'\] \{[^}]*[^-]color: transparent/);
  });
});

describe('the account buttons, the rows and the reader', () => {
  it('show the own picture in the phone bar and the rail through the shared Avatar (their names stay the initials)', () => {
    const app = withoutComments(read('App.tsx'));
    expect(app).toMatch(/<Avatar name=\{name\} size="md" src=\{picture\} \/>/);
    expect(app).not.toMatch(/<span aria-hidden="true" className="ui-avatar" data-size="md" data-script/);
    expect(app).toMatch(/app\.account_named', \{ initials \}/);
    expect(app).toMatch(/ownPicture\(useSession\(\)\.data\?\.user\)/);
  });

  it("take the sender picture from the row's own from_avatar through senderPicture, never from an address", () => {
    expect(withoutComments(read('components', 'MessageList.tsx'))).toMatch(/src=\{senderPicture\(m\)\}/);
    expect(withoutComments(read('components', 'MessageView.tsx'))).toMatch(/src=\{senderPicture\(message\)\}/);
    const lib = withoutComments(read('lib', 'avatar.ts'));
    expect(lib.match(/avatarUrl\(/g)).toHaveLength(2);
    expect(lib).toMatch(
      /const id = idOf\(message\.from_avatar\);\s+return id === undefined \|\| message\.folder === 'sent' \|\| message\.folder === 'drafts'/
    );
  });
});

describe('the picture row of Settings > Profile', () => {
  const source = read('components', 'settings', 'ProfilePicture.tsx');
  const code = withoutComments(source);

  it('uses the ui Button, the ui Avatar at 56 px, and opens a hidden image field (no bare <button>)', () => {
    expect(code).not.toMatch(/<button\b/);
    expect(code).toMatch(/<Avatar name=\{name\} size="xl" selected src=\{picture\}/);
    expect(code).toMatch(/<input ref=\{fileRef\} type="file" accept="image\/\*" hidden onChange=\{choose\} \/>/);
    expect(code).toMatch(/fileRef\.current\?\.click\(\)/);
  });

  it('follows the async-form lifecycle: busy blocks a second action, a late result is dropped, the field is emptied, focus does not fall to the page', () => {
    // Busy: the pressed button shows its spinner, both say aria-disabled (not `disabled`, which would drop focus), and the handlers check it.
    expect(code).toMatch(/loading=\{busy === 'save'\}/);
    expect(code).toMatch(/loading=\{busy === 'remove'\}/);
    expect(code.match(/aria-disabled=\{busy === null \? undefined : true\}/g)).toHaveLength(2);
    expect(code).not.toMatch(/(?<!aria-)\bdisabled=/);
    expect(code).toMatch(/if \(file !== undefined && busy === null\)/);
    // A result after the section was left: nothing is drawn or announced (the session cache still takes the answer, in lib/avatar).
    expect(code).toMatch(/mounted\.current = true;[\s\S]*mounted\.current = false;/);
    expect(code).toMatch(/if \(!mounted\.current\) \{\s*return;\s*\}/);
    // The same file twice: the field's value is reset as soon as the file is taken.
    expect(code).toMatch(/field\.value = '';/);
    // Remove takes its own button away: focus goes to Change picture.
    expect(code).toMatch(/finish\(\{ tone: 'success', text: tr\('settings\.picture_removed'\) \}, true\)/);
    expect(code).toMatch(/changeRef\.current\?\.focus\(\)/);
  });

  it('says its status through lib/announce (failures assertive), offline as "No connection", and a refusal in its own words', () => {
    expect(code).toMatch(/announce\(next\.text, \{ assertive: next\.tone === 'danger' \}\)/);
    expect(code).toMatch(/error instanceof TypeError \? tr\('app\.no_connection'\)/);
    expect(code).toMatch(/error instanceof Error \? error\.message/);
    expect(code).toMatch(/too_large: 'avatar\.too_large'[\s\S]*not_image: 'avatar\.not_image'[\s\S]*cannot_read: 'avatar\.cannot_read'/);
    // A file that cannot be prepared is never mistaken for being offline (prepareAvatar's own failures are never a bare TypeError here).
    expect(code).toMatch(/error instanceof AvatarImageError \? error\.problem : 'cannot_read'/);
    expect(code).not.toMatch(/aria-live|role="status"|role="alert"/);
  });
});

describe('preparing and sending the picture', () => {
  it("asks the browser for the photo's own orientation, draws smoothed at high quality, and never needs a blob: address (the page's img-src names data: but not blob:)", () => {
    const canvas = withoutComments(read('lib', 'avatarCanvas.ts'));
    expect(canvas).toMatch(/createImageBitmap\(file, \{ imageOrientation: 'from-image' \}\)/);
    expect(canvas).toMatch(/imageSmoothingQuality = 'high'/);
    expect(canvas).toMatch(/readAsDataURL/);
    expect(canvas).not.toMatch(/createObjectURL/);
  });

  it('makes no request of its own to anywhere but /api/avatar, and no address outside this server appears in the picture code', () => {
    for (const parts of NEW_FILES) {
      expect(withoutComments(read(...parts)), parts.join('/')).not.toMatch(/https?:\/\/|\/\/[a-z]+\.[a-z]+\//i);
    }
    expect(read('lib', 'avatar.ts')).toMatch(/apiPut<AvatarAnswer>\('\/api\/avatar'/);
    expect(read('lib', 'avatar.ts')).toMatch(/apiDelete<AvatarAnswer>\('\/api\/avatar'/);
    expect(withoutComments(read('lib', 'avatarCanvas.ts'))).not.toMatch(/\bfetch\(/);
  });

  it('keeps every new file within 300 lines', () => {
    for (const parts of NEW_FILES) {
      expect(read(...parts).split('\n').length, parts.join('/')).toBeLessThanOrEqual(300);
    }
  });
});

describe('where a picture comes from (the code and the words about it)', () => {
  it("the browser never asks a third party: no source file of the client names a picture service, only this server's /api/avatars/ is built", () => {
    for (const file of walk(CLIENT, ['.ts', '.tsx'])) {
      expect(withoutComments(readFileSync(file, 'utf8')), file).not.toMatch(/gravatar\.com|libravatar\.org|\bbimi\b|favicon\.ico/i);
    }
    expect(withoutComments(read('lib', 'avatar.ts'))).toMatch(/`\/api\/avatars\/\$\{encodeURIComponent\(id\)\}`/);
  });

  it('the comments say what is true: every picture is served by this server, the Worker may look up outside senders when an admin allowed it, the browser asks no one', () => {
    for (const parts of [['lib', 'avatar.ts'], ['ui', 'Avatar.tsx'], ['ui', 'index.ts'], ['types.ts']]) {
      // The first wording (people of this deployment only, no lookup at all, outside mail never has a picture) is false now.
      expect(read(...parts), parts.join('/')).not.toMatch(
        /only people of this deployment|there is no Gravatar|never gets one|only for mail sent inside/i
      );
    }
    const header = read('lib', 'avatar.ts').slice(0, 1200);
    expect(header).toMatch(/always comes from this server/);
    expect(header).toMatch(/Gravatar and then Libravatar/);
    expect(header).toMatch(/only when an admin turned/);
    expect(header).toMatch(/The browser itself never asks a third party/);
    expect(read('ui', 'Avatar.tsx')).toMatch(/looked up by the server when an admin allowed it/);
    expect(read('ui', 'Avatar.tsx')).toMatch(/the browser never asks a third party/);
  });

  it('the help line of Settings > Profile stays about the own picture, which never leaves this server, and promises nothing about outside senders', () => {
    for (const language of ['en', 'vi', 'zh-CN']) {
      const catalogue = JSON.parse(readFileSync(path.join(ROOT, 'src', 'shared', 'i18n', 'locales', `${language}.json`), 'utf8')) as Record<
        string,
        string
      >;
      expect(catalogue['settings.picture_help'], language).not.toMatch(/gravatar|libravatar/i);
    }
    const english = JSON.parse(readFileSync(path.join(ROOT, 'src', 'shared', 'i18n', 'locales', 'en.json'), 'utf8')) as Record<
      string,
      string
    >;
    expect(english['settings.picture_help']).toBe('People on this server see it on the mail you send them. It never leaves this server.');
  });
});
