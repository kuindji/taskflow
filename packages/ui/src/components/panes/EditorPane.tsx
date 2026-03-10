import { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import { useFileStore } from '@/stores/file-store';
import { Button } from '@/components/ui/button';

interface EditorPaneProps {
  filePath: string;
}

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  json: 'json', md: 'markdown', css: 'css', html: 'html',
  py: 'python', rs: 'rust', go: 'go', yml: 'yaml', yaml: 'yaml',
  toml: 'ini', sh: 'shell', bash: 'shell',
};

function getLanguage(path: string): string {
  const ext = path.split('.').pop() ?? '';
  return EXT_TO_LANGUAGE[ext] ?? 'plaintext';
}

function EditorPane({ filePath }: EditorPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const { readFile, writeFile } = useFileStore();
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const editor = monaco.editor.create(containerRef.current, {
      theme: 'vs-dark',
      language: getLanguage(filePath),
      minimap: { enabled: false },
      fontSize: 13,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      readOnly: false,
    });

    editorRef.current = editor;

    void readFile(filePath).then((content) => {
      editor.setValue(content);
      setDirty(false);
      setLoading(false);
    }).catch((err: unknown) => {
      console.error('Failed to read file:', err);
      setLoading(false);
    });

    const changeDisposable = editor.onDidChangeModelContent(() => {
      setDirty(true);
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () => {
      try {
        await writeFile(filePath, editor.getValue());
        setDirty(false);
      } catch (err: unknown) {
        console.error('Failed to save file:', err);
      }
    });

    return () => {
      changeDisposable.dispose();
      editor.dispose();
    };
  }, [filePath, readFile, writeFile]);

  return (
    <div className="flex-1 relative">
      {dirty && (
        <Button
          size="sm"
          className="absolute top-2 right-2 z-10"
          onClick={async () => {
            if (!editorRef.current) return;
            try {
              await writeFile(filePath, editorRef.current.getValue());
              setDirty(false);
            } catch (err: unknown) {
              console.error('Failed to save file:', err);
            }
          }}
        >
          Save
        </Button>
      )}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground z-[1]">
          Loading...
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}

export { EditorPane };
export type { EditorPaneProps };
