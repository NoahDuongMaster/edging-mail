// Address rules shared by Setup, the admin API and inbound routing. Everything is stored lower-case.

const MAX_LOCAL_PART = 64;
const MAX_HOSTNAME = 253;
const MAX_LABEL = 63;

// a-z 0-9 . _ - ; 1-64 characters; no leading, trailing or doubled dot.
const LOCAL_PART = /^[\da-z_-]+(?:\.[\da-z_-]+)*$/;
const HOST_LABEL = /^[\da-z](?:[\da-z-]*[\da-z])?$/;

export const isLocalPart = (value: string): boolean => value.length > 0 && value.length <= MAX_LOCAL_PART && LOCAL_PART.test(value);

/** A DNS host name with at least two labels, lower-case: no scheme, path, port, wildcard or trailing dot. Subdomains are fine. */
export function isHostname(value: string): boolean {
  if (value.length === 0 || value.length > MAX_HOSTNAME) {
    return false;
  }
  const labels = value.split('.');
  // The last label (the TLD) is never all digits, which also refuses IPv4 addresses.
  return (
    labels.length >= 2 && labels.every((label) => label.length <= MAX_LABEL && HOST_LABEL.test(label)) && !/^\d+$/.test(labels.at(-1) ?? '')
  );
}

export interface ParsedAddress {
  local: string;
  domain: string;
  address: string;
}

/** Splits and validates "local@domain" (trimmed, lower-cased). null when it is not an address this product can host. */
export function parseAddress(input: unknown): ParsedAddress | null {
  if (typeof input !== 'string') {
    return null;
  }
  const address = input.trim().toLowerCase();
  const at = address.lastIndexOf('@');
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  if (at < 1 || !isLocalPart(local) || !isHostname(domain)) {
    return null;
  }
  return { local, domain, address };
}

/**
 * The address inbound mail is routed by: the envelope recipient, trimmed and lower-cased, with a "+tag" removed from the local part
 * only ("User+tag@Domain.com" -> "user@domain.com"). Anything that is not shaped like an address gives null.
 */
export function routingAddress(envelopeTo: string): string | null {
  const address = envelopeTo.trim().toLowerCase();
  const at = address.lastIndexOf('@');
  if (at < 1 || at === address.length - 1) {
    return null;
  }
  const local = address.slice(0, at);
  const plus = local.indexOf('+');
  const base = plus === -1 ? local : local.slice(0, plus);
  return base === '' ? null : `${base}@${address.slice(at + 1)}`;
}

export const domainOf = (address: string): string => address.slice(address.lastIndexOf('@') + 1);
