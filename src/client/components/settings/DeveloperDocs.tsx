import type React from 'react';
import { BellRing, Clock, Database, Globe, HardDrive, KeyRound, Mail, Radio, Send, type LucideIcon } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { tRich, useT, type MessageKey } from '../../lib/i18n';
import { CodeBlock, Step, Steps } from '../../ui';
import './settings.css';

// The three technical tabs of Settings (admins only): short notes on what runs where, the deployment steps and the mail setup. They point
// to docs/deployment.md and docs/configuration.md instead of repeating them.

export type DocsTab = 'architecture' | 'deployment' | 'routing';

export const DOCS_TABS: { id: DocsTab; labelKey: MessageKey }[] = [
  { id: 'architecture', labelKey: 'docs.tab_architecture' },
  { id: 'deployment', labelKey: 'docs.tab_deployment' },
  { id: 'routing', labelKey: 'docs.tab_routing' }
];

// The parts of the deployment, in a hairline list: a small neutral icon, the name, one or two sentences.
const PARTS: { icon: LucideIcon; titleKey: MessageKey; textKey: MessageKey }[] = [
  { icon: Mail, titleKey: 'docs.arch_inbound_title', textKey: 'docs.arch_inbound' },
  { icon: Send, titleKey: 'docs.arch_outbound_title', textKey: 'docs.arch_outbound' },
  { icon: Database, titleKey: 'docs.arch_d1_title', textKey: 'docs.arch_d1' },
  { icon: HardDrive, titleKey: 'docs.arch_r2_title', textKey: 'docs.arch_r2' },
  { icon: Globe, titleKey: 'docs.arch_assets_title', textKey: 'docs.arch_assets' },
  { icon: Radio, titleKey: 'docs.arch_realtime_title', textKey: 'docs.arch_realtime' },
  { icon: Clock, titleKey: 'docs.arch_cron_title', textKey: 'docs.arch_cron' },
  { icon: BellRing, titleKey: 'docs.arch_push_title', textKey: 'docs.arch_push' }
];

// Shell commands: shown as code, never translated.
const COMMAND_CREATE = 'npx wrangler d1 create edging_mail_db\nnpx wrangler r2 bucket create edging-mail-storage';
const COMMAND_MIGRATE = 'npm run db:migrate:remote';
const COMMAND_SECRETS = 'npx wrangler secret put JWT_SECRET\nnpx wrangler secret put DATA_KEY\nnpx wrangler secret put APP_PASSWORD';
const COMMAND_DEPLOY = 'npm run deploy';
const EXAMPLE_DOMAIN = 'example.com';

// Parts of a sentence that need markup (see tRich): a code name, a bold dashboard path.
const code = (text: string) => <code>{text}</code>;
const strong = (text: string) => <strong>{text}</strong>;

export const DeveloperDocs: React.FC<{ t: ThemeTokens; tab: DocsTab }> = ({ tab }) => {
  const tr = useT();

  if (tab === 'architecture') {
    return (
      <dl className="st-defs">
        {PARTS.map(({ icon: Icon, titleKey, textKey }) => (
          <div key={titleKey} className="st-def">
            <dt>
              <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
              {tr(titleKey)}
            </dt>
            <dd>{tr(textKey)}</dd>
          </div>
        ))}
        <div className="st-def">
          <dt>
            <KeyRound size={16} strokeWidth={1.75} aria-hidden="true" />
            {tr('docs.arch_keys_title')}
          </dt>
          <dd>{tRich('docs.arch_keys', { data_key: code('DATA_KEY') })}</dd>
        </div>
      </dl>
    );
  }

  if (tab === 'deployment') {
    return (
      <div className="st-docs">
        <p className="st-muted">
          {tRich('docs.deploy_intro', { deployment: code('docs/deployment.md'), configuration: code('docs/configuration.md') })}
        </p>
        <Steps>
          <Step title={tr('docs.deploy_step1')}>
            <CodeBlock>{COMMAND_CREATE}</CodeBlock>
            <p className="st-muted">
              {tRich('docs.deploy_step1_note', {
                id: code('database_id'),
                file: code('wrangler.jsonc'),
                default_from: code('DEFAULT_FROM')
              })}
            </p>
          </Step>
          <Step title={tr('docs.deploy_step2')}>
            <CodeBlock>{COMMAND_MIGRATE}</CodeBlock>
          </Step>
          <Step title={tr('docs.deploy_step3')}>
            <CodeBlock>{COMMAND_SECRETS}</CodeBlock>
            <p className="st-muted">
              {tRich('docs.deploy_step3_note', {
                jwt_secret: code('JWT_SECRET'),
                data_key: code('DATA_KEY'),
                app_password: code('APP_PASSWORD')
              })}
            </p>
          </Step>
          <Step title={tr('docs.deploy_step4')}>
            <CodeBlock>{COMMAND_DEPLOY}</CodeBlock>
            <p className="st-muted">{tr('docs.deploy_step4_note')}</p>
          </Step>
          <Step title={tr('docs.deploy_step5')}>
            <p className="st-muted">{tRich('docs.deploy_step5_note', { app_password: code('APP_PASSWORD') })}</p>
          </Step>
        </Steps>
        <p className="st-muted">{tr('docs.deploy_plan')}</p>
      </div>
    );
  }

  const domain = code(EXAMPLE_DOMAIN);
  const worker = tr('domains.guide_worker');
  return (
    <div className="st-docs">
      <p className="st-muted">{tr('docs.routing_intro', { check: tr('admin.check_dns') })}</p>
      <h3 className="st-docs-title">{tr('domains.receiving')}</h3>
      <Steps>
        <Step>{tRich('domains.guide_in1', { path: strong(tr('domains.guide_path_routing')), domain })}</Step>
        <Step>{tr('domains.guide_records')}</Step>
        <Step>{tRich('docs.routing_catchall', { action: strong(tr('domains.guide_action_worker')) }, { worker })}</Step>
        <Step>{tr('docs.routing_test')}</Step>
      </Steps>
      <p className="st-muted">{tRich('docs.routing_alt', { doc: code('docs/deployment.md') })}</p>
      <h3 className="st-docs-title">{tr('domains.sending')}</h3>
      <Steps>
        <Step>{tRich('domains.guide_out1', { path: strong(tr('domains.guide_path_sending')), domain })}</Step>
        <Step>{tRich('domains.guide_out2', { bounce: code('cf-bounce'), dmarc: code('_dmarc') })}</Step>
        <Step>{tRich('domains.guide_out3', { code: code('E_RECIPIENT_NOT_ALLOWED') })}</Step>
        <Step>{tr('docs.routing_from')}</Step>
      </Steps>
    </div>
  );
};
