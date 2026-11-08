import type React from 'react';
import type { ThemeTokens } from '../../theme';
import { tRich, useT } from '../../lib/i18n';
import { adminStyles } from './adminUi';

// Names the Cloudflare dashboard shows and the DNS records it adds: shown as they are, never translated.
const BOUNCE_HOST = 'cf-bounce';
const DMARC_HOST = '_dmarc';
const ERROR_CODE = 'E_RECIPIENT_NOT_ALLOWED';
const EXAMPLE_SUBDOMAIN = 'mail.example.com';

/** Click-by-click steps for one domain in the Cloudflare dashboard. It names the Worker generically: every deployment may have renamed it. */
export const DomainGuide: React.FC<{ t: ThemeTokens; domain: string }> = ({ t, domain }) => {
  const tr = useT();
  const s = adminStyles(t);
  const strong: React.CSSProperties = { color: t.text, fontWeight: 600 };
  const list: React.CSSProperties = {
    margin: 0,
    paddingLeft: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    color: t.text2,
    fontSize: 13,
    lineHeight: '19px'
  };
  const code: React.CSSProperties = { color: t.text, fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 12.5 };
  const heading: React.CSSProperties = { margin: '4px 0 0', fontSize: 13, fontWeight: 600 };

  const domainName = <span style={code}>{domain}</span>;
  const worker = tr('domains.guide_worker');
  const sendToWorker = <span style={strong}>{tr('domains.guide_action_worker')}</span>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowWrap: 'anywhere' }}>
      <h4 style={heading}>{tr('domains.receiving')}</h4>
      <ol style={list}>
        <li>
          {tRich('domains.guide_in1', {
            path: <span style={strong}>{tr('domains.guide_path_routing')}</span>,
            domain: domainName
          })}
        </li>
        <li>{tr('domains.guide_records')}</li>
        <li>{tRich('domains.guide_in3', { action: sendToWorker }, { worker })}</li>
        <li>{tr('domains.guide_in4')}</li>
      </ol>
      <h4 style={heading}>{tr('domains.sending')}</h4>
      <ol style={list}>
        <li>
          {tRich('domains.guide_out1', {
            path: <span style={strong}>{tr('domains.guide_path_sending')}</span>,
            domain: domainName
          })}
        </li>
        <li>
          {tRich('domains.guide_out2', {
            bounce: <span style={code}>{BOUNCE_HOST}</span>,
            dmarc: <span style={code}>{DMARC_HOST}</span>
          })}
        </li>
        <li>{tRich('domains.guide_out3', { code: <span style={code}>{ERROR_CODE}</span> })}</li>
      </ol>
      <h4 style={heading}>{tr('domains.guide_subdomain_title')}</h4>
      <p style={s.muted}>
        {tRich(
          'domains.guide_subdomain',
          {
            example: <span style={code}>{EXAMPLE_SUBDOMAIN}</span>,
            settings: <span style={strong}>{tr('domains.guide_settings')}</span>,
            subdomains: <span style={strong}>{tr('domains.guide_subdomains')}</span>,
            action: sendToWorker
          },
          { worker }
        )}
      </p>
    </div>
  );
};
