import React from 'react';
import { 
  Search, 
  RefreshCw, 
  CheckSquare, 
  Square, 
  MailOpen, 
  Mail, 
  Star, 
  Trash2, 
  Archive, 
  Paperclip, 
  Inbox
} from 'lucide-react';
import type { Message } from '../types';

interface MessageListProps {
  messages: Message[];
  selectedMessageId: string | null;
  onSelectMessage: (id: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onRefresh: () => void;
  isLoading: boolean;
  folder: string;
  onBatchAction: (action: 'read' | 'unread' | 'star' | 'unstar' | 'trash' | 'archive' | 'delete', ids: string[]) => void;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  selectedMessageId,
  onSelectMessage,
  searchQuery,
  onSearchChange,
  onRefresh,
  isLoading,
  folder,
  onBatchAction,
}) => {
  const [checkedIds, setCheckedIds] = React.useState<Set<string>>(new Set());

  const toggleCheck = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (checkedIds.size === messages.length && messages.length > 0) {
      setCheckedIds(new Set());
    } else {
      setCheckedIds(new Set(messages.map((m) => m.id)));
    }
  };

  const handleAction = (action: 'read' | 'unread' | 'star' | 'unstar' | 'trash' | 'archive' | 'delete') => {
    if (checkedIds.size === 0) return;
    onBatchAction(action, Array.from(checkedIds));
    setCheckedIds(new Set());
  };

  const formatTime = (ts: number) => {
    const date = new Date(ts);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div className="w-96 flex-shrink-0 bg-slate-900/60 border-r border-slate-800 flex flex-col h-full">
      {/* Top Search & Filter Bar */}
      <div className="p-3 border-b border-slate-800 space-y-2">
        <div className="relative flex items-center">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search in folder..."
            className="w-full bg-slate-950/80 border border-slate-800 rounded-lg pl-9 pr-8 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30 transition-all"
          />
          <button
            onClick={onRefresh}
            title="Refresh"
            className={`absolute right-2 text-slate-400 hover:text-slate-200 p-1 transition-transform ${isLoading ? 'animate-spin' : ''}`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Batch Action Toolbar */}
        <div className="flex items-center justify-between text-xs text-slate-400 px-1 pt-1">
          <div className="flex items-center gap-2">
            <button
              onClick={toggleSelectAll}
              className="hover:text-slate-200 text-slate-400 p-0.5 rounded"
              title={checkedIds.size > 0 ? 'Deselect all' : 'Select all'}
            >
              {checkedIds.size > 0 && checkedIds.size === messages.length ? (
                <CheckSquare className="w-4 h-4 text-orange-400" />
              ) : (
                <Square className="w-4 h-4" />
              )}
            </button>
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              {checkedIds.size > 0 ? `${checkedIds.size} selected` : folder}
            </span>
          </div>

          {checkedIds.size > 0 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleAction('read')}
                className="p-1 hover:text-slate-200 rounded hover:bg-slate-800"
                title="Mark read"
              >
                <MailOpen className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleAction('unread')}
                className="p-1 hover:text-slate-200 rounded hover:bg-slate-800"
                title="Mark unread"
              >
                <Mail className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleAction('star')}
                className="p-1 hover:text-amber-400 rounded hover:bg-slate-800"
                title="Star"
              >
                <Star className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleAction('archive')}
                className="p-1 hover:text-slate-200 rounded hover:bg-slate-800"
                title="Archive"
              >
                <Archive className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleAction(folder === 'trash' ? 'delete' : 'trash')}
                className="p-1 hover:text-red-400 rounded hover:bg-slate-800"
                title={folder === 'trash' ? 'Permanently Delete' : 'Move to Trash'}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Message List Items */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center p-6 text-slate-500">
            <Inbox className="w-10 h-10 stroke-[1.2] mb-2 text-slate-600" />
            <p className="text-sm font-medium">No messages in {folder}</p>
            <p className="text-xs text-slate-600 mt-1">
              Click "Simulate Inbound" to receive your first edge email.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isSelected = selectedMessageId === msg.id;
            const isChecked = checkedIds.has(msg.id);
            const isUnread = msg.is_read === 0;

            return (
              <div
                key={msg.id}
                onClick={() => onSelectMessage(msg.id)}
                className={`p-3.5 cursor-pointer transition-colors relative flex gap-3 ${
                  isSelected
                    ? 'bg-orange-500/10 border-l-2 border-orange-500'
                    : isUnread
                    ? 'bg-slate-800/40 hover:bg-slate-800/70'
                    : 'hover:bg-slate-800/30 text-slate-400'
                }`}
              >
                {/* Selection Checkbox & Star */}
                <div className="flex flex-col items-center gap-2 pt-0.5">
                  <button
                    onClick={(e) => toggleCheck(msg.id, e)}
                    className="text-slate-500 hover:text-slate-300"
                  >
                    {isChecked ? (
                      <CheckSquare className="w-3.5 h-3.5 text-orange-400" />
                    ) : (
                      <Square className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onBatchAction(msg.is_starred ? 'unstar' : 'star', [msg.id]);
                    }}
                    className={`text-slate-500 hover:text-amber-400 ${
                      msg.is_starred ? 'text-amber-400 fill-amber-400' : ''
                    }`}
                  >
                    <Star className={`w-3.5 h-3.5 ${msg.is_starred ? 'fill-amber-400' : ''}`} />
                  </button>
                </div>

                {/* Main preview */}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span
                      className={`truncate font-semibold ${
                        isUnread ? 'text-slate-100' : 'text-slate-300'
                      }`}
                    >
                      {folder === 'sent' ? msg.to_address : (msg.from_name || msg.from_address)}
                    </span>
                    <span className="text-[11px] text-slate-500 whitespace-nowrap ml-2">
                      {formatTime(msg.created_at)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <p
                      className={`text-xs truncate ${
                        isUnread ? 'font-semibold text-slate-200' : 'text-slate-400'
                      }`}
                    >
                      {msg.subject || '(No Subject)'}
                    </p>
                    {msg.has_attachments === 1 && (
                      <Paperclip className="w-3 h-3 text-slate-500 flex-shrink-0" />
                    )}
                  </div>

                  <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                    {msg.snippet || '(Empty body)'}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
