import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackLabel?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`ErrorBoundary caught error in ${this.props.fallbackLabel ?? 'component'}:`, error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 p-4 text-center">
          <div className="text-destructive text-sm font-medium">
            {this.props.fallbackLabel ?? 'This pane'} crashed
          </div>
          <div className="text-muted-foreground text-xs max-w-md break-words">
            {this.state.error?.message ?? 'Unknown error'}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Retry
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

export { ErrorBoundary };
