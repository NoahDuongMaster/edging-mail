import type { TFunction } from '../../lib/i18n';
import type { Question } from '../../lib/sealedmail';
import type { ConfirmSpec } from './useConfirm';

/** The words of each question of a send (lib/sealedmail/flow.ts decides what is asked; the catalogue says it). One address or fingerprint per line. */
export function specOf(question: Question, tr: TFunction): ConfirmSpec {
  switch (question.kind) {
    case 'no_keys': {
      const body = tr('send.no_keys_body', { addresses: question.addresses.join('\n') });
      return {
        title: tr('send.no_keys_title'),
        body: question.inline ? `${body}\n\n${tr('send.no_keys_inline')}` : body,
        confirmLabel: tr('send.send_anyway')
      };
    }
    case 'was_keyed': {
      return {
        title: tr('send.was_keyed_title'),
        body: tr('send.was_keyed_body', { addresses: question.addresses.join('\n') }),
        confirmLabel: tr('send.send_anyway')
      };
    }
    case 'changed': {
      const lines = question.recipients.map((recipient) =>
        tr('send.changed_line', {
          address: recipient.address,
          before: recipient.previousFingerprint ?? '',
          now: recipient.fingerprint ?? ''
        })
      );
      return {
        title: tr('send.changed_title'),
        body: `${tr('send.changed_body')}\n\n${lines.join('\n\n')}`,
        confirmLabel: tr('send.changed_confirm')
      };
    }
    case 'external': {
      return {
        title: tr('send.external_title'),
        body: tr('send.external_body', { addresses: question.addresses.join('\n') }),
        confirmLabel: tr('send.send_anyway')
      };
    }
    case 'too_big': {
      return { title: tr('send.too_big_title'), body: tr('send.too_big_body'), confirmLabel: tr('send.too_big_confirm') };
    }
  }
}
