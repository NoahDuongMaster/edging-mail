import React from 'react';
import { X, Send, Paperclip, AlertCircle, CheckCircle2 } from 'lucide-react';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTo?: string;
  initialSubject?: string;
  initialBody?: string;
  defaultFrom: string;
  onSuccess: () => void;
}

export const ComposeModal: React.FC<ComposeModalProps> = ({
  isOpen,
  onClose,
  initialTo = '',
  initialSubject = '',
  initialBody = '',
  defaultFrom,
  onSuccess,
}) => {
  const [to, setTo] = React.useState(initialTo);
  const [from, setFrom] = React.useState(defaultFrom);
  const [cc, setCc] = React.useState('');
  const [bcc, setBcc] = React.useState('');
  const [showCc, setShowCc] = React.useState(false);
  const [subject, setSubject] = React.useState(initialSubject);
  const [body, setBody] = React.useState(initialBody);
  const [isSending, setIsSending] = React.useState(false);
  const [statusMessage, setStatusMessage] = React.useState<{ text: string; type: 'error' | 'success' } | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setTo(initialTo);
      setSubject(initialSubject);
      setBody(initialBody);
      setFrom(defaultFrom || 'no-reply@edging-mail.internal');
      setStatusMessage(null);
    }
  }, [isOpen, initialTo, initialSubject, initialBody, defaultFrom]);

  if (!isOpen) return null;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!to.trim() || !subject.trim()) {
      setStatusMessage({ text: 'Recipient (To) and Subject are required.', type: 'error' });
      return;
    }

    setIsSending(true);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: to.split(',').map((s) => s.trim()).filter(Boolean),
          cc: cc ? cc.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
          bcc: bcc ? bcc.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
          subject,
          text: body,
          html: `<div style="font-family: sans-serif; line-height: 1.6; color: #1e293b;">${body.replace(/\n/g, '<br/>')}</div>`,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to send email');
      }

      setStatusMessage({ text: data.note || 'Email sent successfully and recorded in Sent folder!', type: 'success' });
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);
    } catch (err: any) {
      setStatusMessage({ text: err.message || 'Error sending email', type: 'error' });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-orange-500"></span>
            New Message
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSend} className="flex-1 flex flex-col p-5 space-y-3 overflow-y-auto">
          {statusMessage && (
            <div
              className={`p-3 rounded-xl text-xs flex items-center gap-2.5 ${
                statusMessage.type === 'error'
                  ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              }`}
            >
              {statusMessage.type === 'error' ? (
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {/* From & To fields */}
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-3 border-b border-slate-800 pb-2">
              <span className="w-14 text-slate-500 font-medium">From:</span>
              <input
                type="email"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="flex-1 bg-transparent text-slate-200 focus:outline-none font-mono text-xs"
                placeholder="sender@yourdomain.com"
                required
              />
            </div>

            <div className="flex items-center gap-3 border-b border-slate-800 pb-2">
              <span className="w-14 text-slate-500 font-medium">To:</span>
              <input
                type="text"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="flex-1 bg-transparent text-slate-200 focus:outline-none font-mono text-xs"
                placeholder="recipient@example.com (comma separated)"
                required
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowCc(!showCc)}
                className="text-[11px] text-orange-400 hover:text-orange-300 font-medium"
              >
                {showCc ? 'Hide Cc/Bcc' : 'Cc / Bcc'}
              </button>
            </div>

            {showCc && (
              <>
                <div className="flex items-center gap-3 border-b border-slate-800 pb-2">
                  <span className="w-14 text-slate-500 font-medium">Cc:</span>
                  <input
                    type="text"
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    className="flex-1 bg-transparent text-slate-200 focus:outline-none font-mono text-xs"
                    placeholder="cc@example.com"
                  />
                </div>
                <div className="flex items-center gap-3 border-b border-slate-800 pb-2">
                  <span className="w-14 text-slate-500 font-medium">Bcc:</span>
                  <input
                    type="text"
                    value={bcc}
                    onChange={(e) => setBcc(e.target.value)}
                    className="flex-1 bg-transparent text-slate-200 focus:outline-none font-mono text-xs"
                    placeholder="bcc@example.com"
                  />
                </div>
              </>
            )}

            <div className="flex items-center gap-3 border-b border-slate-800 pb-2">
              <span className="w-14 text-slate-500 font-medium">Subject:</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="flex-1 bg-transparent text-slate-100 font-medium focus:outline-none text-xs"
                placeholder="Subject"
                required
              />
            </div>
          </div>

          {/* Body Textarea */}
          <div className="flex-1 min-h-[220px]">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your email message here..."
              className="w-full h-full min-h-[220px] bg-slate-950/40 border border-slate-800/80 rounded-xl p-3.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-orange-500/40 font-sans leading-relaxed resize-none"
            />
          </div>

          {/* Footer Controls */}
          <div className="pt-2 flex items-center justify-between border-t border-slate-800">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="flex items-center gap-1 font-mono text-[11px]">
                <span>MIME:</span>
                <span className="text-orange-400">RFC5322</span>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSending}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white shadow-md shadow-orange-950/40 transition-all"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isSending ? 'Sending...' : 'Send Message'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
