import React from 'react';
import { X, Cloud, ShieldCheck, Database, HardDrive, Mail, Terminal, ExternalLink } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = React.useState<'architecture' | 'deployment' | 'routing'>('architecture');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Cloud className="w-4 h-4 text-orange-400" />
            Cloudflare Edge Setup & Architecture
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-800 px-5 text-xs font-medium">
          <button
            onClick={() => setActiveTab('architecture')}
            className={`py-3 px-3 border-b-2 transition-colors ${
              activeTab === 'architecture'
                ? 'border-orange-500 text-orange-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Architecture
          </button>
          <button
            onClick={() => setActiveTab('deployment')}
            className={`py-3 px-3 border-b-2 transition-colors ${
              activeTab === 'deployment'
                ? 'border-orange-500 text-orange-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Deployment Guide
          </button>
          <button
            onClick={() => setActiveTab('routing')}
            className={`py-3 px-3 border-b-2 transition-colors ${
              activeTab === 'routing'
                ? 'border-orange-500 text-orange-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Email Routing & MX
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-4 text-xs text-slate-300 leading-relaxed">
          {activeTab === 'architecture' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5">
                  <div className="flex items-center gap-2 font-semibold text-orange-400">
                    <Mail className="w-4 h-4" />
                    <span>Inbound Email Routing</span>
                  </div>
                  <p className="text-slate-400 text-[11px]">
                    Cloudflare catches inbound SMTP via Email Routing and routes raw streams directly to our Worker `email(message, env)` hook.
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5">
                  <div className="flex items-center gap-2 font-semibold text-emerald-400">
                    <Database className="w-4 h-4" />
                    <span>Cloudflare D1 (SQLite)</span>
                  </div>
                  <p className="text-slate-400 text-[11px]">
                    Stores parsed email headers, snippets, folders, read status, and thread IDs for instant edge queries with zero latency.
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5">
                  <div className="flex items-center gap-2 font-semibold text-sky-400">
                    <HardDrive className="w-4 h-4" />
                    <span>Cloudflare R2 Bucket</span>
                  </div>
                  <p className="text-slate-400 text-[11px]">
                    Stores raw RFC822 EML files and email attachments with zero egress fees.
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5">
                  <div className="flex items-center gap-2 font-semibold text-amber-400">
                    <ShieldCheck className="w-4 h-4" />
                    <span>Cloudflare Assets (SPA)</span>
                  </div>
                  <p className="text-slate-400 text-[11px]">
                    Serves the modern React webmail client directly from Cloudflare's global edge cache.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'deployment' && (
            <div className="space-y-3">
              <p className="text-slate-300 font-medium">Step 1: Create D1 Database and R2 Bucket</p>
              <pre className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] font-mono text-orange-300 overflow-x-auto">
{`npx wrangler d1 create edging_mail_db
npx wrangler r2 bucket create edging-mail-storage`}
              </pre>

              <p className="text-slate-300 font-medium">Step 2: Apply Database Schema</p>
              <pre className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] font-mono text-emerald-300 overflow-x-auto">
{`npx wrangler d1 execute DB --remote --file=./schema.sql`}
              </pre>

              <p className="text-slate-300 font-medium">Step 3: Deploy to Cloudflare</p>
              <pre className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] font-mono text-sky-300 overflow-x-auto">
{`npm run deploy`}
              </pre>
            </div>
          )}

          {activeTab === 'routing' && (
            <div className="space-y-3">
              <p className="text-slate-300">
                To receive real emails at your custom domain (e.g. <code>you@yourdomain.com</code>):
              </p>
              <ol className="list-decimal pl-4 space-y-2 text-slate-400">
                <li>Go to <strong>Cloudflare Dashboard &rarr; Your Domain &rarr; Email Routing</strong>.</li>
                <li>Enable Email Routing (Cloudflare will automatically configure the MX & SPF DNS records for you).</li>
                <li>Under <strong>Routing Rules</strong>, add a rule:
                  <ul className="list-disc pl-4 mt-1 text-slate-300">
                    <li>Custom address: <code>*@yourdomain.com</code> (or specific address)</li>
                    <li>Action: <strong>Send to a Worker</strong> &rarr; Select <code>edging-mail</code></li>
                  </ul>
                </li>
                <li>Save! Inbound emails will now hit your worker and land straight into edging-mail.</li>
              </ol>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 flex justify-end bg-slate-900/60">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
