export type Nav = {
  view: "desk" | "contents" | "reading" | "colophon";
  spread: number;
  margin: boolean;
  curl: null | { to: number; forward: boolean };
  /** The plate the reader opened over the right page; any page turn folds it back. */
  plateOpen: string | null;
};

export function initialNav(spread = 0): Nav {
  return { view: "reading", spread, margin: false, curl: null, plateOpen: null };
}

export function reduceNav(
  nav: Nav,
  action:
    | { type: "contents" }
    | { type: "close-contents" }
    | { type: "colophon" }
    | { type: "close-colophon"; hadBook: boolean }
    | { type: "desk" }
    | { type: "open-book"; spread: number }
    | { type: "jump"; spread: number }
    | { type: "turn"; forward: boolean; spreadCount: number }
    | { type: "curl-done" }
    | { type: "margin"; open: boolean }
    | { type: "open-plate"; id: string }
    | { type: "fold-plate" },
): { nav: Nav; effect?: "new-chapter" } {
  switch (action.type) {
    case "contents":
      return { nav: { ...nav, view: "contents", curl: null, margin: false } };
    case "close-contents":
      return { nav: { ...nav, view: nav.view === "contents" ? "reading" : nav.view } };
    case "colophon":
      return { nav: { ...nav, view: "colophon", curl: null, margin: false } };
    case "close-colophon":
      return { nav: { ...nav, view: action.hadBook ? "reading" : "desk" } };
    case "desk":
      return { nav: { ...initialNav(), view: "desk" } };
    case "open-book":
      return { nav: initialNav(action.spread) };
    case "jump": {
      if (nav.curl) return { nav };
      return {
        nav: { ...nav, view: "reading", margin: false, plateOpen: null, curl: { to: action.spread, forward: action.spread > nav.spread } },
      };
    }
    case "open-plate":
      // Mid-curl the spread under the reader is about to change; the plate would land on the next one.
      if (nav.curl) return { nav };
      return { nav: { ...nav, plateOpen: action.id } };
    case "fold-plate":
      return { nav: { ...nav, plateOpen: null } };
    case "margin":
      return { nav: { ...nav, margin: action.open } };
    case "curl-done":
      if (!nav.curl) return { nav };
      // Curls also come from the tail-follow and chapter-jump effects, so the plate folds back here too.
      return { nav: { ...nav, spread: nav.curl.to, curl: null, view: "reading", plateOpen: null } };
    case "turn": {
      if (nav.curl || nav.view !== "reading") return { nav };
      const folded = { ...nav, plateOpen: null };
      if (action.forward) {
        // Only the last spread of the book (the last chapter's) opens a new chapter.
        const last = Math.max(0, action.spreadCount - 1);
        if (nav.spread >= last) return { nav: folded, effect: "new-chapter" };
        return { nav: { ...folded, margin: false, curl: { to: nav.spread + 1, forward: true } } };
      }
      if (nav.spread <= 0) return { nav: folded };
      return { nav: { ...folded, margin: false, curl: { to: nav.spread - 1, forward: false } } };
    }
    default:
      return { nav };
  }
}

/**
 * The open plate to lay over this spread's right page: only one footnoted on
 * the spread (`plateIds`), and none while a page is turning.
 */
export function plateShown(nav: Nav, plateIds: string[]): string | null {
  if (nav.curl || !nav.plateOpen) return null;
  return plateIds.includes(nav.plateOpen) ? nav.plateOpen : null;
}

/**
 * While the press writes, carry the reader on to the chapter's last spread only
 * when they were on the last spread of the chapter that grew and it now reaches
 * further. A chapter that grew by several spreads in one layout is followed to
 * its end, not one spread at a time. `before` and `after` hold one chapter id
 * per laid page.
 */
export function followTail(before: string[], after: string[], spread: number): number | null {
  const chapterId = before[spread * 2];
  if (chapterId == null) return null;
  if (Math.floor(before.lastIndexOf(chapterId) / 2) !== spread) return null;
  const pagesOf = (pages: string[]) => pages.filter((id) => id === chapterId).length;
  if (pagesOf(after) <= pagesOf(before)) return null;
  const last = Math.floor(after.lastIndexOf(chapterId) / 2);
  return last > spread ? last : null;
}
