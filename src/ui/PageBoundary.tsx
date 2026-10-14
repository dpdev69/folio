import { Component, type ErrorInfo, type ReactNode } from "react";
import { Ornament } from "./icons";

/**
 * Catches a page that fails to render and sets a calm sheet in its place.
 * The details go to the console, never onto the page.
 */
export class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("Folio could not set the page.", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="book single" role="main">
        <article className="sheet left fallback">
          <header className="running">Folio</header>
          <div className="fallback-copy">
            <Ornament />
            <p>The page could not be set. Reload Folio, or open the book again.</p>
            <div className="welcome-actions">
              <button type="button" className="primary" onClick={() => window.location.reload()}>
                Reload Folio
              </button>
            </div>
          </div>
        </article>
      </div>
    );
  }
}
