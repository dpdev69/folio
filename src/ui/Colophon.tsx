import { Ornament } from "./icons";

export function Colophon({ onClose }: { onClose: () => void }) {
  return (
    <div className="book single" role="main">
      <article className="sheet left colophon">
        <header className="running">Colophon</header>
        <h1>Folio</h1>
        <Ornament />
        <p>Folio sets a repository as a book and an opencode session as a chapter. You write on the page.</p>
        <p className="credit">Powered by opencode.</p>
        <p>
          The press is the opencode server, MIT licensed, run beside this app and not forked. Its license is kept in the
          third-party notices.
        </p>
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
