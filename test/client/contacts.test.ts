import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  contactsOf,
  foldText,
  knownContacts,
  matchRange,
  parseMailbox,
  suggestContacts,
  type Contact
} from '../../src/client/lib/contacts';
import { queryKeys } from '../../src/client/lib/queries';
import type { Message } from '../../src/client/types';

// J6-44: the compose suggests recipients from the mail this browser already holds in memory (lib/contacts.ts): the senders of the mail it
// received and the recipients of the mail it sent, newest first, each once, never the account itself, never Spam. Nothing is stored or sent.

let counter = 0;
const mail = (fields: Partial<Message>): Message => {
  counter += 1;
  return {
    id: `m${counter}`,
    from_address: 'someone@example.com',
    to_address: 'alex.morgan@example.com',
    subject: '',
    folder: 'inbox',
    is_read: 1,
    is_starred: 0,
    has_attachments: 0,
    size: 1,
    created_at: counter,
    updated_at: counter,
    ...fields
  };
};

const ME = 'Alex.Morgan@example.com';

describe('the people of the mail in this browser', () => {
  it('reads a name and an address from a header entry, quoted or not, and refuses what is not an address', () => {
    expect(parseMailbox('"Chen, Maya" <Maya.Chen@Example.com>')).toEqual({ name: 'Chen, Maya', address: 'maya.chen@example.com' });
    expect(parseMailbox('Jonas Weber <jonas@example.org>')).toEqual({ name: 'Jonas Weber', address: 'jonas@example.org' });
    expect(parseMailbox('priya@example.com')).toEqual({ name: '', address: 'priya@example.com' });
    expect(parseMailbox('priya@example.com <priya@example.com>')).toEqual({ name: '', address: 'priya@example.com' });
    expect(parseMailbox('undisclosed-recipients:;')).toBeNull();
  });

  it('takes the senders of received mail and the recipients (to, cc, bcc) of sent mail, newest first, each once, without the account', () => {
    const people = contactsOf(
      [
        mail({ from_address: 'maya.chen@example.com', from_name: 'Maya Chen', created_at: 10 }),
        mail({ folder: 'sent', from_address: ME, to_address: 'Jonas Weber <jonas@example.org>, alex.morgan@example.com', created_at: 30 }),
        mail({
          folder: 'sent',
          from_address: ME,
          to_address: 'maya.chen@example.com',
          cc: 'priya@example.com',
          bcc: 'Leo <leo@example.net>',
          created_at: 20
        }),
        mail({ from_address: 'MAYA.CHEN@example.com', from_name: '', created_at: 5 })
      ],
      ME
    );
    expect(people.map((person) => person.address)).toEqual([
      'jonas@example.org',
      'leo@example.net',
      'maya.chen@example.com',
      'priya@example.com'
    ]);
    expect(people.find((person) => person.address === 'maya.chen@example.com')).toEqual({
      address: 'maya.chen@example.com',
      name: 'Maya Chen',
      seen: 20
    });
    expect(people.find((person) => person.address === 'jonas@example.org')?.name).toBe('Jonas Weber');
  });

  it('keeps the newest name of a person, and a name over no name', () => {
    const people = contactsOf([
      mail({ from_address: 'sam@example.com', from_name: 'Sam', created_at: 1 }),
      mail({ from_address: 'sam@example.com', from_name: 'Sam Rivera', created_at: 2 }),
      mail({ from_address: 'sam@example.com', from_name: '', created_at: 3 })
    ]);
    expect(people).toEqual([{ address: 'sam@example.com', name: 'Sam Rivera', seen: 3 }]);
  });

  it('suggests nobody from Spam or Drafts', () => {
    const people = contactsOf([
      mail({ folder: 'spam', from_address: 'prize@example.biz', from_name: 'Prize desk' }),
      mail({ folder: 'drafts', from_address: ME, to_address: 'half@example.com' })
    ]);
    expect(people).toEqual([]);
  });

  it('reads the loaded list pages and the opened messages of the query cache (memory only)', () => {
    const client = new QueryClient();
    client.setQueryData([...queryKeys.messages, 'inbox'], {
      pages: [{ messages: [mail({ from_address: 'ana@example.com', from_name: 'Ana', created_at: 100 })], hasMore: false }],
      pageParams: [0]
    });
    client.setQueryData([...queryKeys.messageDetails, 'x'], {
      message: mail({ folder: 'sent', from_address: ME, to_address: 'bo@example.com', created_at: 200 }),
      attachments: []
    });
    expect(knownContacts(client, ME).map((person) => person.address)).toEqual(['bo@example.com', 'ana@example.com']);
  });
});

describe('the suggestions under a recipient field', () => {
  const book: Contact[] = [
    { address: 'nguyen.minh.anh@example.com', name: 'Nguyễn Minh Anh', seen: 9 },
    { address: 'maya.chen@example.com', name: 'Maya Chen', seen: 8 },
    { address: 'jonas.weber@example.org', name: 'Jonas Weber', seen: 7 },
    { address: 'mark@example.com', name: '', seen: 6 },
    { address: 'm1@example.com', name: '', seen: 5 },
    { address: 'm2@example.com', name: '', seen: 4 },
    { address: 'm3@example.com', name: '', seen: 3 },
    { address: 'm4@example.com', name: '', seen: 2 },
    { address: 'm5@example.com', name: '', seen: 1 }
  ];

  it('matches the start of the name, of a word of it, of the address or of a part of the address, newest first', () => {
    expect(suggestContacts(book, 'chen').map((c) => c.address)).toEqual(['maya.chen@example.com']);
    expect(suggestContacts(book, 'Maya C').map((c) => c.address)).toEqual(['maya.chen@example.com']);
    expect(suggestContacts(book, 'web').map((c) => c.address)).toEqual(['jonas.weber@example.org']);
    expect(suggestContacts(book, 'example.org').map((c) => c.address)).toEqual(['jonas.weber@example.org']);
    // Inside a word is not a start: "aya" finds nobody.
    expect(suggestContacts(book, 'aya')).toEqual([]);
  });

  it('ignores case and the marks of letters (Vietnamese names are found without their tones)', () => {
    expect(foldText('Nguyễn Đức')).toBe('nguyen duc');
    expect(suggestContacts(book, 'nguyen').map((c) => c.address)).toEqual(['nguyen.minh.anh@example.com']);
    expect(suggestContacts(book, 'ANH').map((c) => c.address)).toEqual(['nguyen.minh.anh@example.com']);
  });

  it('lists the matches on a person before the matches on their domain alone', () => {
    const shared: Contact[] = [
      { address: 'ana@example.com', name: 'Ana', seen: 3 },
      { address: 'eli@example.com', name: 'Eli', seen: 2 },
      { address: 'notices@library.example.org', name: 'City Library', seen: 1 }
    ];
    expect(suggestContacts(shared, 'e').map((c) => c.address)).toEqual([
      'eli@example.com',
      'ana@example.com',
      'notices@library.example.org'
    ]);
    expect(suggestContacts(shared, 'lib').map((c) => c.address)).toEqual(['notices@library.example.org']);
  });

  it('shows at most 6, newest first, and none of the addresses already in the message', () => {
    const found = suggestContacts(book, 'm');
    expect(found).toHaveLength(6);
    expect(found.map((c) => c.seen)).toEqual([9, 8, 6, 5, 4, 3]);
    const taken = new Set(['maya.chen@example.com', 'mark@example.com']);
    expect(suggestContacts(book, 'ma', taken).map((c) => c.address)).toEqual([]);
    expect(suggestContacts(book, 'm', taken, 3).map((c) => c.address)).toEqual([
      'nguyen.minh.anh@example.com',
      'm1@example.com',
      'm2@example.com'
    ]);
  });

  it('marks the part of a name or an address that matched, at the start of a word, in the original letters', () => {
    expect(matchRange('Maya Chen', 'ch')).toEqual([5, 7]);
    expect(matchRange('Maya Chen', 'maya c')).toEqual([0, 6]);
    expect(matchRange('jonas.weber@example.org', 'example.o')).toEqual([12, 21]);
    expect(matchRange('Nguyễn Minh Anh', 'nguye')).toEqual([0, 5]);
    expect(matchRange('Maya Chen', 'aya')).toBeNull();
    expect(matchRange('Maya Chen', '')).toBeNull();
  });

  it('suggests nothing for an empty field or a list being typed', () => {
    expect(suggestContacts(book, '')).toEqual([]);
    expect(suggestContacts(book, ' '.repeat(3))).toEqual([]);
    expect(suggestContacts(book, 'maya, jo')).toEqual([]);
  });
});
