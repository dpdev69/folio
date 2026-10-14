import type { PressPhase } from "../welcome/copy";
import { INSTALL_COMMAND } from "../welcome/copy";
import { useEffect, useState } from "react";
import { Ornament } from "./icons";

/** The title is set with a flourish once per launch; coming back to it later, it is simply there. */
let titleSeen = false;

/** The heading of the press page, one per phase, so the words can change in place. */
function pressHeading(press: PressPhase): string {
  switch (press.phase) {
    case "checking":
      return "Looking for the press…";
    case "installing":
      return "Installing opencode…";
    case "missing":
      return "Opencode is not here yet.";
    case "needs-password":
      return "The press wants its password.";
    case "ready":
      return "The press is ready.";
    case "error":
      return "The press did not answer.";
  }
}

export function Welcome({
  press,
  modelLabel,
  providerId,
  onProvider,
  providerKey,
  onKey,
  onSaveKey,
  onCloseKeys,
  saving,
  onInstall,
  onRetry,
  onOpenFolder,
  showPath,
  pathDraft,
  onPath,
  onConnect,
  pressUrl,
  onPressUrl,
  passwordDraft,
  onPassword,
  onAttach,
  onSample,
  onUseKey,
}: {
  press: PressPhase;
  /** The model the press will write with, for the colophon line. */
  modelLabel?: string | null;
  providerId: string;
  onProvider: (id: string) => void;
  providerKey: string;
  onKey: (value: string) => void;
  onSaveKey: () => void;
  onCloseKeys: () => void;
  saving: boolean;
  onInstall: () => void;
  onRetry: () => void;
  onOpenFolder: () => void;
  showPath: boolean;
  pathDraft: string;
  onPath: (value: string) => void;
  onConnect: () => void;
  pressUrl: string;
  onPressUrl: (value: string) => void;
  passwordDraft: string;
  onPassword: (value: string) => void;
  onAttach: () => void;
  onSample: () => void;
  onUseKey: () => void;
}) {
  const [first] = useState(() => !titleSeen);
  useEffect(() => {
    titleSeen = true;
  }, []);
  const heading = pressHeading(press);

  const attach = (open: boolean) => (
    <details className="attach" open={open}>
      <summary>Attach to a running press</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onAttach();
        }}
      >
        <input
          className="path-field"
          aria-label="Address of the press"
          placeholder="http://127.0.0.1:4096"
          value={pressUrl}
          onChange={(event) => onPressUrl(event.target.value)}
        />
        <input
          className="path-field"
          aria-label="Password of the press"
          placeholder="Its password"
          type="password"
          autoComplete="off"
          value={passwordDraft}
          onChange={(event) => onPassword(event.target.value)}
        />
        <div className="welcome-actions">
          <button type="submit" className="primary" disabled={!pressUrl.trim()}>
            Attach
          </button>
        </div>
      </form>
    </details>
  );

  return (
    <div className="book" role="main">
      <span className="gutter" />
      <article className="sheet left">
        <div className={`title-page ${first ? "first" : ""}`}>
          <p className="kicker">A reading room</p>
          <h1>Folio</h1>
          <p className="subtitle">for a repository</p>
          <Ornament draw={first} />
          <p className="powered">Powered by opencode{modelLabel ? ` · set in ${modelLabel}` : ""}</p>
        </div>
      </article>
      <article className="sheet right">
        <header className="running">The press</header>
        <div className="welcome-copy">
          {/* The heading keeps its height while its words change, so nothing below it jumps. */}
          <h2 className="press-heading" aria-live="polite">
            <span key={heading}>{heading}</span>
          </h2>
          <div className="press-body" key={press.phase}>
          {press.phase === "checking" || press.phase === "installing" ? (
            <p>{press.phase === "installing" ? "Fetching the press and setting it beside Folio." : "Folio looks for opencode on this machine."}</p>
          ) : null}
          {press.phase === "missing" ? (
            <>
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
              {attach(false)}
            </>
          ) : null}
          {press.phase === "needs-password" ? (
            <>
              <p>This press was started elsewhere and keeps a password. Give its address and password to attach.</p>
              {press.detail ? <p className="detail">{press.detail}</p> : null}
              {attach(true)}
              <div className="welcome-actions">
                <button type="button" className="linkish" onClick={onRetry}>
                  Start Folio's own press instead
                </button>
              </div>
            </>
          ) : null}
          {press.phase === "ready" ? (
            <>
              <p>
                {press.summary ? <>Using {press.summary}. </> : null}
                Open a folder and the first chapter will be waiting, with the quill on the page.
              </p>
              {press.note ? <p className="detail">{press.note}</p> : null}
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
                    Use a provider key
                  </button>
                  <button type="button" className="linkish" onClick={onSample}>
                    Read the sample
                  </button>
                </div>
              )}
              {press.providers ? (
                <>
                  <p>Choose a provider and paste a key. Opencode stores it on this machine. Folio does not keep a copy.</p>
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
                    autoComplete="off"
                    aria-label="Provider API key"
                    placeholder="API key"
                    value={providerKey}
                    onChange={(event) => onKey(event.target.value)}
                  />
                  <div className="welcome-actions">
                    <button type="button" className="primary" disabled={saving || !providerKey.trim()} onClick={onSaveKey}>
                      {saving ? "Saving…" : "Save the key"}
                    </button>
                    <button type="button" className="linkish" onClick={onCloseKeys}>
                      Not now
                    </button>
                  </div>
                </>
              ) : null}
            </>
          ) : null}
          {press.phase === "error" ? (
            <>
              <p className="detail">{press.message}</p>
              <div className="welcome-actions">
                <button type="button" className="primary" onClick={onRetry}>
                  Try again
                </button>
                <button type="button" className="linkish" onClick={onSample}>
                  Read the sample
                </button>
              </div>
              {attach(false)}
            </>
          ) : null}
          </div>
        </div>
      </article>
    </div>
  );
}
