import type { Tab } from '@/stores/session-store';

interface TabContentProps { tabs: Tab[]; activeTabId: string; }

export function TabContent({ tabs, activeTabId }: TabContentProps) {
  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!activeTab) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground">No active tab. Create a session with +</div>;
  }
  // Placeholder — replaced with real pane components in Chunk 7
  return (
    <div className="flex-1 p-3 text-secondary-foreground">
      <p>Tab: {activeTab.label} ({activeTab.type})</p>
      {activeTab.sessionId && <p>Session: {activeTab.sessionId}</p>}
      {activeTab.filePath && <p>File: {activeTab.filePath}</p>}
      {activeTab.url && <p>URL: {activeTab.url}</p>}
    </div>
  );
}
