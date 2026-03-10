import { useMemo } from 'react';
import { cva } from 'class-variance-authority';
import type { Tab } from '@/stores/session-store';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { X, Plus, Terminal, Code, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

const tabVariants = cva(
  'px-2 py-0.5 rounded-sm cursor-pointer flex items-center gap-1 text-[11px] transition-colors',
  {
    variants: {
      type: { claude: 'text-success', codex: 'text-warning', editor: 'text-muted-foreground', changes: 'text-muted-foreground', browser: 'text-muted-foreground' },
      active: { true: 'bg-muted', false: 'bg-transparent hover:bg-muted/50' },
    },
    defaultVariants: { type: 'editor', active: false },
  },
);

interface TabItemProps {
  tab: Tab;
  isActive: boolean;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
}

function TabItem({ tab, isActive, onTabClick, onTabClose }: TabItemProps) {
  const classes = useMemo(
    () => cn(tabVariants({ type: tab.type, active: isActive })),
    [tab.type, isActive],
  );

  return (
    <div onClick={() => onTabClick(tab.id)} className={classes}>
      <span>{tab.label}</span>
      <Button variant="ghost" size="icon-sm" className="h-4 w-4 ml-0.5" onClick={(e) => { e.stopPropagation(); onTabClose(tab.id); }}>
        <X className="h-2.5 w-2.5" />
      </Button>
    </div>
  );
}

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onNewTab: (type: 'claude' | 'codex' | 'changes' | 'browser') => void;
}

export function TabBar({ tabs, activeTabId, onTabClick, onTabClose, onNewTab }: TabBarProps) {
  return (
    <div className="px-2 py-0.5 bg-card flex gap-0.5 border-b border-border items-center">
      {tabs.map((tab) => (
        <TabItem key={tab.id} tab={tab} isActive={tab.id === activeTabId} onTabClick={onTabClick} onTabClose={onTabClose} />
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm"><Plus className="h-3 w-3" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => onNewTab('claude')}><Terminal className="h-3.5 w-3.5 mr-2" />Claude Code</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onNewTab('codex')}><Code className="h-3.5 w-3.5 mr-2" />Codex</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onNewTab('changes')}><Code className="h-3.5 w-3.5 mr-2" />Changes</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onNewTab('browser')}><Globe className="h-3.5 w-3.5 mr-2" />Browser</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
