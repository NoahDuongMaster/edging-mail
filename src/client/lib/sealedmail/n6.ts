import type { SendPlan } from './plan';

/**
 * N6: replying to or forwarding a message that arrived end-to-end encrypted (`is_e2e === 1`) to an address outside this deployment sends the
 * content of that message in the clear. The person is told first. `externalAddresses` are the recipients that will get it in the clear.
 */
export function externalReplyWarning(input: { messageIsE2E: boolean; plan: Pick<SendPlan, 'recipients'> }): {
  warn: boolean;
  externalAddresses: string[];
} {
  const externalAddresses = input.plan.recipients
    .filter((recipient) => recipient.state === 'external')
    .map((recipient) => recipient.address);
  return { warn: input.messageIsE2E && externalAddresses.length > 0, externalAddresses };
}
