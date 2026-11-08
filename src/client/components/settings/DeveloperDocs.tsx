import type React from 'react';
import { BellRing, Clock, Database, Globe, HardDrive, KeyRound, Mail, Radio, Send, type LucideIcon } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { tRich, useT, type MessageKey } from '../../lib/i18n';

// The three technical tabs of Settings (admins only): short notes on what runs where, the deployment steps and the mail setup. They point
// to docs/deployment.md and docs/configuration.md instead of repeating them.

export type DocsTab = 'architecture' | 'deployment' | 'routing';

export const DOCS_TABS: { id: DocsTab; labelKey: MessageKey }[] = [
  { id: 'architecture', labelKey: 'docs.tab_architecture' },
  { id: 'deployment', labelKey: 'docs.tab_deployment' },
  { id: 'routing', labelKey: 'docs.tab_routing' }
];

// Icon, its colour (null = the accent) and the keys of the title and text of each card.
const CARDS: { icon: LucideIcon; color: string | null; titleKey: MessageKey; textKey: MessageKey }[] = [
  { icon: Mail, color: null, titleKey: 'docs.arch_inbound_title', textKey: 'docs.arch_inbound' },
  { icon: Send, color: null, titleKey: 'docs.arch_outbound_title', textKey: 'docs.arch_outbound' },
  { icon: Database, color: '#15803D', titleKey: 'docs.arch_d1_title', textKey: 'docs.arch_d1' },
  { icon: HardDrive, color: '#2F5BEA', titleKey: 'docs.arch_r2_title', textKey: 'docs.arch_r2' },
  { icon: Globe, color: '#B97800', titleKey: 'docs.arch_assets_title', textKey: 'docs.arch_assets' },
  { icon: Radio, color: null, titleKey: 'docs.arch_realtime_title', textKey: 'docs.arch_realtime' },
  { icon: Clock, color: null, titleKey: 'docs.arch_cron_title', textKey: 'docs.arch_cron' },
  { icon: BellRing, color: null, titleKey: 'docs.arch_push_title', textKey: 'docs.arch_push' }
];

// Shell commands: shown as code, never translated.
const COMMAND_CREATE = 'npx wrangler d1 create edging_mail_db\nnpx wrangler r2 bucket create edging-mail-storage';
const COMMAND_MIGRATE = 'npm run db:migrate:remote';
const COMMAND_SECRETS = 'npx wrangler secret put JWT_SECRET\nnpx wrangler secret put DATA_KEY\nnpx wrangler secret put APP_PASSWORD';
const COMMAND_DEPLOY = 'npm run deploy';
const EXAMPLE_DOMAIN = 'example.com';

export const DeveloperDocs: React.FC<{ t: ThemeTokens; tab: DocsTab }> = ({ t, tab }) => {
  const tr = useT();
  const muted: React.CSSProperties = { color: t.text2, fontSize: 12.5, lineHeight: '19px', margin: 0 };
  const step: React.CSSProperties = { ...muted, fontWeight: 600, color: t.text };
  const stepList: React.CSSProperties = {
    margin: 0,
    paddingLeft: 18,
    listStyle: 'decimal',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    color: t.text2,
    fontSize: 13,
    overflowWrap: 'anywhere'
  };
  const card: React.CSSProperties = {
    padding: 12,
    borderRadius: 12,
    border: `1px solid ${t.border}`,
    background: t.raised,
    display: 'flex',
    flexDirection: 'column',
    gap: 6
  };
  const pre: React.CSSProperties = {
    margin: 0,
    padding: 12,
    borderRadius: 10,
    border: `1px solid ${t.border}`,
    background: t.bg,
    color: t.text,
    fontFamily: "'Geist Mono', ui-monospace, monospace",
    fontSize: 12,
    lineHeight: '18px',
    overflowX: 'auto'
  };
  // Parts of a sentence that need markup (see tRich): a code name, a bold dashboard path.
  const code = (text: string) => <code style={{ color: t.text }}>{text}</code>;
  const strong = (text: string) => <strong style={{ color: t.text }}>{text}</strong>;
  const title = (key: MessageKey) => <p style={{ ...step, marginTop: 6 }}>{tr(key)}</p>;

  if (tab === 'architecture') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {CARDS.map(({ icon: Icon, color, titleKey, textKey }) => (
          <div key={titleKey} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13 }}>
              <Icon size={16} color={color ?? t.accent} aria-hidden="true" />
              {tr(titleKey)}
            </div>
            <p style={muted}>{tr(textKey)}</p>
          </div>
        ))}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13 }}>
            <KeyRound size={16} color={t.accent} aria-hidden="true" />
            {tr('docs.arch_keys_title')}
          </div>
          <p style={muted}>{tRich('docs.arch_keys', { data_key: code('DATA_KEY') })}</p>
        </div>
      </div>
    );
  }

  if (tab === 'deployment') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={muted}>
          {tRich('docs.deploy_intro', { deployment: code('docs/deployment.md'), configuration: code('docs/configuration.md') })}
        </p>
        <p style={step}>{tr('docs.deploy_step1')}</p>
        <pre style={pre}>{COMMAND_CREATE}</pre>
        <p style={muted}>
          {tRich('docs.deploy_step1_note', { id: code('database_id'), file: code('wrangler.jsonc'), default_from: code('DEFAULT_FROM') })}
        </p>
        <p style={step}>{tr('docs.deploy_step2')}</p>
        <pre style={pre}>{COMMAND_MIGRATE}</pre>
        <p style={step}>{tr('docs.deploy_step3')}</p>
        <pre style={pre}>{COMMAND_SECRETS}</pre>
        <p style={muted}>
          {tRich('docs.deploy_step3_note', {
            jwt_secret: code('JWT_SECRET'),
            data_key: code('DATA_KEY'),
            app_password: code('APP_PASSWORD')
          })}
        </p>
        <p style={step}>{tr('docs.deploy_step4')}</p>
        <pre style={pre}>{COMMAND_DEPLOY}</pre>
        <p style={muted}>{tr('docs.deploy_step4_note')}</p>
        <p style={step}>{tr('docs.deploy_step5')}</p>
        <p style={muted}>{tRich('docs.deploy_step5_note', { app_password: code('APP_PASSWORD') })}</p>
        <p style={muted}>{tr('docs.deploy_plan')}</p>
      </div>
    );
  }

  const domain = code(EXAMPLE_DOMAIN);
  const worker = tr('domains.guide_worker');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={muted}>{tr('docs.routing_intro', { check: tr('admin.check_dns') })}</p>
      {title('domains.receiving')}
      <ol style={stepList}>
        <li>{tRich('domains.guide_in1', { path: strong(tr('domains.guide_path_routing')), domain })}</li>
        <li>{tr('domains.guide_records')}</li>
        <li>{tRich('docs.routing_catchall', { action: strong(tr('domains.guide_action_worker')) }, { worker })}</li>
        <li>{tr('docs.routing_test')}</li>
      </ol>
      <p style={muted}>{tRich('docs.routing_alt', { doc: code('docs/deployment.md') })}</p>
      {title('domains.sending')}
      <ol style={stepList}>
        <li>{tRich('domains.guide_out1', { path: strong(tr('domains.guide_path_sending')), domain })}</li>
        <li>{tRich('domains.guide_out2', { bounce: code('cf-bounce'), dmarc: code('_dmarc') })}</li>
        <li>{tRich('domains.guide_out3', { code: code('E_RECIPIENT_NOT_ALLOWED') })}</li>
        <li>{tr('docs.routing_from')}</li>
      </ol>
    </div>
  );
};
