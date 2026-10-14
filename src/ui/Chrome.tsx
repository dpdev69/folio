import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { displayTitle, toRoman } from "../book/model";
import { IconBook, IconContents, IconMenu, IconRibbon, IconSearch, IconType } from "./icons";
import { SettingsPopover } from "./Settings";
import { modelGroups } from "../welcome/copy";
import type { useFolio } from "../state/useFolio";

type Folio = ReturnType<typeof useFolio>;

export function Chrome({ folio }: { folio: Folio }) {
  const [tauri, setTauri] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const typeButton = useRef<HTMLButtonElement>(null);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setTauri("__TAURI_INTERNALS__" in window);
  }, []);

  // The menu closes like the settings card: Escape, or a press anywhere outside it.
  const { menuOpen, setMenuOpen } = folio;
  // A card grows out of the button that opened it.
  useOriginAt(menuRef, menuButton, menuOpen);
  useOriginAt(searchRef, searchButton, folio.searchOpen);
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || menuButton.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, setMenuOpen]);

  // The search card closes on Escape like the menu, and after a jump to a hit;
  // the query stays, so the next search can begin from it.
  const { searchOpen, setSearchOpen, jump } = folio;
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    searchButton.current?.focus();
  }, [setSearchOpen]);
  useEffect(() => {
    if (!searchOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSearch();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [searchOpen, closeSearch]);
  const jumpToHit = (spread: number) => {
    jump(spread);
    closeSearch();
  };
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
        <button
          ref={menuButton}
          type="button"
          className="icon-btn"
          aria-label="Menu"
          aria-expanded={folio.menuOpen}
          onClick={() => folio.setMenuOpen(!folio.menuOpen)}
        >
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
        <button
          ref={searchButton}
          type="button"
          className="icon-btn"
          aria-label="Search"
          aria-expanded={folio.searchOpen}
          onClick={() => folio.setSearchOpen(!folio.searchOpen)}
        >
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
        <div className="menu" role="menu" ref={menuRef}>
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
          <button type="button" onClick={() => void folio.showProviderForm()}>
            A provider key…
          </button>
          {folio.models.length ? (
            <button
              type="button"
              className={folio.modelsOpen ? "on" : ""}
              aria-expanded={folio.modelsOpen}
              onClick={() => folio.setModelsOpen(!folio.modelsOpen)}
            >
              Model…
            </button>
          ) : null}
          {folio.modelsOpen ? (
            <div className="model-list" role="group" aria-label="Models">
              {modelGroups(folio.models, folio.providers).map((group) => (
                <div key={group.id} className="model-group">
                  <p className="model-provider">{group.label}</p>
                  {group.models.map((m) => {
                    const current = folio.model?.providerID === m.providerID && folio.model?.id === m.id;
                    return (
                      <button
                        key={`${m.providerID}/${m.id}`}
                        type="button"
                        className={current ? "on" : ""}
                        aria-pressed={current}
                        onClick={() => folio.chooseModel({ providerID: m.providerID, id: m.id })}
                      >
                        {m.name ?? m.id}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {folio.searchOpen && folio.book ? (
        <div className="search-card" ref={searchRef}>
          <input
            aria-label="Search the book"
            placeholder="Search the book"
            value={folio.query}
            onChange={(event) => folio.setQuery(event.target.value)}
            autoFocus
          />
          {folio.searchHits.map((hit) => (
            <button key={hit.id} type="button" onClick={() => jumpToHit(hit.spread)}>
              {hit.label}
            </button>
          ))}
        </div>
      ) : null}
    </header>
  );
}

/** Sets a popover's transform-origin under the centre of its button, so it opens from there. */
function useOriginAt(card: RefObject<HTMLElement | null>, button: RefObject<HTMLElement | null>, open: boolean) {
  useLayoutEffect(() => {
    const el = card.current;
    const from = button.current;
    if (!open || !el || !from) return;
    const a = el.getBoundingClientRect();
    const b = from.getBoundingClientRect();
    el.style.transformOrigin = `${Math.round(b.left + b.width / 2 - a.left)}px ${Math.round(b.bottom - a.top)}px`;
  }, [card, button, open]);
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
