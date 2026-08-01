import { Component } from "react";

/**
 * Catches render errors so auth/subscription pages never go fully blank.
 * UI stays minimal — does not change product chrome.
 */
export default class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) console.error("[RouteErrorBoundary]", error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#F4F7FB] p-6">
          <div className="max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
            <h1 className="text-lg font-bold text-amber-950">Something went wrong</h1>
            <p className="mt-2 text-sm text-amber-900/80">
              {this.state.error?.message || "This page failed to load. Please refresh or sign in again."}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                className="rounded-xl bg-amber-800 px-4 py-2 text-sm font-semibold text-white"
                onClick={() => {
                  this.setState({ error: null });
                  window.location.reload();
                }}
              >
                Reload
              </button>
              <a
                href="/login"
                className="rounded-xl border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-900"
              >
                Login
              </a>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
