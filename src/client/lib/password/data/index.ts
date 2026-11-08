// Loaded only through the dynamic import in blocklist.ts, so Vite puts these three files in a chunk of their own.
import long from './common-long.txt?raw';
import roots from './common-roots.txt?raw';
import words from './wordlist.txt?raw';

export const rawData = { long, roots, words };
