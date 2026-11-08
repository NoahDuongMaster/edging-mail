// Sealed send: the browser side of end-to-end mail between people on this deployment (reports/e2e-contract.md). Library only: the screens
// build their dialogs from the plan objects and their texts from the catalogue.
//
//   lookupKeys(addresses)            -> LookupMap                       (lookup.ts: POST /api/keys/lookup)
//   compareWithPins(userId, lookup)  -> Map<address, PinCheck>          (S3: new / same / changed)
//   planSend(headers, lookup, pins)  -> SendPlan                        (route, recipients, e2e, needsConfirm, copies)
//   externalReplyWarning(...)        -> { warn, externalAddresses }     (N6)
//   checkLimits(content, files, n)   -> LimitProblem[]                  (offer the normal send route when not empty)
//   sendInternal(input)              -> sent | key_changed              (seals, posts, pins after success)
//   acceptChanges(plan, addresses)   (the person accepted a new key: plan again, then send)

export { canonicalList, lookupKeys } from './lookup';
export { fingerprintGroups, fingerprintOf } from './fingerprint';
export { acceptChange, compareWithPins, markGone, pin, pinsStorageKey } from './pins';
export type { PinCheck, PinEntry, PinState } from './pins';
export { checkLimits, LIMITS } from './limits';
export type { LimitKind, LimitProblem } from './limits';
export { plainCopy, sealCopy } from './seal';
export { acceptChanges, planSend } from './plan';
export type { PlanCopy, PlanRecipient, PlanState, SendPlan } from './plan';
export { sendInternal } from './send';
export type { Confirmed, SendHeaders, SendInput, SendResult, SentCopy } from './send';
export { externalReplyWarning } from './n6';
export { runSend } from './flow';
export { addressesToAsk, isCompleteAddress, previewAddresses, previewOf } from './preview';
export type { Preview, PreviewReason } from './preview';
export type { Ask, FlowInput, FlowResult, Question } from './flow';
export { SealedMailError, sealedErrorText } from './errors';
export type { SealedReason } from './errors';
export type { Fetcher } from './request';
export type { Copy, KeyAnswer, LookupMap, MailContent, OutgoingAttachment, PlainCopy, Sealed, SealedCopy } from './types';
