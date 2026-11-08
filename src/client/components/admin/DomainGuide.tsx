import type React from 'react';
import type { ThemeTokens } from '../../theme';
import { tRich, useT } from '../../lib/i18n';
import { Step, Steps } from '../../ui';

// Names the Cloudflare dashboard shows and the DNS records it adds: shown as they are, never translated.
const BOUNCE_HOST = 'cf-bounce';
const DMARC_HOST = '_dmarc';
const ERROR_CODE = 'E_RECIPIENT_NOT_ALLOWED';
const EXAMPLE_SUBDOMAIN = 'mail.example.com';

/** Click-by-click steps for one domain in the Cloudflare dashboard. It names the Worker generically: every deployment may have renamed it. */
export const DomainGuide: React.FC<{ t: ThemeTokens; domain: string }> = ({ domain }) => {
  const tr = useT();
  const domainName = <span className="ad-code">{domain}</span>;
  const worker = tr('domains.guide_worker');
  const sendToWorker = <span className="ad-strong">{tr('domains.guide_action_worker')}</span>;

  return (
    <div className="ad-guide">
      <h4 className="ad-guide-title">{tr('domains.receiving')}</h4>
      <Steps>
        <Step>
          {tRich('domains.guide_in1', {
            path: <span className="ad-strong">{tr('domains.guide_path_routing')}</span>,
            domain: domainName
          })}
        </Step>
        <Step>{tr('domains.guide_records')}</Step>
        <Step>{tRich('domains.guide_in3', { action: sendToWorker }, { worker })}</Step>
        <Step>{tr('domains.guide_in4')}</Step>
      </Steps>
      <h4 className="ad-guide-title">{tr('domains.sending')}</h4>
      <Steps>
        <Step>
          {tRich('domains.guide_out1', {
            path: <span className="ad-strong">{tr('domains.guide_path_sending')}</span>,
            domain: domainName
          })}
        </Step>
        <Step>
          {tRich('domains.guide_out2', {
            bounce: <span className="ad-code">{BOUNCE_HOST}</span>,
            dmarc: <span className="ad-code">{DMARC_HOST}</span>
          })}
        </Step>
        <Step>{tRich('domains.guide_out3', { code: <span className="ad-code">{ERROR_CODE}</span> })}</Step>
      </Steps>
      <h4 className="ad-guide-title">{tr('domains.guide_subdomain_title')}</h4>
      <p className="ad-muted">
        {tRich(
          'domains.guide_subdomain',
          {
            example: <span className="ad-code">{EXAMPLE_SUBDOMAIN}</span>,
            settings: <span className="ad-strong">{tr('domains.guide_settings')}</span>,
            subdomains: <span className="ad-strong">{tr('domains.guide_subdomains')}</span>,
            action: sendToWorker
          },
          { worker }
        )}
      </p>
    </div>
  );
};
