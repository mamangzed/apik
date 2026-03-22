import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Unknown render error',
    };
  }

  componentDidCatch(error: unknown) {
    console.error('[App] Unhandled render error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', background: '#0f172a', color: '#cbd5e1', display: 'grid', placeItems: 'center', padding: 24 }}>
          <div style={{ maxWidth: 720, width: '100%', border: '1px solid #334155', borderRadius: 10, padding: 20, background: '#111827' }}>
            <h1 style={{ margin: 0, fontSize: 20 }}>App failed to render</h1>
            <p style={{ opacity: 0.85, marginTop: 8 }}>
              A runtime error occurred. Open browser devtools console to see full details.
            </p>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#0b1220', padding: 12, borderRadius: 8, border: '1px solid #1f2937' }}>
              {this.state.message}
            </pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

async function resolveClerkPublishableKey(): Promise<string> {
  const fromBuild = String(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '').trim();
  if (fromBuild) {
    return fromBuild;
  }

  try {
    const response = await fetch('/api/public/runtime-config', {
      method: 'GET',
      credentials: 'same-origin',
    });
    if (!response.ok) {
      return '';
    }

    const payload = (await response.json()) as { clerkPublishableKey?: string };
    return String(payload.clerkPublishableKey || '').trim();
  } catch {
    return '';
  }
}

async function bootstrapApp() {
  const clerkPublishableKey = await resolveClerkPublishableKey();

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <AppErrorBoundary>
        {clerkPublishableKey ? (
          <ClerkProvider publishableKey={clerkPublishableKey}>
            <BrowserRouter>
              <App clerkEnabled />
            </BrowserRouter>
          </ClerkProvider>
        ) : (
          <BrowserRouter>
            <App clerkEnabled={false} />
          </BrowserRouter>
        )}
      </AppErrorBoundary>
    </React.StrictMode>
  );
}

bootstrapApp().catch((error) => {
  console.error('[App] Failed to bootstrap:', error);
});
