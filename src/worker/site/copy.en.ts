import type { LandingCopy } from './copy.types';

/**
 * English landing page, served at `/en/`. The text is the final approved copy from Marketing (copy-final.md v6, spec addenda 2,
 * 4.2 to 4.7), word for word. Not from that copy: `chrome.skipLink`, `chrome.licenseLink` and `chrome.languageLabel` (the small words around the
 * page) and `hero.screenshotAlt` (the text alternative of the product screenshot). `og.imageAlt` is the former mascot alt text.
 */
export const copyEn: LandingCopy = {
  lang: 'en',
  path: '/en/',
  meta: {
    title: 'Edging Mail: open-source company email on your domain',
    description:
      "Self-hosted company email in your own Cloudflare account, with mail content encrypted by each person's own key and two-factor sign-in. Open source."
  },
  og: {
    title: 'Edging Mail: company email in your own Cloudflare account',
    description:
      "One mailbox per person on your company's domain. Subjects, content and attachments are encrypted with each person's own key before they are stored. Open source.",
    imageAlt: 'Edgar the courier pigeon, the Edging Mail mascot'
  },
  chrome: { skipLink: 'Skip to main content', githubLink: 'GitHub', licenseLink: 'MIT license', languageLabel: 'Language' },
  cta: { signIn: 'Sign in', deploy: 'Deploy for your company' },
  hero: {
    h1: 'Company email on your own domain',
    subline:
      "Edging Mail runs in your company's own Cloudflare account. Each person gets their own mailbox, with mail content encrypted by their own key.",
    screenshotAlt: 'The Edging Mail mailbox with the folder list, the message list and an open message'
  },
  benefits: {
    h2: 'Your company keeps its own email',
    cards: [
      {
        title: 'The addresses belong to the company',
        text: "Every address is on the company's domain, and mail and attachments are stored in the company's Cloudflare account. When someone leaves, an admin disables or deletes their account."
      },
      {
        title: 'No mail server to look after',
        text: "Edging Mail runs entirely on Cloudflare's services. There is no mail server to set up, and no container or queue for your team to run."
      },
      {
        title: 'Open source, with the limits in writing',
        text: "The code is public under the MIT license, so your IT people can read it before they deploy. What Edging Mail can't do yet, such as Outlook access or spam filtering, is listed in the questions below."
      }
    ]
  },
  features: {
    h2: "What's included",
    cards: [
      {
        title: 'The folders you expect',
        text: 'Inbox, Sent, Drafts, Snoozed, Starred, Archive, Spam and Trash, plus your own labels. Drafts save themselves while you type.'
      },
      {
        title: 'Write, reply, find',
        text: "Reply, reply all and forward, and send and receive attachments. Search finds mail by sender or recipient; subjects are searched only among the mail already loaded in your browser, and the message text can't be searched because it is encrypted."
      },
      {
        title: 'New mail shows up on its own',
        text: 'The list updates without a page reload, and phones and computers get a notification when mail arrives.'
      },
      {
        title: 'An app on the phone',
        text: 'Staff install Edging Mail from the browser onto their home screen (PWA) without going through an app store. On iPhone and iPad, notifications only work once it is installed this way.'
      },
      {
        title: "Mail encrypted with each person's key",
        text: 'Every staff member has their own key, unlocked by their own password. Subjects, content and attachments are encrypted before they are stored.'
      },
      {
        title: 'Staff accounts under control',
        text: 'Create, disable or delete accounts, add alias addresses, and reset two-factor sign-in when someone loses their phone. Every change an admin makes to accounts is recorded in an audit log.'
      }
    ]
  },
  how: {
    h2: 'How it works',
    lead: "Once your IT person has deployed Edging Mail to the company's Cloudflare account with the guide on GitHub:",
    steps: [
      {
        title: 'Step 1. Add your domain',
        text: 'An admin adds one or more domains, such as yourcompany.com. The admin pages check DNS and walk you through the setup.'
      },
      {
        title: 'Step 2. Create staff mailboxes',
        text: 'One address per person, such as staff1@yourcompany.com, with a temporary password for the first sign-in, after which they choose their own.'
      },
      {
        title: 'Step 3. Staff sign in',
        text: 'Staff sign in with that address and password in the browser or in the app on their phone. At first sign-in, each person gets a recovery key to keep somewhere safe.'
      }
    ]
  },
  security: {
    h2: 'Who can see what',
    groups: [
      {
        title: 'Encryption',
        items: [
          "Each person's key is unlocked by their password in their own browser. The password never leaves the browser.",
          "Subjects, content and attachments are encrypted before they are stored. The server, or anyone who gets a copy of the stored data, cannot read these stored copies without the owner's password or recovery key (exceptions below).",
          'A weak password can be guessed offline by someone holding a copy of the data. The app requires at least 12 characters (16 for admins) and rejects common passwords.',
          'Mail that arrives before its owner first signs in is protected only by a server key until they do.',
          "Mail whose recipients are all colleagues who have already signed in once is encrypted in the sender's browser (the app shows a badge). Mail with any outside recipient, or with a colleague among its recipients who has not signed in yet, is normal email and is encrypted only when stored.",
          'Not encrypted: who sent to whom, dates, sizes of mail and attachments, number of attachments, which message answers which, whether a message is read, starred or snoozed, folders and labels.'
        ]
      },
      {
        title: 'Admins and passwords',
        items: [
          "No admin can reset another person's password, and there is no way in Edging Mail for an admin to open the mail of someone who has already signed in and set up their keys.",
          'An admin who creates an account knows its temporary password until the person first signs in, and mail that arrives before then is protected only by a server key. So create an account only when the person is ready to sign in.',
          'Someone who forgets their password sets a new one with their own recovery key (plus a code from their authenticator app if they use two-factor sign-in) and keeps all their mail. The key is shown only once each time it is created, so keep it somewhere safe.',
          'If someone loses both the password and the recovery key, nobody can open their old mail again. An admin can only delete that account and create a new mailbox.',
          "Admins can still disable or delete accounts, re-create an address, add alias addresses and reset a person's two-factor sign-in, so mail sent afterwards can reach someone else. Every such change is logged, and the person is notified when their two-factor sign-in is reset."
        ]
      },
      {
        title: 'Sign-in and reading',
        items: [
          'Two-factor sign-in with an authenticator app (TOTP), required for everyone by default.',
          'After repeated wrong passwords, sign-in locks for a while. Signing out, changing your password or resetting it with your recovery key ends your earlier sessions.',
          "Each person can see their own recent sign-ins, and security events go to the admin's audit log.",
          'HTML mail opens in an isolated frame (sandbox), and remote images stay blocked until the reader allows them.'
        ]
      }
    ],
    closing:
      "Encryption protects stored mail. It does not protect against someone deliberately changing the software: whoever controls the company's Cloudflare account or the deployed code could do that, so keep that access to people you trust."
  },
  faq: {
    h2: 'Questions',
    lead: "What to know before you deploy, including what Edging Mail doesn't do yet.",
    items: [
      {
        question: 'Can we use Outlook, Apple Mail or the Gmail app?',
        answer:
          "Not yet. Edging Mail has no IMAP, POP or SMTP access, so those apps can't connect to it. For now, staff use it in the browser or as an app installed from the browser."
      },
      {
        question: 'Does it filter spam and viruses?',
        answer:
          'No. All incoming mail lands in the Inbox; Spam is a folder people move mail into themselves. Nothing is scanned for viruses, so treat attachments like any other download.'
      },
      {
        question: 'Is there two-factor sign-in?',
        answer: 'Yes, with an authenticator app (TOTP) and single-use recovery codes. By default everyone must use it; admins always must.'
      },
      {
        question: 'What does our domain need?',
        answer:
          "The domain's DNS has to be on Cloudflare, with its MX records pointing to Cloudflare, because incoming mail arrives through Cloudflare Email Routing. If the domain receives mail at another provider today, moving the MX records means that provider stops receiving mail for it."
      },
      {
        question: 'What does it cost?',
        answer:
          "The Edging Mail software is free. The costs are your company's Cloudflare plan: Edging Mail needs the Workers Paid plan, because checking a password at sign-in needs more processing time than the free plan allows, and because Cloudflare Email Sending (in beta) needs it to send to any recipient. Receiving through Cloudflare Email Routing is free. Cloudflare's pricing pages have the current prices."
      },
      {
        question: 'Is mail end-to-end encrypted?',
        answer:
          "Only mail whose recipients are all colleagues on the same Edging Mail who have already signed in once: it is encrypted in the sender's browser with the recipients' keys and is never sent as normal email. Those keys come from this same server, and so does the app's code, so this protection relies on the server not being tampered with. It protects who can read a message; it does not prove who sent it. Mail to or from outside the company is normal email: it travels between mail servers as plain email, and Edging Mail sees it when it arrives or leaves, then stores it encrypted."
      },
      {
        question: 'What if someone forgets their password?',
        answer:
          "They set a new password with their current recovery key (plus a code from their authenticator app if they use two-factor sign-in) and keep all their mail; afterwards they get a new recovery key. Admins cannot reset anyone's password. If both the password and the recovery key are lost, nobody can open the old mail again; an admin can only delete the account and create a new mailbox."
      }
    ]
  },
  closing: {
    h2: "Start with your company's domain",
    text: 'The deployment guide and all the code are on GitHub. If you already have an account, sign in here.'
  },
  footer: { text: 'Edging Mail is open source under the MIT license. Its mascot, Edgar, is a courier pigeon.' },
  ui: {
    nav: { label: 'Sections', features: 'Features', security: 'Security', how: 'How it works', faq: 'FAQ', menu: 'Menu' },
    eyebrows: { benefits: 'Ownership', features: 'Product', how: 'Setup', security: 'Security', faq: 'FAQ' },
    heroPills: ['Open source · MIT', 'Runs on Cloudflare'],
    builtOn: 'Built on',
    sampleDomain: 'yourcompany.com',
    sampleSubjects: {
      lena: 'Agenda for the planning day',
      daniel: 'Budget draft for next quarter',
      hana: 'Welcome to the team',
      marco: 'Contract renewal',
      aisha: 'Interview schedule',
      omar: 'Updated invoice',
      grace: 'Feedback from the design review',
      ben: 'Parking next week',
      elena: 'Train tickets for Monday',
      lucas: 'Team photo',
      jonas: 'Lunch on Friday?',
      priya: 'Notes from the customer call',
      tom: 'Re: Moving stand-up to 9:30'
    },
    sampleBody: 'Hi Sam, the agenda for the planning day is attached. Could you add the workshop times by Friday?',
    sampleReply: "Tuesday at 10:00 works for me. I'll book the small meeting room.",
    folders: {
      inbox: 'Inbox',
      starred: 'Starred',
      snoozed: 'Snoozed',
      sent: 'Sent',
      drafts: 'Drafts',
      archive: 'Archive',
      spam: 'Spam',
      trash: 'Trash'
    },
    words: {
      compose: 'Compose',
      reply: 'Reply',
      forward: 'Forward',
      send: 'Send',
      to: 'To',
      subject: 'Subject',
      attachments: 'Attachments',
      search: 'Search',
      alias: 'Alias',
      admin: 'Admin',
      member: 'Member',
      auditLog: 'Audit log',
      adminConsole: 'Admin console',
      name: 'Name',
      address: 'Address',
      role: 'Role',
      newMail: 'New mail',
      yourKey: 'Your key',
      encryptedWithKey: 'Encrypted with your key',
      cloudflareAccount: "Your company's Cloudflare account",
      aliasAdded: 'added an alias',
      notNeeded: ['Mail server', 'Container', 'Queue']
    },
    code: {
      title: 'Terminal',
      caption: 'Before step 1, your IT person deploys from a terminal:',
      comments: ['Create the D1 database and the R2 bucket', 'Apply the migrations', 'Secrets', 'Deploy'],
      guideLink: 'Read the deployment guide'
    },
    diagram: {
      caption: 'How stored mail is protected. Each limit is marked in the lists.',
      browser: { title: 'Browser', text: 'Your key, unlocked by your password. The password stays here.', tag: 'Holds the key' },
      worker: { title: 'Cloudflare Worker', text: 'Encrypts mail before it is stored', tag: 'Can seal, cannot open' },
      storage: { title: 'D1 · R2', text: 'Encrypted subjects, content and attachments', tag: 'Stores ciphertext' }
    },
    legend: { protected: 'Protected', limit: 'Limit' },
    footer: { product: 'Product', project: 'Open source', deployGuide: 'Deployment guide' }
  }
};
