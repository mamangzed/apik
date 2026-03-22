import { ReactNode, useEffect, useState } from 'react';
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
  }, [tabs, activeTabId, sendRequest, openNewTab, closeTab, showInterceptPanel]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-app-bg">
      <Toaster
        position="top-right"
        toastOptions={{
          style: { background: '#22272e', color: '#cdd9e5', border: '1px solid #30363d' },
        }}
      />
      <Header authControls={authControls} />
      <div className="flex flex-1 overflow-hidden">
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
      </div>

      {showEnvModal && <EnvironmentModal />}
      {showDocViewer && docViewerCollection && <DocViewer collectionId={docViewerCollection} />}
      {showImportModal && <ImportModal />}
      {showShareModal && <ShareModal />}
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
      <div className="flex items-center gap-2">
        <Link to="/sign-in" className="btn-ghost text-xs">Login</Link>
        <Link to="/sign-up" className="btn-primary text-xs py-1">Register</Link>
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