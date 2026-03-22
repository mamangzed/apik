import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { useAppStore } from '../../store';
import UrlBar from './UrlBar';
import RequestTabs from './RequestTabs';
import ResponseViewer from '../ResponseViewer';

export default function RequestPanel() {
  const { activeTabId } = useAppStore();

  if (!activeTabId) return null;

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
