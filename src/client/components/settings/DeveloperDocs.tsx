import type React from 'react';
import {
  BellRing,
  Boxes,
  Clock,
  Database,
  Globe,
  HardDrive,
  KeyRound,
  Mail,
  Radio,
  Rocket,
  Route,
  Send,
  type LucideIcon
} from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { tRich, useT, type MessageKey } from '../../lib/i18n';
import { CodeBlock, CopyButton, Step, Steps } from '../../ui';
import './settings.css';

// The three technical sections of Settings (admins only): short notes on what runs where, the deployment steps and the mail setup. They
// point to docs/deployment.md and docs/configuration.md instead of repeating them.

export type DocsTab = 'architecture' | 'deployment' | 'routing';

export const DOCS_TABS: { id: DocsTab; labelKey: MessageKey; descriptionKey: MessageKey; icon: LucideIcon }[] = [
  { id: 'architecture', labelKey: 'docs.tab_architecture', descriptionKey: 'docs.architecture_desc', icon: Boxes },
  { id: 'deployment', labelKey: 'docs.tab_deployment', descriptionKey: 'docs.deployment_desc', icon: Rocket },
  { id: 'routing', labelKey: 'docs.tab_routing', descriptionKey: 'docs.routing_desc', icon: Route }
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

/** Commands to run, with a Copy button in their top right corner (the commands themselves are never translated). */
const Command: React.FC<{ children: string }> = ({ children }) => (
  <div className="st-command">
    <CodeBlock>{children}</CodeBlock>
    <CopyButton size="sm" variant="ghost" className="st-command-copy" text={children} />
  </div>
);

export const DeveloperDocs: React.FC<{ t: ThemeTokens; tab: DocsTab }> = ({ tab }) => {
  const tr = useT();

  if (tab === 'architecture') {
    return (
      <dl className="st-defs">
        {PARTS.map(({ icon: Icon, titleKey, textKey }) => (
          <div key={titleKey} className="st-def">
            <dt>
              <span className="st-def-icon" aria-hidden="true">
                <Icon size={16} strokeWidth={1.75} />
              </span>
              {tr(titleKey)}
            </dt>
            <dd>{tr(textKey)}</dd>
          </div>
        ))}
        <div className="st-def">
          <dt>
            <span className="st-def-icon" aria-hidden="true">
              <KeyRound size={16} strokeWidth={1.75} />
            </span>
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
        <p className="st-docs-lead">
          {tRich('docs.deploy_intro', { deployment: code('docs/deployment.md'), configuration: code('docs/configuration.md') })}
        </p>
        <Steps>
          <Step headingLevel={4} title={tr('docs.deploy_step1')}>
            <Command>{COMMAND_CREATE}</Command>
            <p className="st-muted">
              {tRich('docs.deploy_step1_note', {
                id: code('database_id'),
                file: code('wrangler.jsonc'),
                default_from: code('DEFAULT_FROM')
              })}
            </p>
          </Step>
          <Step headingLevel={4} title={tr('docs.deploy_step2')}>
            <Command>{COMMAND_MIGRATE}</Command>
          </Step>
          <Step headingLevel={4} title={tr('docs.deploy_step3')}>
            <Command>{COMMAND_SECRETS}</Command>
            <p className="st-muted">
              {tRich('docs.deploy_step3_note', {
                jwt_secret: code('JWT_SECRET'),
                data_key: code('DATA_KEY'),
                app_password: code('APP_PASSWORD')
              })}
            </p>
          </Step>
          <Step headingLevel={4} title={tr('docs.deploy_step4')}>
            <Command>{COMMAND_DEPLOY}</Command>
            <p className="st-muted">{tr('docs.deploy_step4_note')}</p>
          </Step>
          <Step headingLevel={4} title={tr('docs.deploy_step5')}>
            <p className="st-muted">{tRich('docs.deploy_step5_note', { app_password: code('APP_PASSWORD') })}</p>
          </Step>
        </Steps>
        <p className="st-docs-note">{tr('docs.deploy_plan')}</p>
      </div>
    );
  }

  const domain = code(EXAMPLE_DOMAIN);
  const worker = tr('domains.guide_worker');
  return (
    <div className="st-docs">
      <p className="st-docs-lead">{tr('docs.routing_intro', { check: tr('admin.check_dns') })}</p>
      <section aria-labelledby="docs-receiving" className="st-docs-part">
        <h4 id="docs-receiving" className="st-docs-title">
          {tr('domains.receiving')}
        </h4>
        <Steps>
          <Step>{tRich('domains.guide_in1', { path: strong(tr('domains.guide_path_routing')), domain })}</Step>
          <Step>{tr('domains.guide_records')}</Step>
          <Step>{tRich('docs.routing_catchall', { action: strong(tr('domains.guide_action_worker')) }, { worker })}</Step>
          <Step>{tr('docs.routing_test')}</Step>
        </Steps>
        <p className="st-docs-note">{tRich('docs.routing_alt', { doc: code('docs/deployment.md') })}</p>
      </section>
      <section aria-labelledby="docs-sending" className="st-docs-part">
        <h4 id="docs-sending" className="st-docs-title">
          {tr('domains.sending')}
        </h4>
        <Steps>
          <Step>{tRich('domains.guide_out1', { path: strong(tr('domains.guide_path_sending')), domain })}</Step>
          <Step>{tRich('domains.guide_out2', { bounce: code('cf-bounce'), dmarc: code('_dmarc') })}</Step>
          <Step>{tRich('domains.guide_out3', { code: code('E_RECIPIENT_NOT_ALLOWED') })}</Step>
          <Step>{tr('docs.routing_from')}</Step>
        </Steps>
      </section>
    </div>
  );
};
