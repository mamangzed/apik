import { useEffect, useState } from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { useAppStore } from '../../store';
import UrlBar from './UrlBar';
import RequestTabs from './RequestTabs';
import ResponseViewer from '../ResponseViewer';

export default function RequestPanel() {
  const { activeTabId } = useAppStore();
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!activeTabId) return null;

  if (isMobile) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden min-h-0">
        <UrlBar />
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="min-h-0 flex-[1_1_56%] border-b border-app-border">
            <RequestTabs />
          </div>
          <div className="min-h-0 flex-[1_1_44%]">
            <ResponseViewer />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <UrlBar />
      <PanelGroup direction="vertical" id="request-response">
        <Panel id="request" defaultSize={45} minSize={25}>
          <RequestTabs />
        </Panel>
        <PanelResizeHandle className="h-1 bg-app-border hover:bg-app-accent transition-colors cursor-row-resize" />
        <Panel id="response" defaultSize={55} minSize={20}>
          <ResponseViewer />
        </Panel>
      </PanelGroup>
    </div>
  );
}
