import { ReactNode, useEffect, useState } from 'react';
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
  Menu,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface HeaderProps {
  authControls?: ReactNode;
  showMobileSidebarToggle?: boolean;
  isMobileSidebarOpen?: boolean;
  onToggleMobileSidebar?: () => void;
}

const REQUIRED_BRAND_HREF = 'https://wandahadissuara.id/';
const REQUIRED_BRAND_TEXT = 'created by mamangzed';
const BUILD_BRAND_HREF = String((import.meta.env as Record<string, unknown>).VITE_BRAND_HREF || '').trim();
const BUILD_BRAND_TEXT = String((import.meta.env as Record<string, unknown>).VITE_BRAND_TEXT || '').trim().toLowerCase();

export default function Header({
  authControls,
  showMobileSidebarToggle = false,
  isMobileSidebarOpen = false,
  onToggleMobileSidebar,
}: HeaderProps) {
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
  const [brandingTampered, setBrandingTampered] = useState(false);
  const activeEnv = environments.find((environment) => environment.id === activeEnvironmentId);
  const pendingCount = interceptedRequests.filter((request) => request.status === 'pending').length;

  useEffect(() => {
    const verifyBranding = () => {
      const envOverrideInvalid =
        (BUILD_BRAND_HREF && BUILD_BRAND_HREF !== REQUIRED_BRAND_HREF) ||
        (BUILD_BRAND_TEXT && BUILD_BRAND_TEXT !== REQUIRED_BRAND_TEXT);
      if (envOverrideInvalid) {
        setBrandingTampered(true);
        return;
      }

      const anchor = document.querySelector('[data-apik-brand-link="true"]') as HTMLAnchorElement | null;
      if (!anchor) {
        setBrandingTampered(true);
        return;
      }

      const href = (anchor.getAttribute('href') || '').trim();
      const text = (anchor.textContent || '').trim().toLowerCase();
      if (href !== REQUIRED_BRAND_HREF || text !== REQUIRED_BRAND_TEXT) {
        setBrandingTampered(true);
      }
    };

    verifyBranding();

    const observer = new MutationObserver(() => {
      verifyBranding();
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['href'],
    });

    const timer = window.setInterval(verifyBranding, 1000);

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

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
    <>
      {brandingTampered && (
        <div className="fixed inset-0 z-[10000] bg-black text-red-200 flex items-center justify-center p-6">
          <div className="w-full max-w-2xl border-2 border-red-500 bg-black p-6 rounded-lg shadow-2xl">
            <h1 className="text-2xl font-bold text-red-400">BRANDING PROTECTION TRIGGERED</h1>
            <p className="mt-4 text-sm leading-relaxed text-red-100">
              This build is protected. Branding text and link are mandatory and cannot be modified.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-red-100">
              Required text: <strong>{REQUIRED_BRAND_TEXT}</strong>
            </p>
            <p className="mt-1 text-sm leading-relaxed text-red-100">
              Required href: <strong>{REQUIRED_BRAND_HREF}</strong>
            </p>
            <p className="mt-4 text-sm leading-relaxed text-red-300">
              Application is blocked until branding values are restored.
            </p>
          </div>
        </div>
      )}

      <header className="flex flex-wrap items-center justify-between px-3 sm:px-4 py-2 sm:h-12 bg-app-sidebar border-b border-app-border flex-shrink-0 gap-2 sm:gap-4">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        {showMobileSidebarToggle && (
          <button
            type="button"
            onClick={onToggleMobileSidebar}
            className="p-1.5 rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover"
            aria-label={isMobileSidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          >
            {isMobileSidebarOpen ? <X size={15} /> : <Menu size={15} />}
          </button>
        )}
        <div>
          <div className="flex items-center gap-2">
            <div className="text-app-accent font-bold text-lg tracking-tight">APIK</div>
            <a
              data-apik-brand-link="true"
              href={REQUIRED_BRAND_HREF}
              target="_blank"
              rel="noreferrer"
              className="hidden sm:inline text-[10px] uppercase tracking-[0.18em] text-app-muted hover:text-app-text"
            >
              {REQUIRED_BRAND_TEXT}
            </a>
          </div>
          <div className="hidden sm:block text-[10px] uppercase tracking-[0.25em] text-app-muted">API Workspace</div>
        </div>
        <span className="hidden sm:inline text-app-muted text-xs bg-app-active px-1.5 py-0.5 rounded">v{__APP_VERSION__}</span>
      </div>

      <div className="flex items-center gap-1 sm:gap-2 min-w-0 order-3 sm:order-none w-full sm:w-auto">
        <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded border border-app-border bg-app-panel text-xs text-app-muted">
          {storageMode === 'remote' ? <Cloud size={12} /> : <HardDrive size={12} />}
          {storageMode === 'remote' ? 'Cloud sync' : 'Local storage'}
        </div>

        <button
          onClick={openNewTab}
          className="flex items-center gap-1.5 text-xs sm:text-sm text-app-muted hover:text-app-text hover:bg-app-hover px-2 sm:px-3 py-1.5 rounded transition-colors"
        >
          <Plus size={14} />
          <span className="hidden sm:inline">New Request</span>
          <span className="sm:hidden max-[420px]:hidden">New</span>
        </button>

      </div>

      <div className="flex items-center gap-1 sm:gap-2 ml-auto sm:ml-0 min-w-0 flex-wrap justify-end order-2 sm:order-none">
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
          className={`flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            interceptEnabled
              ? 'bg-orange-900/50 text-orange-300 border border-orange-700 hover:bg-orange-900/70'
              : 'text-app-muted hover:text-app-text hover:bg-app-hover border border-transparent'
          } ${!isAuthenticated ? 'opacity-50 cursor-not-allowed' : ''}`}
          title={isAuthenticated ? 'Toggle request interception' : 'Login required'}
        >
          {interceptEnabled ? <Shield size={13} /> : <ShieldOff size={13} />}
          <span className="hidden sm:inline">Intercept</span>
          {pendingCount > 0 && (
            <span className="bg-orange-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center ml-0.5">
              {pendingCount}
            </span>
          )}
        </button>

        {interceptEnabled && !showInterceptPanel && (
          <button onClick={() => setShowInterceptPanel(true)} className="btn-ghost text-xs max-[420px]:hidden">
            Traffic
          </button>
        )}

        <button
          onClick={handleDownloadExtension}
          className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded text-xs font-medium text-app-muted hover:text-app-text hover:bg-app-hover border border-transparent transition-colors max-[420px]:hidden"
          title="Download browser extension"
        >
          <Download size={13} />
          <span className="hidden sm:inline">Extension</span>
        </button>

        <div className="relative">
          <button
            onClick={() => setShowEnvDropdown((value) => !value)}
            className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 bg-app-panel border border-app-border rounded text-xs sm:text-sm text-app-text hover:border-app-accent transition-colors"
          >
            <Globe size={13} className="text-app-muted" />
            <span className="max-w-12 sm:max-w-28 truncate">{activeEnv?.name ?? 'No Environment'}</span>
            <ChevronDown size={12} className="text-app-muted max-[420px]:hidden" />
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

        <div className="flex-shrink-0">{authControls}</div>
      </div>
      </header>
    </>
  );
}