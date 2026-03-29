import { ReactNode, useEffect, useRef, useState } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import { SignIn, SignUp, UserButton, useAuth } from '@clerk/react';
import { Toaster } from 'react-hot-toast';
import toast from 'react-hot-toast';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { setApiTokenGetter } from './lib/apiClient';
import { useAppStore } from './store';
import Sidebar from './components/Layout/Sidebar';
import Header from './components/Layout/Header';
import TabBar from './components/Layout/TabBar';
import RequestPanel from './components/RequestBuilder';
import WelcomeScreen from './components/Layout/WelcomeScreen';
import EnvironmentModal from './components/Environment/EnvModal';
import InterceptPanel from './components/Intercept/InterceptPanel';
import DocViewer from './components/ApiDoc/DocViewer';
import ImportModal from './components/Collections/ImportModal';
import ShareModal from './components/Sharing/ShareModal';
import PublicCollectionPage from './components/Public/PublicCollectionPage';
import PublicDocsPage from './components/Public/PublicDocsPage';

interface AppProps {
  clerkEnabled: boolean;
}

const DONATION_LINKS = {
  kofi: 'https://ko-fi.com/mamangzed',
  saweria: 'https://saweria.co/zedkntl',
};

const DONATION_BADGES = {
  kofi: 'https://img.shields.io/badge/Ko--fi-Support%20Me-ff5e5b?logo=ko-fi&logoColor=white',
  saweria: 'https://img.shields.io/badge/Saweria-Dukung%20Saya-f97316?logo=buymeacoffee&logoColor=white',
};

function AuthConfigMissingPage() {
  return (
    <div className="min-h-screen bg-app-bg text-app-text flex items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-lg border border-app-border bg-app-secondary p-6">
        <h1 className="text-lg font-semibold mb-2">Authentication is not configured</h1>
        <p className="text-sm text-app-muted mb-2">
          This deployment is running in guest mode because Clerk publishable key is missing.
        </p>
        <p className="text-sm text-app-muted">
          Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> in <code>frontend/.env</code>, rebuild, and restart the backend service.
        </p>
      </div>
    </div>
  );
}

function AppShell({ authControls, autoLoad = true }: { authControls: ReactNode; autoLoad?: boolean }) {
  const {
    loadCollections,
    loadEnvironments,
    tabs,
    activeTabId,
    sendRequest,
    openNewTab,
    closeTab,
    showEnvModal,
    showInterceptPanel,
    showDocViewer,
    docViewerCollection,
    showImportModal,
    showShareModal,
    storageMode,
    authReady,
    isAuthenticated,
    userId,
  } = useAppStore();
  const [showDonationModal, setShowDonationModal] = useState(true);
  const [donationModalEntered, setDonationModalEntered] = useState(false);
  const [isMobileLayout, setIsMobileLayout] = useState(() => window.innerWidth < 1024);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileSidebarMounted, setMobileSidebarMounted] = useState(false);
  const mobileSidebarRef = useRef<HTMLDivElement | null>(null);
  const mobileSidebarTouchStartXRef = useRef<number | null>(null);
  const mobileSidebarTouchStartYRef = useRef<number | null>(null);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobileLayout(mobile);
      if (!mobile) {
        setMobileSidebarOpen(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    if (!isMobileLayout) {
      setMobileSidebarMounted(false);
      return;
    }

    if (mobileSidebarOpen) {
      setMobileSidebarMounted(true);
      return;
    }

    const timer = window.setTimeout(() => {
      setMobileSidebarMounted(false);
    }, 220);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isMobileLayout, mobileSidebarOpen]);

  useEffect(() => {
    if (!isMobileLayout || !mobileSidebarOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobileLayout, mobileSidebarOpen]);

  useEffect(() => {
    if (!isMobileLayout || !mobileSidebarOpen || !mobileSidebarRef.current) {
      return;
    }

    const drawer = mobileSidebarRef.current;
    drawer.focus();

    const handleTrapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') {
        return;
      }

      const focusable = drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );

      if (!focusable.length) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement as HTMLElement | null;

      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleTrapFocus);
    return () => {
      document.removeEventListener('keydown', handleTrapFocus);
    };
  }, [isMobileLayout, mobileSidebarOpen]);

  useEffect(() => {
    if (!showDonationModal) {
      setDonationModalEntered(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setDonationModalEntered(true);
    }, 10);

    return () => {
      window.clearTimeout(timer);
    };
  }, [showDonationModal]);

  const executeSave = async (collectionId: string, requestId: string) => {
    const state = useAppStore.getState();
    const active = state.tabs.find((tab) => tab.id === state.activeTabId);
    if (!active || active.requestState.request.id !== requestId) {
      toast.error('Active tab changed before save. Try again.');
      return;
    }

    try {
      const saveScope = await state.updateRequestInCollection(collectionId, active.requestState.request);
      if (saveScope === 'remote') {
        toast.success('Saved');
      } else {
        toast('Saved locally (not synced to backend)', { icon: 'ℹ️' });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Save failed';
      if (/do not have edit access/i.test(message)) {
        toast(message, { icon: 'ℹ️' });
      } else {
        toast.error(`Failed to save: ${message}`);
      }
    }
  };

  useEffect(() => {
    const handleExtensionState = (event: Event) => {
      const customEvent = event as CustomEvent<{ scopeId?: string | null }>;
      const scopeId = customEvent.detail?.scopeId;
      if (typeof scopeId !== 'string' || !scopeId) {
        return;
      }

      try {
        localStorage.setItem('apik.ws.scopeId', scopeId);
      } catch {
        // Ignore storage limitations in restricted contexts.
      }
    };

    window.addEventListener('__apix_state__', handleExtensionState as EventListener);
    return () => {
      window.removeEventListener('__apix_state__', handleExtensionState as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!autoLoad) {
      return;
    }

    const hydrate = async () => {
      await Promise.all([loadCollections(), loadEnvironments()]);
    };

    hydrate().catch((error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to load data');
    });
  }, [autoLoad, loadCollections, loadEnvironments]);

  useEffect(() => {
    const handleRemoteDataChanged = () => {
      const state = useAppStore.getState();
      if (!state.authReady || state.storageMode !== 'remote') {
        return;
      }

      Promise.all([state.loadCollections(), state.loadEnvironments()]).catch(() => {
        // Best effort sync when data changes from extension.
      });
    };

    window.addEventListener('__apix_remote_data_changed__', handleRemoteDataChanged);
    return () => {
      window.removeEventListener('__apix_remote_data_changed__', handleRemoteDataChanged);
    };
  }, [storageMode, authReady]);

  useEffect(() => {
    const blockContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    const handleShortcut = async (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const ctrlOrMeta = event.ctrlKey || event.metaKey;

      if (showDonationModal) {
        if (key === 'escape') {
          event.preventDefault();
          setShowDonationModal(false);
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }

      if (isMobileLayout && mobileSidebarOpen && key === 'escape') {
        event.preventDefault();
        setMobileSidebarOpen(false);
        return;
      }

      if (key === 'f5' || key === 'f12' || (event.altKey && (key === 'arrowleft' || key === 'arrowright'))) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }

      if (ctrlOrMeta && event.shiftKey && (key === 'c' || key === 'i' || key === 'j')) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }

      // Browser often reserves Ctrl+T and may ignore preventDefault.
      // Provide reliable alternatives for creating a new request.
      if ((ctrlOrMeta && key === 'k') || (!ctrlOrMeta && event.altKey && key === 'n')) {
        event.preventDefault();
        openNewTab();
        return;
      }

      if (!ctrlOrMeta) {
        return;
      }

      if (key === 'a' || key === 'c' || key === 'x' || key === 'v' || key === 'z' || key === 'y') {
        return;
      }

      if (key === 'f') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('__apix_find__'));
        return;
      }

      const activeTab = tabs.find((tab) => tab.id === activeTabId);

      if (showInterceptPanel) {
        if (key === 'w') {
          event.preventDefault();
          useAppStore.getState().setShowInterceptPanel(false);
        } else if (key === 'f') {
          event.preventDefault();
          window.dispatchEvent(new CustomEvent('__apix_find__'));
        }
        return;
      }

      if (key === 's') {
        event.preventDefault();
        if (!activeTab?.requestState.collectionId) {
          toast('Open a collection request to save', { icon: 'ℹ️' });
          return;
        }
        await executeSave(activeTab.requestState.collectionId, activeTab.requestState.request.id);
        return;
      }

      if (key === 'enter') {
        event.preventDefault();
        if (activeTabId) {
          await sendRequest(activeTabId);
        }
        return;
      }

      if (key === 'n' || key === 't') {
        event.preventDefault();
        openNewTab();
        return;
      }

      if (key === 'w') {
        event.preventDefault();
        if (activeTabId) {
          closeTab(activeTabId);
        }
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    window.addEventListener('contextmenu', blockContextMenu);
    document.addEventListener('keydown', handleShortcut, true);

    return () => {
      window.removeEventListener('contextmenu', blockContextMenu);
      document.removeEventListener('keydown', handleShortcut, true);
    };
  }, [tabs, activeTabId, sendRequest, openNewTab, closeTab, showInterceptPanel, showDonationModal, isMobileLayout, mobileSidebarOpen]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-app-bg">
      <Toaster
        position="top-right"
        toastOptions={{
          style: { background: '#22272e', color: '#cdd9e5', border: '1px solid #30363d' },
        }}
      />
      <Header
        authControls={authControls}
        showMobileSidebarToggle={isMobileLayout}
        isMobileSidebarOpen={mobileSidebarOpen}
        onToggleMobileSidebar={() => setMobileSidebarOpen((value) => !value)}
      />
      <div className="flex flex-1 overflow-hidden">
        {isMobileLayout ? (
          <>
            <div className="flex flex-col h-full w-full">
              <TabBar />
              {showInterceptPanel ? <InterceptPanel /> : (activeTabId ? <RequestPanel /> : <WelcomeScreen />)}
            </div>
            {mobileSidebarMounted && (
              <>
                <button
                  type="button"
                  aria-label="Close sidebar"
                  className={`fixed inset-0 z-40 bg-black/55 transition-opacity duration-200 ${mobileSidebarOpen ? 'opacity-100' : 'opacity-0'}`}
                  onClick={() => setMobileSidebarOpen(false)}
                />
                <div
                  ref={mobileSidebarRef}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Sidebar"
                  tabIndex={-1}
                  onTouchStart={(event) => {
                    mobileSidebarTouchStartXRef.current = event.touches[0]?.clientX ?? null;
                    mobileSidebarTouchStartYRef.current = event.touches[0]?.clientY ?? null;
                  }}
                  onTouchEnd={(event) => {
                    const startX = mobileSidebarTouchStartXRef.current;
                    const startY = mobileSidebarTouchStartYRef.current;
                    const endX = event.changedTouches[0]?.clientX;
                    const endY = event.changedTouches[0]?.clientY;
                    mobileSidebarTouchStartXRef.current = null;
                    mobileSidebarTouchStartYRef.current = null;

                    if (
                      typeof startX !== 'number'
                      || typeof startY !== 'number'
                      || typeof endX !== 'number'
                      || typeof endY !== 'number'
                    ) {
                      return;
                    }

                    const deltaX = endX - startX;
                    const deltaY = endY - startY;
                    const horizontalSwipe = Math.abs(deltaX) > Math.abs(deltaY) * 1.2;

                    if (horizontalSwipe && deltaX < -60 && Math.abs(deltaY) < 42) {
                      setMobileSidebarOpen(false);
                    }
                  }}
                  onClickCapture={(event) => {
                    const target = event.target as HTMLElement | null;
                    if (!target) {
                      return;
                    }

                    if (target.closest('a,button')) {
                      setMobileSidebarOpen(false);
                    }
                  }}
                  className={`fixed left-0 top-12 bottom-0 z-50 w-[86vw] max-w-sm border-r border-app-border bg-app-sidebar shadow-2xl transition-transform duration-200 ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
                >
                  <Sidebar />
                </div>
              </>
            )}
          </>
        ) : (
          <PanelGroup direction="horizontal" id="main-layout">
            <Panel id="sidebar" defaultSize={20} minSize={14} maxSize={35}>
              <Sidebar />
            </Panel>
            <PanelResizeHandle className="w-1 bg-app-border hover:bg-app-accent transition-colors cursor-col-resize" />
            <Panel id="main" defaultSize={80}>
              <div className="flex flex-col h-full">
                <TabBar />
                {showInterceptPanel ? <InterceptPanel /> : (activeTabId ? <RequestPanel /> : <WelcomeScreen />)}
              </div>
            </Panel>
          </PanelGroup>
        )}
      </div>

      {showEnvModal && <EnvironmentModal />}
      {showDocViewer && docViewerCollection && <DocViewer collectionId={docViewerCollection} />}
      {showImportModal && <ImportModal />}
      {showShareModal && <ShareModal />}
      {showDonationModal && (
        <div
          className={`fixed inset-0 z-[100] flex items-center justify-center bg-[#0b1017]/80 backdrop-blur-sm p-4 transition-opacity duration-200 ${donationModalEntered ? 'opacity-100' : 'opacity-0'}`}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="donation-modal-title"
            className={`w-full max-w-lg overflow-hidden rounded-2xl border border-app-border bg-app-panel shadow-2xl transition-all duration-200 ${donationModalEntered ? 'translate-y-0 scale-100' : 'translate-y-2 scale-[0.98]'}`}
          >
            <div className="bg-gradient-to-r from-app-accent/20 via-transparent to-[#f97316]/20 px-5 sm:px-6 py-5 border-b border-app-border">
              <p className="text-[10px] sm:text-[11px] tracking-[0.16em] uppercase text-app-muted">Open Source Support</p>
              <h2 id="donation-modal-title" className="mt-1 text-lg sm:text-xl font-semibold text-app-text">
                Keep APIK Free for Everyone
              </h2>
              <p className="mt-2 text-[12px] sm:text-sm text-app-muted">
                Thanks for using APIK. Your support helps maintain updates, fixes, and new features for the open source community.
              </p>
            </div>

            <div className="px-5 sm:px-6 py-5 space-y-3">
              <a
                href={DONATION_LINKS.kofi}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center justify-between rounded-xl border border-app-border bg-app-secondary px-4 py-3 hover:border-app-accent transition-colors"
              >
                <div>
                  <p className="text-[13px] sm:text-sm font-medium text-app-text">Donate via Ko-fi</p>
                  <p className="text-[11px] sm:text-xs text-app-muted">Quick one-time support</p>
                </div>
                <img src={DONATION_BADGES.kofi} alt="Ko-fi logo" className="h-7" />
              </a>

              <a
                href={DONATION_LINKS.saweria}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center justify-between rounded-xl border border-app-border bg-app-secondary px-4 py-3 hover:border-[#f97316] transition-colors"
              >
                <div>
                  <p className="text-[13px] sm:text-sm font-medium text-app-text">Donate via Saweria</p>
                  <p className="text-[11px] sm:text-xs text-app-muted">Support in local payment methods</p>
                </div>
                <img src={DONATION_BADGES.saweria} alt="Saweria logo" className="h-7" />
              </a>
            </div>

            <div className="flex items-center justify-end border-t border-app-border bg-app-secondary/40 px-5 sm:px-6 py-4">
              <button type="button" className="btn-primary text-[12px] sm:text-sm" onClick={() => setShowDonationModal(false)}>
                Continue to App
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LocalOnlyShell() {
  const { setAuthState } = useAppStore();

  useEffect(() => {
    setApiTokenGetter(async () => null);
    setAuthState({ authReady: true, isAuthenticated: false, userId: null });
  }, [setAuthState]);

  return <AppShell authControls={<span className="text-xs text-app-muted">Guest mode · local storage</span>} />;
}

function ClerkControls() {
  const { isSignedIn } = useAuth();

  if (!isSignedIn) {
    return (
      <div className="flex items-center gap-1 sm:gap-2">
          <Link to="/sign-in" className="btn-ghost text-[10px] sm:text-xs px-1.5 sm:px-2.5 py-1 max-[420px]:hidden">Sign in</Link>
          <Link to="/sign-up" className="btn-primary text-[10px] sm:text-xs py-1 px-2 sm:px-3">Join</Link>
      </div>
    );
  }

  return <UserButton />;
}

function ClerkShell() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const { setAuthState, syncLocalDataToRemote, loadCollections, loadEnvironments } = useAppStore();

  const publishExtensionAuthToken = (token: string | null) => {
    window.postMessage(
      {
        source: 'apik-web',
        type: 'APIK_AUTH_TOKEN',
        token,
      },
      window.location.origin,
    );
  };

  useEffect(() => {
    setApiTokenGetter(async () => {
      if (!isLoaded || !isSignedIn) {
        return null;
      }
      return getToken();
    });
  }, [getToken, isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    let cancelled = false;

    const pushTokenToExtension = async () => {
      try {
        const token = isSignedIn ? await getToken() : null;
        if (!cancelled) {
          publishExtensionAuthToken(token ?? null);
        }
      } catch {
        if (!cancelled && !isSignedIn) {
          publishExtensionAuthToken(null);
        }
      }
    };

    pushTokenToExtension();
    const timer = window.setInterval(pushTokenToExtension, 15_000);
    const onWindowFocus = () => {
      void pushTokenToExtension();
    };
    const onVisibilityChange = () => {
      if (!document.hidden) {
        void pushTokenToExtension();
      }
    };
    window.addEventListener('focus', onWindowFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onWindowFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [getToken, isLoaded, isSignedIn]);

  useEffect(() => {
    setAuthState({ authReady: isLoaded, isAuthenticated: Boolean(isSignedIn), userId: userId || null });
    if (!isLoaded) {
      return;
    }

    const hydrate = async () => {
      if (isSignedIn) {
        await syncLocalDataToRemote();
      }
      await Promise.all([loadCollections(), loadEnvironments()]);
    };

    hydrate().catch((error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to sync account');
    });
  }, [isLoaded, isSignedIn, userId, setAuthState, syncLocalDataToRemote, loadCollections, loadEnvironments]);

  return <AppShell authControls={<ClerkControls />} autoLoad={false} />;
}

export default function App({ clerkEnabled }: AppProps) {
  return (
    <Routes>
      <Route path="/share/collections/:token" element={<PublicCollectionPage />} />
      <Route path="/share/docs/:token" element={<PublicDocsPage />} />
      <Route path="/share/forms/:token" element={<PublicCollectionPage shareMode="form" />} />
      <Route
        path="/sign-in/*"
        element={
          clerkEnabled ? (
            <div className="min-h-screen bg-app-bg flex items-center justify-center p-6">
              <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" forceRedirectUrl="/" />
            </div>
          ) : (
            <AuthConfigMissingPage />
          )
        }
      />
      <Route
        path="/sign-up/*"
        element={
          clerkEnabled ? (
            <div className="min-h-screen bg-app-bg flex items-center justify-center p-6">
              <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" forceRedirectUrl="/" />
            </div>
          ) : (
            <AuthConfigMissingPage />
          )
        }
      />
      <Route path="*" element={clerkEnabled ? <ClerkShell /> : <LocalOnlyShell />} />
    </Routes>
  );
}