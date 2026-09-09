import { Component, type ErrorInfo, type ReactNode } from 'react'

import { Footer } from './Footer'

// The last thing standing between a thrown render and a white page. What went
// wrong is a matter for the console: on screen it is one sentence and one way
// out, because a stack trace helps nobody holding a phone.
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="t-center">
        <div className="w-full max-w-sm">
          <div className="t-card">
            <p className="text-sm">
              Something went wrong. Reload the page. If it keeps happening, tell the
              administrator from More, then Feedback.
            </p>
            <button
              className="t-btn t-btn-primary mt-3"
              type="button"
              onClick={() => location.reload()}
            >
              Reload
            </button>
          </div>
          <Footer />
        </div>
      </div>
    )
  }
}
