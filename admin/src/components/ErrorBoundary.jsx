import React from 'react';
import { logBoundaryError } from '../utils/safeLogging';
import { t } from '../i18n/translate.js';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    logBoundaryError(error, errorInfo);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '2rem',
          textAlign: 'center',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          margin: '1rem'
        }}>
          <h2 style={{ color: 'var(--danger)' }}>
            {t('errors.somethingWrong')}
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            {this.props.fallbackMessage || t('errors.sectionError')}
          </p>
          <button
            onClick={this.reset}
            style={{
              background: 'var(--danger)',
              color: 'white',
              border: 'none',
              padding: '0.5rem 1rem',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            {t('common.retry')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
