interface HistoryPaneProps {
    repoPath: string;
}

function HistoryPane({ repoPath }: HistoryPaneProps) {
    return <div className="text-muted-foreground p-3 text-sm">History for {repoPath}</div>;
}

export { HistoryPane };
