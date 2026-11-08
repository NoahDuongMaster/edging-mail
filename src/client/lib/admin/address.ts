// Addresses an admin types: the same rules as the server (design.md section 5: local part `a-z 0-9 . _ -`, 1 to 64 characters, no leading,
// trailing or double dot; lower case accepted). The server checks again; this only saves a round trip and says what is wrong.
import { tr } from '../i18n';

const LOCAL_PART = /^[a-z\d._-]+$/;
const HOSTNAME_LABEL = /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/;

/** What is wrong with the part before the @, or null when it is fine. Input is lower-cased and trimmed by the caller. */
export function localPartProblem(localPart: string): string | null {
  if (localPart === '') {
    return tr('users.err_local_empty');
  }
  if (localPart.length > 64) {
    return tr('users.err_local_long');
  }
  if (!LOCAL_PART.test(localPart)) {
    return tr('users.err_local_chars');
  }
  if (localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')) {
    return tr('users.err_local_dots');
  }
  return null;
}

/** What is wrong with a domain name, or null when it is a plain host name (subdomains are fine; no scheme, path, port or wildcard). */
export function domainProblem(name: string): string | null {
  if (name === '') {
    return tr('domains.err_empty');
  }
  if (name.length > 253) {
    return tr('domains.err_too_long');
  }
  const labels = name.split('.');
  if (labels.length < 2) {
    return tr('domains.err_incomplete');
  }
  if (name.includes('/') || name.includes(':') || name.includes('*') || name.includes('@') || name.includes(' ')) {
    return tr('domains.err_not_plain');
  }
  if (!labels.every((label) => HOSTNAME_LABEL.test(label))) {
    return tr('domains.err_label');
  }
  return null;
}
