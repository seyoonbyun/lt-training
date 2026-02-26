import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class MobileErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Mobile Error Boundary caught an error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '20px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          backgroundColor: '#1a1a1a',
          color: '#ffffff'
        }}>
          <div style={{
            textAlign: 'center',
            maxWidth: '400px'
          }}>
            <h1 style={{ 
              fontSize: '24px', 
              marginBottom: '20px',
              color: '#dc2626' 
            }}>
              BNI Korea Leadership Training
            </h1>
            <div style={{
              backgroundColor: '#374151',
              padding: '20px',
              borderRadius: '8px',
              marginBottom: '20px'
            }}>
              <h2 style={{ fontSize: '18px', marginBottom: '10px' }}>
                페이지 로딩 중 문제가 발생했습니다
              </h2>
              <p style={{ fontSize: '14px', color: '#9ca3af' }}>
                잠시 후 다시 시도해주세요
              </p>
            </div>
            <button
              onClick={() => window.location.reload()}
              style={{
                backgroundColor: '#dc2626',
                color: 'white',
                border: 'none',
                padding: '12px 24px',
                borderRadius: '6px',
                fontSize: '16px',
                cursor: 'pointer'
              }}
            >
              새로고침
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}