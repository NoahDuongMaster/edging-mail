# Password data: sources and licences

Everything here is bundled into the app and loaded on demand, only on a screen where someone sets a password. Nothing is fetched from a network at run time.

## `common-roots.txt` and `common-long.txt` (the common-password blocklist)

- **Source:** the SecLists file `Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt`
  (<https://github.com/danielmiessler/SecLists>), the 1,000,000 most common passwords, most common first.
- **Licence of SecLists:** MIT, Copyright (c) 2018 Daniel Miessler. The licence text is at the end of this file.
- **Origin of the data:** the list is cut from Mark Burnett's 2015 "ten million passwords" data set, which he released to the public domain
  (<https://medium.com/xato-security/today-i-am-releasing-ten-million-passwords-b6278bbe7495>). His request, kept here, is that the data is used
  for research and for making authentication more secure. This app uses it only to refuse weak passwords.
- **How the two files were made** (nothing is changed except as listed):
  1. Take each line of the source. Normalise it: Unicode NFKC, then lower case. Skip lines with whitespace or control characters.
  2. `common-roots.txt`: strip the digits and symbols from both ends of the line. If what is left is 4 to 24 letters `a-z`, it is a root. Keep the first 2000
     distinct roots found in the first 100,000 lines (so the most common first).
  3. `common-long.txt`: lines of 12 to 64 characters whose stripped form is not already a root, in source order, the first 1500 distinct.
     Entries this long are rare in the source, so they are matched whole.
- **What they are for:** `blocklist.ts` refuses a password that is one of these long entries, or that is a root with digits and symbols added at
  the ends (`Password123456!`), also after the usual look-alike swaps (`p@ssw0rd`), or one root repeated. The lists contain rude words because people
  choose them.

## `wordlist.txt` (the passphrase word list)

- **Source:** the English word list of BIP-39, `bip-0039/english.txt` in <https://github.com/bitcoin/bips>: 2048 words, each distinct by its first four
  letters, none longer than eight letters. Byte for byte as published.
- **Licence:** the BIP states "This BIP falls under the MIT License". Authors: Marek Palatinus, Pavol Rusnak, Aaron Voisine, Sean Bowe.
- **Use:** the generated passphrase for admins (six words picked with an unbiased random number, about 66 bits), and a dictionary for the strength
  estimate.

## MIT licence of SecLists

```text
MIT License

Copyright (c) 2018 Daniel Miessler

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
