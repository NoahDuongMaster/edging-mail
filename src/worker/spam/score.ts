// The sum and the verdict. A mail's score is the sum of the weights of the rules that apply to it (rules.ts, content-rules.ts); it is spam when the score
// reaches THRESHOLD. Pure: no database, no clock. The short-circuits (the person's lists, people they have written to) are decided in filter.ts.

import { analyse, contentHits } from './content-rules';
import type { MailFacts } from './facts';
import { headerAndAttachmentHits, THRESHOLD, WEIGHTS } from './rules';
import type { Hit, RuleId } from './rules';

/** At most this many rule ids are kept as the reasons of a spam mail. */
export const MAX_REASONS = 6;

export interface Scored {
  score: number;
  hits: Hit[];
}

/** Runs every rule on a mail and adds the weights. A rule appears at most once. */
export function scoreMail(facts: MailFacts): Scored {
  const hits = [...headerAndAttachmentHits(facts), ...contentHits(analyse(facts))];
  return { score: hits.reduce((sum, entry) => sum + entry.weight, 0), hits };
}

/** Spam when the score reaches the threshold: 4 is not, 5 is. */
export const reachesThreshold = (score: number): boolean => score >= THRESHOLD;

const ORDER = Object.keys(WEIGHTS) as RuleId[];

/** The ids of the rules that added to the score, the biggest addition first (equal ones in the order of the weights table), at most MAX_REASONS. */
export function reasonsOf(hits: readonly Hit[]): RuleId[] {
  return hits
    .filter((entry) => entry.weight > 0)
    .toSorted((a, b) => b.weight - a.weight || ORDER.indexOf(a.id) - ORDER.indexOf(b.id))
    .slice(0, MAX_REASONS)
    .map((entry) => entry.id);
}
