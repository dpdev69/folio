import type { PressPhase } from "../welcome/copy";
import { INSTALL_COMMAND } from "../welcome/copy";
import { Ornament } from "./icons";

export function Welcome({
  press,
  providerId,
  onProvider,
  providerKey,
  onKey,
  onSaveKey,
  saving,
  onInstall,
  onRetry,
  onOpenFolder,
  showPath,
  pathDraft,
  onPath,
  onConnect,
  passwordDraft,
  onPassword,
  onSample,
  onUseKey,
}: {
  press: PressPhase;
  providerId: string;
  onProvider: (id: string) => void;
  providerKey: string;
  onKey: (value: string) => void;
  onSaveKey: () => void;
  saving: boolean;
  onInstall: () => void;
  onRetry: () => void;
  onOpenFolder: () => void;
  showPath: boolean;
  pathDraft: string;
  onPath: (value: string) => void;
  onConnect: () => void;
  passwordDraft: string;
  onPassword: (value: string) => void;
  onSample: () => void;
  onUseKey: () => void;
}) {
  return (
    <div className="book" role="main">
      <article className="sheet left">
        <div className="title-page">
          <p className="kicker">A reading room</p>
          <h1>Folio</h1>
          <p className="subtitle">for a repository</p>
          <Ornament />
          <p className="powered">Powered by opencode</p>
        </div>
      </article>
      <article className="sheet right">
        <header className="running">The press</header>
        <div className="welcome-copy">
          {press.phase === "checking" || press.phase === "installing" ? (
            <p>{press.phase === "installing" ? "Installing opencode…" : "Looking for the press on this machine."}</p>
          ) : null}
          {press.phase === "missing" ? (
            <>
              <h2>Opencode is not here yet.</h2>
              <p>Folio does not bring its own model. It reads through opencode, which is not installed.</p>
              <div className="welcome-actions">
                <button type="button" className="primary" onClick={onInstall}>
                  Install opencode
                </button>
                <p className="command">{INSTALL_COMMAND}</p>
                {press.detail ? <p className="detail">{press.detail}</p> : null}
                <button type="button" className="linkish" onClick={onRetry}>
                  Check again
                </button>
              </div>
            </>
          ) : null}
          {press.phase === "needs-provider" ? (
            <>
              <h2>The press needs a model.</h2>
              <p>Choose a provider and paste a key. Opencode stores it on this machine. Folio does not keep an account.</p>
              <div className="providers">
                {press.providers.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    className={provider.id === providerId ? "on" : ""}
                    onClick={() => onProvider(provider.id)}
                  >
                    {provider.label}
                  </button>
                ))}
              </div>
              <input
                className="key-field"
                type="password"
                aria-label="Provider API key"
                placeholder="API key"
                value={providerKey}
                onChange={(event) => onKey(event.target.value)}
              />
              <div className="welcome-actions">
                <button type="button" className="primary" disabled={saving || !providerKey.trim()} onClick={onSaveKey}>
                  {saving ? "Saving…" : "Save the key"}
                </button>
                <p className="command">or, in a terminal: opencode auth login</p>
              </div>
            </>
          ) : null}
          {press.phase === "ready" ? (
            <>
              <h2>The press is ready.</h2>
              <p>
                {press.summary ? <>Using {press.summary}. </> : null}
                Open a folder and the first chapter will be waiting, with the quill on the page.
              </p>
              {showPath ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    onConnect();
                  }}
                >
                  <input
                    className="path-field"
                    aria-label="Path to the repository"
                    placeholder="Path to the repository"
                    value={pathDraft}
                    onChange={(event) => onPath(event.target.value)}
                    autoFocus
                  />
                  <input
                    className="path-field"
                    aria-label="Server password, if the press asks"
                    placeholder="Password, if the server asks"
                    type="password"
                    value={passwordDraft}
                    onChange={(event) => onPassword(event.target.value)}
                  />
                  <div className="welcome-actions">
                    <button type="submit" className="primary">
                      Open this folder
                    </button>
                  </div>
                </form>
              ) : (
                <div className="welcome-actions">
                  <button type="button" className="primary" onClick={onOpenFolder}>
                    Open a folder
                  </button>
                  <button type="button" className="linkish" onClick={onUseKey}>
                    Use a different key
                  </button>
                  <button type="button" className="linkish" onClick={onSample}>
                    Read the sample
                  </button>
                </div>
              )}
            </>
          ) : null}
          {press.phase === "error" ? (
            <>
              <h2>The press did not answer.</h2>
              <p className="detail">{press.message}</p>
              <div className="welcome-actions">
                <button type="button" className="primary" onClick={onRetry}>
                  Try again
                </button>
                <button type="button" className="linkish" onClick={onSample}>
                  Read the sample
                </button>
              </div>
            </>
          ) : null}
        </div>
      </article>
    </div>
  );
}
