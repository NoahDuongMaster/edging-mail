import React from 'react';
import { 
  Inbox, 
  Send, 
  Star, 
  Trash2, 
  Archive, 
  AlertOctagon, 
  PenSquare, 
  Zap, 
  Sliders, 
  PlusCircle,
  Sparkles
} from 'lucide-react';
import type { FolderStats } from '../types';

interface SidebarProps {
  currentFolder: string;
  onSelectFolder: (folder: string) => void;
  stats: FolderStats;
  onOpenCompose: () => void;
  onOpenSimulate: () => void;
  onOpenSettings: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentFolder,
  onSelectFolder,
  stats,
  onOpenCompose,
  onOpenSimulate,
  onOpenSettings,
}) => {
  const navItems = [
    { id: 'inbox', label: 'Inbox', icon: Inbox },
    { id: 'starred', label: 'Starred', icon: Star },
    { id: 'sent', label: 'Sent', icon: Send },
    { id: 'archive', label: 'Archive', icon: Archive },
    { id: 'spam', label: 'Spam', icon: AlertOctagon },
    { id: 'trash', label: 'Trash', icon: Trash2 },
  ];

  return (
    <aside className="w-64 flex-shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col justify-between">
      {/* Top Branding & Actions */}
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-3 px-2 py-1">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-600 to-orange-500 flex items-center justify-center shadow-lg shadow-orange-950/40 border border-orange-400/20">
            <Zap className="w-5 h-5 text-white fill-white" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-1.5">
              edging-mail
              <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20">
                Edge
              </span>
            </h1>
            <p className="text-xs text-slate-400 font-mono">100% Cloudflare</p>
          </div>
        </div>

        {/* Compose Button */}
        <button
          onClick={onOpenCompose}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-medium shadow-md shadow-orange-950/30 transition-all hover:scale-[1.01] active:scale-[0.99]"
        >
          <PenSquare className="w-4 h-4" />
          <span>Compose</span>
        </button>

        {/* Quick Mock Inbound (Dev feature) */}
        <button
          onClick={onOpenSimulate}
          className="w-full flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-xs text-amber-300 border border-amber-500/20 hover:border-amber-500/40 transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>Simulate Inbound</span>
        </button>

        {/* Nav folders */}
        <nav className="space-y-1 pt-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentFolder === item.id;
            const folderData = stats[item.id] || { total: 0, unread: 0 };
            const unread = folderData.unread || 0;

            return (
              <button
                key={item.id}
                onClick={() => onSelectFolder(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-slate-800 text-orange-400 shadow-sm border border-slate-700/50'
                    : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-orange-400' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </div>
                {unread > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30">
                    {unread}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer / Edge Stack info & settings */}
      <div className="p-4 border-t border-slate-800/80 space-y-3">
        <div className="rounded-lg bg-slate-950/60 p-3 border border-slate-800/50 text-[11px] text-slate-400 space-y-1.5">
          <div className="flex justify-between items-center text-slate-300 font-semibold">
            <span>Edge Architecture</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          </div>
          <div className="flex justify-between font-mono">
            <span>Compute</span>
            <span className="text-orange-400">Workers</span>
          </div>
          <div className="flex justify-between font-mono">
            <span>Database</span>
            <span className="text-orange-400">Cloudflare D1</span>
          </div>
          <div className="flex justify-between font-mono">
            <span>Blob Storage</span>
            <span className="text-orange-400">Cloudflare R2</span>
          </div>
        </div>

        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors"
        >
          <Sliders className="w-4 h-4" />
          <span>Settings & Setup Guide</span>
        </button>
      </div>
    </aside>
  );
};
