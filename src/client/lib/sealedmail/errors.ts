import { ApiError, UnauthorizedError } from '../api';
import { tr } from '../i18n';
import type { LimitProblem } from './limits';

/** Why sealed send refused to go on. Every one is a case the UI is meant to prevent (or to ask about) before it calls; none carries content. */
export type SealedReason = 'locked' | 'too_many_addresses' | 'bad_answer' | 'confirm_needed' | 'not_internal' | 'plan_mismatch' | 'too_big';

interface Detail {
  /** `confirm_needed`: the addresses nobody confirmed yet. */
  addresses?: readonly string[];
  /** `too_big`: what is over a cap. */
  problems?: readonly LimitProblem[];
}

export class SealedMailError extends Error {
  readonly reason: SealedReason;
  readonly addresses: readonly string[];
  readonly problems: readonly LimitProblem[];

  constructor(reason: SealedReason, detail: Detail = {}) {
    // Fixed developer text: it never quotes an address, a subject or anything else that was passed in.
    super(`sealed mail: ${reason}`);
    this.name = 'SealedMailError';
    this.reason = reason;
    this.addresses = detail.addresses ?? [];
    this.problems = detail.problems ?? [];
  }
}

/** What to tell the person when a lookup or a sealed send failed, in the UI language (never an exception message). */
export function sealedErrorText(error: unknown): string {
  if (error instanceof ApiError || error instanceof UnauthorizedError) {
    return error.message;
  }
  if (error instanceof TypeError) {
    return tr('err.network');
  }
  if (error instanceof SealedMailError) {
    switch (error.reason) {
      case 'locked': {
        return tr('fail.sealed_locked');
      }
      case 'too_big': {
        return tr('fail.sealed_too_big');
      }
      case 'too_many_addresses': {
        return tr('err.too_many_recipients');
      }
      case 'bad_answer': {
        return tr('fail.sealed_lookup');
      }
      case 'confirm_needed':
      case 'not_internal':
      case 'plan_mismatch': {
        // The screen should have stopped these before calling: all it can say is that nothing was sent.
        return tr('fail.sealed_send');
      }
    }
  }
  return tr('fail.sealed_send');
}
