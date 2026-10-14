import { BUNDLED_PRESS_VERSION, FOLIO_VERSION } from "../version";
import { Ornament } from "./icons";

/**
 * The colophon. `press` is the line for the press in use ("opencode 2.0.28 ·
 * OpenCode Zen, cat-jam-free"): the bundled one, or one attached from outside.
 * Without it the page names the press this edition carries.
 */
export function Colophon({ onClose, press }: { onClose: () => void; press?: string | null }) {
  return (
    <div className="book single" role="main">
      <article className="sheet left colophon">
        <header className="running">Colophon</header>
        <h1>Folio</h1>
        <Ornament />
        <p>Edition {FOLIO_VERSION}</p>
        <p>Folio sets a repository as a book and an opencode session as a chapter. You write on the page.</p>
        <p className="credit">Powered by opencode.</p>
        <p>
          The press is the opencode server, MIT licensed, run beside this app and not forked. This edition carries
          opencode {BUNDLED_PRESS_VERSION}. Its license is kept in the third-party notices.
        </p>
        {press ? <p>This reading is set on {press}.</p> : null}
        <p>The type is EB Garamond and Caveat, both under the SIL Open Font License.</p>
        <p>This edition does not yet check a license. A later one will, at a single seam, before the press starts.</p>
        <div className="welcome-actions">
          <button type="button" className="primary" onClick={onClose}>
            Close the colophon
          </button>
        </div>
      </article>
    </div>
  );
}
