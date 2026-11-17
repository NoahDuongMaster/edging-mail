// The wording lists of the spam filter: classic spam phrases and account-threat (phishing) phrases, in English, Vietnamese and Chinese. A phrase is matched on
// folded text: lower-case, accents and the Vietnamese đ removed (so "bạn đã trúng thưởng" also matches when it is written without accents, as much Vietnamese spam
// is), blanks collapsed. A phrase that starts or ends with a Latin letter or digit must not touch another one there ("ca do" is not inside "Monica does").
// Keep the lists short and specific: a phrase that appears in ordinary mail costs more than the spam it catches, and test/spam-fixtures.test.ts and the corpus
// evaluation are where that is checked. Word choice, not weights, belongs here; the weights are in rules.ts.

import { squeeze } from './html-text';

/** Folds text for matching: lower-case, no accents, no Vietnamese đ, curly quotes straight, blanks collapsed. */
export function fold(text: string): string {
  return squeeze(text.toLowerCase().replaceAll(/[‘’]/g, "'")).normalize('NFD').replaceAll(/\p{M}/gu, '').replaceAll('đ', 'd').trim();
}

const SPAM_EN = [
  'you have won',
  'you are a winner',
  'claim your prize',
  'claim your reward',
  'wire transfer',
  'crypto giveaway',
  'bitcoin giveaway',
  'double your bitcoin',
  'viagra',
  'cialis',
  'online casino',
  'lottery winner',
  'unclaimed funds',
  'next of kin',
  'make money fast',
  'work from home and earn',
  'without a prescription',
  'lose weight fast',
  'miracle cure',
  'payday loan',
  'urgent business proposal',
  'dear beneficiary',
  'this is not spam',
  'you have been selected to receive',
  'hot singles',
  'penis enlargement',
  'enlarge your penis',
  'work from home',
  'home based business',
  'financial freedom',
  'extra income',
  'bad credit',
  'debt consolidation',
  'lowest rate',
  'mortgage rates',
  'life insurance quotes',
  'weight loss',
  'lose weight',
  'free quote',
  'bulk email',
  '100% guaranteed',
  'dear homeowner',
  'fortune 500 company hiring'
];

const SPAM_VI = [
  'bạn đã trúng thưởng',
  'chúc mừng bạn đã trúng',
  'nhận quà miễn phí',
  'nhận thưởng ngay',
  'cho vay nhanh',
  'vay tiền nhanh',
  'vay không cần thế chấp',
  'đầu tư sinh lời',
  'lợi nhuận khủng',
  'kiếm tiền online',
  'kiếm tiền tại nhà',
  'việc nhẹ lương cao',
  'cá độ',
  'nhà cái uy tín',
  'casino trực tuyến',
  'cờ bạc online',
  'thuốc tăng cường sinh lý',
  'tuyển cộng tác viên',
  'đáo hạn thẻ tín dụng'
];

const SPAM_ZH = [
  '恭喜您中奖',
  '恭喜你中奖',
  '恭喜您获得',
  '恭喜您中獎',
  '博彩',
  '赌场',
  '賭場',
  '在线赌博',
  '網上賭博',
  '六合彩',
  '百家乐',
  '真人娱乐',
  '代开发票',
  '兼职赚钱',
  '轻松赚钱',
  '无抵押贷款',
  '低息贷款',
  '免费领取',
  '点击领取',
  '加微信',
  '伟哥'
];

const PHISHING_EN = [
  'verify your account',
  'confirm your account',
  'validate your account',
  'your account will be suspended',
  'your account has been suspended',
  'your account will be closed',
  'your account has been locked',
  'your account has been limited',
  'confirm your password',
  'verify your password',
  'unusual sign-in',
  'unusual sign in',
  'suspicious sign-in',
  'verify your identity',
  'update your payment information',
  'update your billing information'
];

const PHISHING_VI = [
  'xác minh tài khoản',
  'xác thực tài khoản',
  'xác nhận tài khoản',
  'tài khoản của bạn sẽ bị khóa',
  'tài khoản của bạn đã bị khóa',
  'tài khoản của bạn sẽ bị tạm ngưng',
  'tài khoản của bạn bị hạn chế',
  'xác nhận mật khẩu',
  'đăng nhập bất thường',
  'cập nhật thông tin thanh toán',
  'cập nhật thông tin tài khoản'
];

const PHISHING_ZH = [
  '验证您的账户',
  '验证您的账号',
  '验证你的账户',
  '驗證您的帳戶',
  '您的账户将被',
  '您的帳戶將被',
  '您的账户已被冻结',
  '您的账号已被冻结',
  '账户异常',
  '确认您的密码',
  '异常登录',
  '登录异常',
  '更新您的账户',
  '更新您的付款信息',
  '验证您的身份'
];

/** A phrase, folded once, with whether each end needs a word boundary. */
interface Phrase {
  text: string;
  startsWord: boolean;
  endsWord: boolean;
}

const isWordChar = (char: string): boolean => /^[\da-z]$/.test(char);

const prepare = (phrases: readonly string[]): Phrase[] =>
  phrases.map((phrase) => {
    const text = fold(phrase);
    return { text, startsWord: isWordChar(text.charAt(0)), endsWord: isWordChar(text.at(-1) ?? '') };
  });

export const SPAM_PHRASES: readonly Phrase[] = prepare([...SPAM_EN, ...SPAM_VI, ...SPAM_ZH]);
export const PHISHING_PHRASES: readonly Phrase[] = prepare([...PHISHING_EN, ...PHISHING_VI, ...PHISHING_ZH]);

function occursIn(haystack: string, phrase: Phrase): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(phrase.text, from);
    if (at === -1) {
      return false;
    }
    const before = at === 0 ? '' : haystack.charAt(at - 1);
    const after = haystack.charAt(at + phrase.text.length);
    if (!(phrase.startsWord && isWordChar(before)) && !(phrase.endsWord && isWordChar(after))) {
      return true;
    }
    from = at + 1;
  }
}

/** The phrases of `list` that occur in `haystack` (already folded), each once. */
export const matchedPhrases = (haystack: string, list: readonly Phrase[]): string[] =>
  list.filter((phrase) => occursIn(haystack, phrase)).map((phrase) => phrase.text);
