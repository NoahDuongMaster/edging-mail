import type React from 'react';
import type { ThemeTokens } from '../../theme';
import { tRich, useT } from '../../lib/i18n';
import { Step, Steps } from '../../ui';
import { DashboardLink, ModalFrame } from './adminUi';

// Names the Cloudflare dashboard shows and the DNS records it adds: shown as they are, never translated.
const BOUNCE_HOST = 'cf-bounce';
const DMARC_HOST = '_dmarc';
const ERROR_CODE = 'E_RECIPIENT_NOT_ALLOWED';
const EXAMPLE_SUBDOMAIN = 'mail.example.com';

/** Click-by-click steps for one domain in the Cloudflare dashboard. It names the Worker generically: every deployment may have renamed it. */
export const DomainGuide: React.FC<{ t: ThemeTokens; domain: string }> = ({ domain }) => {
  const tr = useT();
  const domainName = <span className="adm-code">{domain}</span>;
  const worker = tr('domains.guide_worker');
  const sendToWorker = <span className="adm-strong">{tr('domains.guide_action_worker')}</span>;

  return (
    <div className="adm-guide">
      <DashboardLink />
      <h4 className="adm-guide-title">{tr('domains.receiving')}</h4>
      <Steps>
        <Step>
          {tRich('domains.guide_in1', {
            path: <span className="adm-strong">{tr('domains.guide_path_routing')}</span>,
            domain: domainName
          })}
        </Step>
        <Step>{tr('domains.guide_records')}</Step>
        <Step>{tRich('domains.guide_in3', { action: sendToWorker }, { worker })}</Step>
        <Step>{tr('domains.guide_in4')}</Step>
      </Steps>
      <h4 className="adm-guide-title">{tr('domains.sending')}</h4>
      <Steps>
        <Step>
          {tRich('domains.guide_out1', {
            path: <span className="adm-strong">{tr('domains.guide_path_sending')}</span>,
            domain: domainName
          })}
        </Step>
        <Step>
          {tRich('domains.guide_out2', {
            bounce: <span className="adm-code">{BOUNCE_HOST}</span>,
            dmarc: <span className="adm-code">{DMARC_HOST}</span>
          })}
        </Step>
        <Step>{tRich('domains.guide_out3', { code: <span className="adm-code">{ERROR_CODE}</span> })}</Step>
      </Steps>
      <h4 className="adm-guide-title">{tr('domains.guide_subdomain_title')}</h4>
      <p className="adm-guide-note">
        {tRich(
          'domains.guide_subdomain',
          {
            example: <span className="adm-code">{EXAMPLE_SUBDOMAIN}</span>,
            settings: <span className="adm-strong">{tr('domains.guide_settings')}</span>,
            subdomains: <span className="adm-strong">{tr('domains.guide_subdomains')}</span>,
            action: sendToWorker
          },
          { worker }
        )}
      </p>
    </div>
  );
};

/**
 * The setup steps of one domain in a dialog of their own (opened from the foot of the domain's card), wide enough for the dashboard's paths
 * to read on one line; Close, Escape and the scrim close it and the focus goes back to the button that opened it.
 */
export const DomainGuideDialog: React.FC<{ t: ThemeTokens; domain: string; onClose: () => void }> = ({ t, domain, onClose }) => {
  const tr = useT();
  return (
    <ModalFrame t={t} title={tr('domains.guide_title', { name: domain })} onClose={onClose} maxWidth={640}>
      <DomainGuide t={t} domain={domain} />
    </ModalFrame>
  );
};
