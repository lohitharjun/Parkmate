import { Component } from 'react';
import { captureException } from '../lib/monitoring.js';

/** Catches rendering crashes anywhere below it, reports them, and shows a calm recovery screen. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    captureException(error, { tags: { source: 'react-error-boundary' }, extra: { componentStack: String(info?.componentStack || '').slice(0, 1500) } });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="crash-screen" role="alert">
        <div className="crash-screen__card">
          <span className="crash-screen__code">Oops</span>
          <h1>Something went wrong.</h1>
          <p>ParkMate hit an unexpected problem. We’ve been told about it. Reloading usually fixes it.</p>
          <div className="crash-screen__actions">
            <button className="button button--primary" type="button" onClick={() => window.location.reload()}>Reload the page</button>
            <a className="button button--secondary" href="/">Go to the home page</a>
          </div>
        </div>
      </main>
    );
  }
}
