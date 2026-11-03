import React from 'react';
import { 
  Star, 
  Trash2, 
  Reply, 
  Forward, 
  Archive, 
  Download, 
  FileText, 
  ExternalLink, 
  Mail, 
  User,
  Paperclip
} from 'lucide-react';
import type { Message, Attachment } from '../types';

interface MessageViewProps {
  message: Message | null;
  attachments: Attachment[];
  isLoading: boolean;
  onReply: (message: Message) => void;
  onForward: (message: Message) => void;
  onToggleStar: (message: Message) => void;
  onTrash: (message: Message) => void;
  onArchive: (message: Message) => void;
}

export const MessageView: React.FC<MessageViewProps> = ({
  message,
  attachments,
  isLoading,
  onReply,
  onForward,
  onToggleStar,
  onTrash,
  onArchive,
}) => {
  const [viewMode, setViewMode] = React.useState<'html' | 'text'>('html');

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-950 text-slate-500">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-mono">Fetching from D1 & R2...</span>
        </div>
      </div>
    );
  }

  if (!message) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-slate-950 text-slate-600">
        <Mail className="w-12 h-12 stroke-[1] mb-2" />
        <p className="text-sm font-medium text-slate-400">Select an email to read</p>
        <p className="text-xs text-slate-600 mt-1">Fast, edge-rendered webmail directly on Cloudflare Workers</p>
      </div>
    );
  }

  const formatFullDate = (ts: number) => {
    return new Date(ts).toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'medium',
    });
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <main className="flex-1 flex flex-col bg-slate-950 overflow-hidden h-full">
      {/* Top Action Header */}
      <div className="h-14 px-6 border-b border-slate-800 flex items-center justify-between flex-shrink-0 bg-slate-900/40">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onReply(message)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
          >
            <Reply className="w-3.5 h-3.5" />
            <span>Reply</span>
          </button>
          <button
            onClick={() => onForward(message)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
          >
            <Forward className="w-3.5 h-3.5" />
            <span>Forward</span>
          </button>
          <button
            onClick={() => onArchive(message)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title="Archive"
          >
            <Archive className="w-4 h-4" />
          </button>
          <button
            onClick={() => onTrash(message)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
            title="Trash"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => onToggleStar(message)}
            className={`p-1.5 rounded-lg hover:bg-slate-800 transition-colors ${
              message.is_starred ? 'text-amber-400' : 'text-slate-400 hover:text-amber-400'
            }`}
            title="Star"
          >
            <Star className={`w-4 h-4 ${message.is_starred ? 'fill-amber-400' : ''}`} />
          </button>
        </div>

        {/* Raw EML download & View Switcher */}
        <div className="flex items-center gap-3 text-xs">
          {message.body_html && message.body_text && (
            <div className="flex bg-slate-800/80 p-0.5 rounded-lg border border-slate-700">
              <button
                onClick={() => setViewMode('html')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  viewMode === 'html' ? 'bg-orange-500 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                HTML
              </button>
              <button
                onClick={() => setViewMode('text')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  viewMode === 'text' ? 'bg-orange-500 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Plain Text
              </button>
            </div>
          )}

          <a
            href={`/api/raw/${message.id}`}
            download={`message-${message.id}.eml`}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
            title="Download raw RFC822 EML from Cloudflare R2"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download .eml</span>
          </a>
        </div>
      </div>

      {/* Message Metadata */}
      <div className="p-6 border-b border-slate-800/80 space-y-4 flex-shrink-0 bg-slate-900/20">
        <h2 className="text-lg font-bold text-white tracking-tight break-words">
          {message.subject || '(No Subject)'}
        </h2>

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 font-semibold flex-shrink-0">
              {(message.from_name || message.from_address || '?')[0].toUpperCase()}
            </div>
            <div className="space-y-0.5 min-w-0 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-100 truncate">
                  {message.from_name || message.from_address}
                </span>
                {message.from_name && (
                  <span className="text-slate-400 font-mono text-[11px] truncate">
                    &lt;{message.from_address}&gt;
                  </span>
                )}
              </div>
              <div className="text-slate-400 flex items-center gap-1">
                <span>to</span>
                <span className="text-slate-300 font-mono">{message.to_address}</span>
                {message.cc && (
                  <>
                    <span className="ml-2">cc</span>
                    <span className="text-slate-300 font-mono">{message.cc}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="text-right text-xs text-slate-400 font-mono whitespace-nowrap flex-shrink-0">
            {formatFullDate(message.created_at)}
          </div>
        </div>
      </div>

      {/* Attachments bar if any */}
      {attachments && attachments.length > 0 && (
        <div className="px-6 py-3 border-b border-slate-800 bg-slate-900/40 flex items-center gap-3 overflow-x-auto flex-shrink-0">
          <span className="text-xs text-slate-400 flex items-center gap-1.5 flex-shrink-0">
            <Paperclip className="w-3.5 h-3.5 text-orange-400" />
            <span>{attachments.length} Attachment{attachments.length > 1 ? 's' : ''}:</span>
          </span>
          <div className="flex items-center gap-2">
            {attachments.map((att) => (
              <a
                key={att.id}
                href={`/api/attachments/${att.id}`}
                download={att.filename}
                className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 transition-colors flex-shrink-0"
              >
                <FileText className="w-3.5 h-3.5 text-orange-400" />
                <span className="truncate max-w-[150px]">{att.filename}</span>
                <span className="text-[10px] text-slate-500 font-mono">
                  ({formatSize(att.size)})
                </span>
                <Download className="w-3 h-3 text-slate-400 ml-1" />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Email Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {viewMode === 'html' && message.body_html ? (
          <div className="bg-white text-slate-900 rounded-xl p-6 min-h-[400px] shadow-lg overflow-x-auto">
            <iframe
              title="email-content"
              srcDoc={`<!DOCTYPE html><html><head><base target="_blank"><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;margin:0;padding:12px;color:#1e293b;line-height:1.6;font-size:14px;}img{max-width:100%;height:auto;}a{color:#f97316;}</style></head><body>${message.body_html}</body></html>`}
              className="w-full min-h-[500px] border-0 rounded"
              sandbox="allow-popups allow-popups-to-escape-sandbox"
            />
          </div>
        ) : (
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 text-sm text-slate-200 whitespace-pre-wrap font-sans leading-relaxed min-h-[400px]">
            {message.body_text || message.snippet || '(No content)'}
          </div>
        )}
      </div>
    </main>
  );
};
