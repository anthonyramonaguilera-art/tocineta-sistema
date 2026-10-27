import { Component, type ReactNode, type ErrorInfo } from 'react';
import { Card, Button, Icon } from '../ui/index.js';

interface ViewErrorBoundaryProps {
  children: ReactNode;
  onFallbackToPos: () => void;
  viewName?: string;
  userId?: string;
  userRole?: string;
}

interface ViewErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  isReporting: boolean;
  reported: boolean;
}

export class ViewErrorBoundary extends Component<ViewErrorBoundaryProps, ViewErrorBoundaryState> {
  constructor(props: ViewErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      isReporting: false,
      reported: false
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ViewErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    this.reportError(error, errorInfo);
  }

  private reportError = async (error: Error, errorInfo: ErrorInfo) => {
    try {
      this.setState({ isReporting: true });
      await fetch('/api/client-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          viewName: this.props.viewName || 'AppView',
          errorMessage: error.message || 'Error desconocido en componente',
          errorStack: error.stack || errorInfo.componentStack || undefined,
          userId: this.props.userId,
          userRole: this.props.userRole
        })
      });
      this.setState({ reported: true });
    } catch {
      // Ignorar fallo de red defensivamente
    } finally {
      this.setState({ isReporting: false });
    }
  };

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, reported: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="max-w-lg mx-auto my-12 p-4">
          <Card variant="alt" className="p-6 text-center space-y-5 border-danger/30 shadow-2xl">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-danger/10 flex items-center justify-center text-danger border border-danger/20">
              <Icon name="AlertTriangle" className="w-8 h-8 text-danger" />
            </div>

            <div className="space-y-2">
              <h3 className="text-xl font-black text-ink uppercase tracking-tight">
                Ocurrió un problema inesperado
              </h3>
              <p className="text-sm text-ink-muted leading-relaxed">
                El sistema aisló el error en este módulo para proteger la operación general. El incidente fue registrado automáticamente para el administrador.
              </p>
            </div>

            {this.state.error && (
              <div className="p-3 bg-surface border border-border rounded-xl text-left text-xs font-mono text-danger break-words max-h-32 overflow-y-auto">
                <span className="font-bold">Error:</span> {this.state.error.message}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
              <Button
                variant="secondary"
                size="md"
                onClick={this.handleRetry}
                leftIcon="RotateCw"
                className="w-full sm:w-auto"
              >
                Reintentar
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={() => {
                  this.setState({ hasError: false, error: null, errorInfo: null });
                  this.props.onFallbackToPos();
                }}
                leftIcon="ArrowLeft"
                className="w-full sm:w-auto"
              >
                Volver al Comandero
              </Button>
            </div>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
