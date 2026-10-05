import React from 'react';
import { t } from '../i18n/translate.js';
import { logBoundaryError } from '../utils/safeLogging';

/**
 * Same contract as admin/src/components/ErrorBoundary.jsx, using the
 * pure `t` because a class component cannot use the locale hook. Logging still goes
 * through safeLogging so no JWT or Bearer string reaches the console
 * (V-020) -- a customer's browser is the least controlled environment
 * this code runs in.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    logBoundaryError(error, errorInfo);
  }

  reset = () => {
    this.setState({ hasError: false });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="boundary-error" role="alert">
          <h2>{t('chrome.boundary.title')}</h2>
          <p>{this.props.fallbackMessage || t('chrome.boundary.default')}</p>
          <button type="button" className="btn btn-primary" onClick={this.reset}>
            {t('chrome.boundary.retry')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
