import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RotateCw } from 'lucide-react';

interface BrowserPaneProps {
  initialUrl: string;
}

function BrowserPane({ initialUrl }: BrowserPaneProps) {
  const [url, setUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const webviewRef = useRef<WebviewElement | null>(null);

  useEffect(() => {
    setUrl(initialUrl);
    setInputUrl(initialUrl);
  }, [initialUrl]);

  return (
    <div className="flex-1 flex flex-col">
      {/* URL bar */}
      <div className="px-2 py-1 border-b border-border flex gap-1 items-center">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => webviewRef.current?.goBack()}
        >
          <ArrowLeft className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => webviewRef.current?.reload()}
        >
          <RotateCw className="h-3 w-3" />
        </Button>
        <Input
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setUrl(inputUrl); }}
          className="flex-1 h-7 text-xs"
        />
      </div>

      {/* Webview */}
      <webview
        ref={webviewRef}
        src={url}
        className="flex-1"
      />
    </div>
  );
}

export { BrowserPane };
