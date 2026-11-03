import React from 'react';
import { X, Sparkles, Send, CheckCircle2, AlertCircle } from 'lucide-react';

interface SimulateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const SimulateModal: React.FC<SimulateModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [senderName, setSenderName] = React.useState('Matthew Prince');
  const [senderEmail, setSenderEmail] = React.useState('matthew@cloudflare.com');
  const [recipient, setRecipient] = React.useState('me@edgingmail.internal');
  const [subject, setSubject] = React.useState('Welcome to the Edge: edging-mail is live!');
  const [content, setContent] = React.useState(
    'Hey there!\n\nCongratulations on deploying edging-mail on Cloudflare Workers, D1, and R2.\n\nZero cold starts, zero servers to patch, and global low-latency inbox management right from the edge.\n\nBest,\nMatthew'
  );
  const [loading, setLoading] = React.useState(false);
  const [status, setStatus] = React.useState<{ text: string; type: 'success' | 'error' } | null>(null);

  if (!isOpen) return null;

  const handleSimulate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus(null);

    try {
      const res = await fetch('/api/debug/simulate-inbound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: senderEmail,
          from_name: senderName,
          to: recipient,
          subject,
          body_text: content,
          body_html: `<div style="font-family: -apple-system, sans-serif; padding: 24px; color: #1e293b;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
              <span style="background: #f6821f; color: white; padding: 4px 8px; border-radius: 6px; font-weight: bold; font-size: 12px;">CLOUDFLARE EDGE</span>
            </div>
            <h2 style="color: #0f172a; margin-top: 0;">${subject}</h2>
            <p style="line-height: 1.7; white-space: pre-wrap; font-size: 15px;">${content}</p>
            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
            <div style="font-size: 12px; color: #64748b; font-family: monospace;">
              Processed via Cloudflare Email Routing &bull; Stored in D1 &bull; Raw EML in R2
            </div>
          </div>`,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to simulate inbound email');
      }

      setStatus({ text: 'Inbound email received and saved to Inbox!', type: 'success' });
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 800);
    } catch (err: any) {
      setStatus({ text: err.message || 'Error simulating email', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <h3 className="text-sm font-bold text-amber-400 flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            Simulate Incoming Email
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSimulate} className="p-5 space-y-3.5 text-xs">
          <p className="text-slate-400 text-xs leading-relaxed">
            Use this to test email parsing, D1 indexing, and R2 raw storage locally without configuring live DNS/MX records.
          </p>

          {status && (
            <div
              className={`p-3 rounded-xl text-xs flex items-center gap-2.5 ${
                status.type === 'error'
                  ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              }`}
            >
              {status.type === 'error' ? (
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              )}
              <span>{status.text}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1 font-medium">Sender Name</label>
              <input
                type="text"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-amber-500/50"
                required
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1 font-medium">Sender Email</label>
              <input
                type="email"
                value={senderEmail}
                onChange={(e) => setSenderEmail(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-amber-500/50 font-mono"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1 font-medium">To Address</label>
            <input
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-amber-500/50 font-mono"
              required
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1 font-medium">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-amber-500/50"
              required
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1 font-medium">Message Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-200 text-xs focus:outline-none focus:border-amber-500/50 leading-relaxed resize-none"
              required
            />
          </div>

          <div className="pt-3 flex justify-end gap-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 shadow-md transition-all"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{loading ? 'Dispatching...' : 'Simulate Inbound Email'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
