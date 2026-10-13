import { useCallback, useEffect, useRef, useState } from "react";
import { displayTitle, toRoman } from "../book/model";
import { IconBook, IconContents, IconMenu, IconRibbon, IconSearch, IconType } from "./icons";
import { SettingsPopover } from "./Settings";
import type { useFolio } from "../state/useFolio";

type Folio = ReturnType<typeof useFolio>;

export function Chrome({ folio }: { folio: Folio }) {
  const [tauri, setTauri] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const typeButton = useRef<HTMLButtonElement>(null);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  useEffect(() => {
    setTauri("__TAURI_INTERNALS__" in window);
  }, []);
  const chapter = folio.book?.chapters.find((item) => item.id === folio.pages[folio.nav.spread * 2]?.chapterId);
  const index = folio.book?.chapters.findIndex((item) => item.id === chapter?.id) ?? -1;
  const title =
    folio.nav.view === "colophon"
      ? "Colophon"
      : folio.nav.view === "contents"
        ? "Contents"
        : folio.nav.view === "desk" || !folio.book
          ? "Folio"
          : `${folio.book.title}  —  Chapter ${index >= 0 ? toRoman(index + 1) : ""}`;

  return (
    <header className="chrome" data-tauri-drag-region>
      <div className="chrome-left">
        <span className="lights" aria-hidden="true">
          {tauri ? (
            <>
              <button type="button" aria-label="Close" onClick={() => void closeWindow()} />
              <button type="button" aria-label="Minimize" onClick={() => void minimizeWindow()} />
              <button type="button" aria-label="Zoom" onClick={() => void toggleWindow()} />
            </>
          ) : (
            <>
              <i />
              <i />
              <i />
            </>
          )}
        </span>
        <button type="button" className="icon-btn" aria-label="Title page" onClick={() => folio.setNavDesk()}>
          <IconBook />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Contents"
          disabled={!folio.book}
          onClick={() => folio.showContents()}
        >
          <IconContents />
        </button>
        <button type="button" className="icon-btn" aria-label="Menu" onClick={() => folio.setMenuOpen(!folio.menuOpen)}>
          <IconMenu />
        </button>
      </div>
      <div className="running-title" data-tauri-drag-region>
        {title}
        {chapter && folio.nav.view === "reading" ? <span className="sr"> {displayTitle(chapter)}</span> : null}
      </div>
      <div className="chrome-right">
        <span className="settings-anchor">
          <button
            type="button"
            ref={typeButton}
            className={`icon-btn ${settingsOpen ? "active" : ""}`}
            aria-label="Themes & Settings"
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <IconType />
          </button>
          {settingsOpen ? (
            <SettingsPopover
              settings={folio.settings}
              dispatch={folio.setSettings}
              appearance={folio.appearance}
              anchor={typeButton}
              onClose={closeSettings}
            />
          ) : null}
        </span>
        <button type="button" className="icon-btn" aria-label="Search" onClick={() => folio.setSearchOpen(!folio.searchOpen)}>
          <IconSearch />
        </button>
        <button
          type="button"
          className={`icon-btn ${folio.place === folio.nav.spread ? "active" : ""}`}
          aria-label="Ribbon"
          onClick={folio.place === folio.nav.spread ? folio.goToPlace : folio.togglePlace}
        >
          <IconRibbon />
        </button>
      </div>
      {folio.menuOpen ? (
        <div className="menu" role="menu">
          <button type="button" onClick={() => folio.setNavDesk()}>
            Title page
          </button>
          <button type="button" onClick={() => folio.showContents()} disabled={!folio.book}>
            Contents
          </button>
          <button type="button" onClick={() => folio.showColophon()}>
            About
          </button>
          <button type="button" onClick={folio.openSample}>
            Read the sample
          </button>
          <button type="button" onClick={folio.beginOpenFolder}>
            Open a folder
          </button>
          <button type="button" className={folio.askBeforeWrite ? "on" : ""} onClick={folio.toggleAsk}>
            {folio.askBeforeWrite ? "Asking before writes" : "Ask before the press writes"}
          </button>
        </div>
      ) : null}
      {folio.searchOpen && folio.book ? (
        <div className="search-card">
          <input
            aria-label="Search the book"
            placeholder="Search the book"
            value={folio.query}
            onChange={(event) => folio.setQuery(event.target.value)}
            autoFocus
          />
          {folio.searchHits.map((hit) => (
            <button key={hit.id} type="button" onClick={() => folio.jump(hit.spread)}>
              {hit.label}
            </button>
          ))}
        </div>
      ) : null}
    </header>
  );
}

async function closeWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}
async function minimizeWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().minimize();
}
async function toggleWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().toggleMaximize();
}
