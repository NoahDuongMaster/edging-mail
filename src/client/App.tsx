import React from 'react';
import { Sidebar } from './components/Sidebar';
import { MessageList } from './components/MessageList';
import { MessageView } from './components/MessageView';
import { ComposeModal } from './components/ComposeModal';
import { SimulateModal } from './components/SimulateModal';
import { SettingsModal } from './components/SettingsModal';
import type { Message, Attachment, FolderStats } from './types';

export default function App() {
  const [currentFolder, setCurrentFolder] = React.useState('inbox');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [selectedMessageId, setSelectedMessageId] = React.useState<string | null>(null);
  const [currentMessage, setCurrentMessage] = React.useState<Message | null>(null);
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const [stats, setStats] = React.useState<FolderStats>({});
  const [isLoadingList, setIsLoadingList] = React.useState(false);
  const [isLoadingMessage, setIsLoadingMessage] = React.useState(false);

  // Modals
  const [isComposeOpen, setIsComposeOpen] = React.useState(false);
  const [composeInitial, setComposeInitial] = React.useState<{
    to?: string;
    subject?: string;
    body?: string;
  }>({});
  const [isSimulateOpen, setIsSimulateOpen] = React.useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);

  // Fetch stats
  const fetchStats = async () => {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      if (data.success && data.stats) {
        setStats(data.stats);
      }
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

  // Fetch messages
  const fetchMessages = React.useCallback(async () => {
    setIsLoadingList(true);
    try {
      const query = new URLSearchParams({
        folder: currentFolder,
        q: searchQuery,
      });
      const res = await fetch(`/api/messages?${query.toString()}`);
      const data = await res.json();
      if (data.success) {
        setMessages(data.messages || []);
        // Auto-select first message if none selected or current selection missing
        if (data.messages && data.messages.length > 0) {
          if (!selectedMessageId || !data.messages.some((m: Message) => m.id === selectedMessageId)) {
            setSelectedMessageId(data.messages[0].id);
          }
        } else {
          setSelectedMessageId(null);
          setCurrentMessage(null);
        }
      }
    } catch (err) {
      console.error('Failed to load messages:', err);
    } finally {
      setIsLoadingList(false);
    }
  }, [currentFolder, searchQuery, selectedMessageId]);

  // Fetch single message detail
  const fetchMessageDetail = React.useCallback(async (id: string) => {
    setIsLoadingMessage(true);
    try {
      const res = await fetch(`/api/messages/${id}`);
      const data = await res.json();
      if (data.success) {
        setCurrentMessage(data.message);
        setAttachments(data.attachments || []);
        // Update read count in list
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, is_read: 1 } : m))
        );
        fetchStats();
      }
    } catch (err) {
      console.error('Failed to load message detail:', err);
    } finally {
      setIsLoadingMessage(false);
    }
  }, []);

  React.useEffect(() => {
    fetchStats();
  }, []);

  React.useEffect(() => {
    fetchMessages();
  }, [currentFolder, searchQuery]);

  React.useEffect(() => {
    if (selectedMessageId) {
      fetchMessageDetail(selectedMessageId);
    } else {
      setCurrentMessage(null);
      setAttachments([]);
    }
  }, [selectedMessageId, fetchMessageDetail]);

  // Batch actions
  const handleBatchAction = async (
    action: 'read' | 'unread' | 'star' | 'unstar' | 'trash' | 'archive' | 'delete',
    ids: string[]
  ) => {
    try {
      const res = await fetch('/api/messages/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_ids: ids, action }),
      });
      const data = await res.json();
      if (data.success) {
        fetchMessages();
        fetchStats();
      }
    } catch (err) {
      console.error('Batch action failed:', err);
    }
  };

  const handleReply = (msg: Message) => {
    setComposeInitial({
      to: msg.reply_to || msg.from_address,
      subject: msg.subject.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`,
      body: `\n\n--- On ${new Date(msg.created_at).toLocaleString()} ${msg.from_address} wrote: ---\n${msg.body_text || msg.snippet || ''}`,
    });
    setIsComposeOpen(true);
  };

  const handleForward = (msg: Message) => {
    setComposeInitial({
      to: '',
      subject: msg.subject.startsWith('Fwd:') ? msg.subject : `Fwd: ${msg.subject}`,
      body: `\n\n--- Forwarded message from ${msg.from_address} ---\nSubject: ${msg.subject}\nDate: ${new Date(msg.created_at).toLocaleString()}\n\n${msg.body_text || msg.snippet || ''}`,
    });
    setIsComposeOpen(true);
  };

  const handleToggleStar = (msg: Message) => {
    handleBatchAction(msg.is_starred ? 'unstar' : 'star', [msg.id]);
    if (currentMessage && currentMessage.id === msg.id) {
      setCurrentMessage({ ...currentMessage, is_starred: currentMessage.is_starred ? 0 : 1 });
    }
  };

  const handleTrash = (msg: Message) => {
    handleBatchAction(currentFolder === 'trash' ? 'delete' : 'trash', [msg.id]);
  };

  const handleArchive = (msg: Message) => {
    handleBatchAction('archive', [msg.id]);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 font-sans text-slate-100">
      {/* Left Sidebar */}
      <Sidebar
        currentFolder={currentFolder}
        onSelectFolder={(f) => {
          setCurrentFolder(f);
          setSelectedMessageId(null);
        }}
        stats={stats}
        onOpenCompose={() => {
          setComposeInitial({});
          setIsComposeOpen(true);
        }}
        onOpenSimulate={() => setIsSimulateOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Middle Message List */}
      <MessageList
        messages={messages}
        selectedMessageId={selectedMessageId}
        onSelectMessage={(id) => setSelectedMessageId(id)}
        searchQuery={searchQuery}
        onSearchChange={(q) => setSearchQuery(q)}
        onRefresh={() => {
          fetchMessages();
          fetchStats();
        }}
        isLoading={isLoadingList}
        folder={currentFolder}
        onBatchAction={handleBatchAction}
      />

      {/* Right Message View */}
      <MessageView
        message={currentMessage}
        attachments={attachments}
        isLoading={isLoadingMessage}
        onReply={handleReply}
        onForward={handleForward}
        onToggleStar={handleToggleStar}
        onTrash={handleTrash}
        onArchive={handleArchive}
      />

      {/* Modals */}
      <ComposeModal
        isOpen={isComposeOpen}
        onClose={() => setIsComposeOpen(false)}
        initialTo={composeInitial.to}
        initialSubject={composeInitial.subject}
        initialBody={composeInitial.body}
        defaultFrom="admin@edgingmail.internal"
        onSuccess={() => {
          fetchStats();
          if (currentFolder === 'sent') fetchMessages();
        }}
      />

      <SimulateModal
        isOpen={isSimulateOpen}
        onClose={() => setIsSimulateOpen(false)}
        onSuccess={() => {
          fetchStats();
          fetchMessages();
        }}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}
