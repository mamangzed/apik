import { useAppStore } from '../../store';
import { Zap, FolderOpen, Globe } from 'lucide-react';

export default function WelcomeScreen() {
  const { openNewTab, collections, setShowEnvModal } = useAppStore();

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 bg-app-bg">
      <div className="text-center">
        <div className="flex items-center justify-center gap-3 mb-3">
          <span className="text-5xl font-bold text-app-accent tracking-tight">APIK</span>
        </div>
        <p className="text-app-muted text-base">Modern API Client & Documentation Tool</p>
      </div>

      <div className="grid grid-cols-3 gap-4 w-full max-w-xl px-8">
        <ActionCard
          icon={<Zap size={20} className="text-app-accent" />}
          title="New Request"
          description="Create a new API request"
          onClick={openNewTab}
        />
        <ActionCard
          icon={<FolderOpen size={20} className="text-app-accent" />}
          title={`${collections.length} Collections`}
          description="Browse your collections"
          onClick={() => {}}
        />
        <ActionCard
          icon={<Globe size={20} className="text-app-accent" />}
          title="Environments"
          description="Manage variables"
          onClick={() => setShowEnvModal(true)}
        />
      </div>

      <div className="text-app-muted text-sm">
        Press <kbd className="bg-app-panel border border-app-border px-1.5 py-0.5 rounded text-xs">Ctrl+K</kbd> or <kbd className="bg-app-panel border border-app-border px-1.5 py-0.5 rounded text-xs">Alt+N</kbd> for new request
        {' · '}
        <kbd className="bg-app-panel border border-app-border px-1.5 py-0.5 rounded text-xs">Ctrl+Enter</kbd> to send
        {' · '}
        <kbd className="bg-app-panel border border-app-border px-1.5 py-0.5 rounded text-xs">Ctrl+S</kbd> to save
      </div>
    </div>
  );
}

function ActionCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 p-4 bg-app-panel border border-app-border rounded-lg hover:border-app-accent hover:bg-app-hover transition-all text-center group"
    >
      <div className="p-2 bg-app-active rounded-lg group-hover:bg-app-accent/20 transition-colors">
        {icon}
      </div>
      <span className="text-sm font-medium text-app-text">{title}</span>
      <span className="text-xs text-app-muted">{description}</span>
    </button>
  );
}
