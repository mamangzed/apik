import { ReactNode, useState } from 'react';
import { useAppStore } from '../../store';
import {
  Globe,
  Settings,
  Shield,
  ShieldOff,
  ChevronDown,
  Plus,
  CheckCircle2,
  Circle,
  Download,
  Cloud,
  HardDrive,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface HeaderProps {
  authControls?: ReactNode;
}

export default function Header({ authControls }: HeaderProps) {
  const {
    environments,
    activeEnvironmentId,
    activateEnvironment,
    interceptEnabled,
    setInterceptEnabled,
    interceptedRequests,
    wsConnected,
    setShowEnvModal,
    setShowInterceptPanel,
    showInterceptPanel,
    openNewTab,
    storageMode,
    isAuthenticated,
  } = useAppStore();

  const [showEnvDropdown, setShowEnvDropdown] = useState(false);
  const activeEnv = environments.find((environment) => environment.id === activeEnvironmentId);
  const pendingCount = interceptedRequests.filter((request) => request.status === 'pending').length;

  const handleInterceptToggle = () => {
    if (!isAuthenticated) {
      toast('Intercept per-user hanya tersedia setelah login');
      return;
    }

    const next = !interceptEnabled;
    setInterceptEnabled(next);
    if (next) {
      toast.success('Intercept enabled. Install the extension to capture browser requests.');
      setShowInterceptPanel(true);
    } else {
      toast('Intercept disabled');
    }
  };

  const handleDownloadExtension = () => {
    const link = document.createElement('a');
    link.href = '/downloads/apik-extension.zip';
    link.download = 'apik-extension.zip';
    link.click();
    toast.success('Extension download started');
  };

  return (
    <header className="flex items-center justify-between px-4 h-12 bg-app-sidebar border-b border-app-border flex-shrink-0 gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div>
          <div className="flex items-center gap-2">
            <div className="text-app-accent font-bold text-lg tracking-tight">APIK</div>
            <a
              href="https://wandahadissuara.id/"
              target="_blank"
              rel="noreferrer"
              className="text-[10px] uppercase tracking-[0.18em] text-app-muted hover:text-app-text"
            >
              created by mamangzed
            </a>
          </div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-app-muted">API Workspace</div>
        </div>
        <span className="text-app-muted text-xs bg-app-active px-1.5 py-0.5 rounded">v{__APP_VERSION__}</span>
      </div>

      <div className="flex items-center gap-2 min-w-0">
        <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded border border-app-border bg-app-panel text-xs text-app-muted">
          {storageMode === 'remote' ? <Cloud size={12} /> : <HardDrive size={12} />}
          {storageMode === 'remote' ? 'Cloud sync' : 'Local storage'}
        </div>

        <button
          onClick={openNewTab}
          className="flex items-center gap-1.5 text-sm text-app-muted hover:text-app-text hover:bg-app-hover px-3 py-1.5 rounded transition-colors"
        >
          <Plus size={14} />
          New Request
        </button>

      </div>

      <div className="flex items-center gap-2">
        <div className="hidden md:flex items-center gap-1.5 text-xs text-app-muted">
          {wsConnected ? (
            <span className="flex items-center gap-1 text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block animate-pulse" />
              Connected
            </span>
          ) : (
            <span className="flex items-center gap-1 text-app-muted">
              <span className="w-1.5 h-1.5 rounded-full bg-app-muted inline-block" />
              Offline
            </span>
          )}
        </div>

        <button
          onClick={handleInterceptToggle}
          disabled={!isAuthenticated}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            interceptEnabled
              ? 'bg-orange-900/50 text-orange-300 border border-orange-700 hover:bg-orange-900/70'
              : 'text-app-muted hover:text-app-text hover:bg-app-hover border border-transparent'
          } ${!isAuthenticated ? 'opacity-50 cursor-not-allowed' : ''}`}
          title={isAuthenticated ? 'Toggle request interception' : 'Login required'}
        >
          {interceptEnabled ? <Shield size={13} /> : <ShieldOff size={13} />}
          Intercept
          {pendingCount > 0 && (
            <span className="bg-orange-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center ml-0.5">
              {pendingCount}
            </span>
          )}
        </button>

        {interceptEnabled && !showInterceptPanel && (
          <button onClick={() => setShowInterceptPanel(true)} className="btn-ghost text-xs">
            Traffic
          </button>
        )}

        <button
          onClick={handleDownloadExtension}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-app-muted hover:text-app-text hover:bg-app-hover border border-transparent transition-colors"
          title="Download browser extension"
        >
          <Download size={13} />
          Extension
        </button>

        <div className="relative">
          <button
            onClick={() => setShowEnvDropdown((value) => !value)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-app-panel border border-app-border rounded text-sm text-app-text hover:border-app-accent transition-colors"
          >
            <Globe size={13} className="text-app-muted" />
            <span className="max-w-28 truncate">{activeEnv?.name ?? 'No Environment'}</span>
            <ChevronDown size={12} className="text-app-muted" />
          </button>
          {showEnvDropdown && (
            <div className="absolute right-0 mt-1 w-52 bg-app-panel border border-app-border rounded shadow-xl z-50">
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-app-hover text-app-muted hover:text-app-text transition-colors"
                onClick={() => {
                  activateEnvironment(null);
                  setShowEnvDropdown(false);
                }}
              >
                <Circle size={13} />
                No Environment
              </button>
              {environments.map((environment) => (
                <button
                  key={environment.id}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-app-hover text-app-text transition-colors"
                  onClick={() => {
                    activateEnvironment(environment.id);
                    setShowEnvDropdown(false);
                  }}
                >
                  {environment.id === activeEnvironmentId ? (
                    <CheckCircle2 size={13} className="text-app-accent" />
                  ) : (
                    <Circle size={13} className="text-app-muted" />
                  )}
                  {environment.name}
                </button>
              ))}
              <div className="border-t border-app-border mt-1 pt-1 pb-1">
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-app-hover text-app-muted transition-colors"
                  onClick={() => {
                    setShowEnvModal(true);
                    setShowEnvDropdown(false);
                  }}
                >
                  <Settings size={13} />
                  Manage Environments
                </button>
              </div>
            </div>
          )}
        </div>

        {authControls}
      </div>
    </header>
  );
}