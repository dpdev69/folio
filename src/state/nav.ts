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
 * per laid page; `filledBefore` and `filledAfter` say which pages hold lines or
 * footnotes. Only those count as the chapter's reach, so the blank spread the
 * quill waits on after a full right page does not turn the reader early.
 */
export function followTail(
  before: string[],
  after: string[],
  spread: number,
  filledBefore: boolean[] = before.map(() => true),
  filledAfter: boolean[] = after.map(() => true),
): number | null {
  const chapterId = before[spread * 2];
  if (chapterId == null) return null;
  /** The chapter's last spread with something on it, or its last spread when none has. */
  const reach = (ids: string[], filled: boolean[]) => {
    let last = -1;
    ids.forEach((id, index) => {
      if (id === chapterId && filled[index]) last = index;
    });
    return Math.floor((last < 0 ? ids.lastIndexOf(chapterId) : last) / 2);
  };
  if (reach(before, filledBefore) !== spread) return null;
  // The chapter itself grew: more of its pages hold something than before.
  const count = (ids: string[], filled: boolean[]) => ids.filter((id, index) => id === chapterId && filled[index]).length;
  if (count(after, filledAfter) <= count(before, filledBefore)) return null;
  const last = reach(after, filledAfter);
  return last > spread ? last : null;
}

/** What `relocate` reads of a laid page. */
export type AnchorPage = { chapterId: string; lines: { blockId: string; plainStart: number; gap?: boolean }[] };

/**
 * The spread to show after the whole book was laid again (a new window size,
 * type size or face): the one that now holds the first line the reader had in
 * front of them, found by its block and its offset in the block. A spread with
 * no lines (the quill's blank spread, an empty chapter) keeps its place in its
 * chapter: the chapter's first spread plus the same offset, no further than the
 * chapter's last spread. Always inside the book.
 */
export function relocate(before: AnchorPage[], after: AnchorPage[], spread: number): number {
  const last = Math.max(0, Math.ceil(after.length / 2) - 1);
  const shown = [before[spread * 2], before[spread * 2 + 1]];
  const anchor = shown.flatMap((page) => page?.lines ?? []).find((line) => !line.gap);
  if (anchor) {
    let found = -1;
    after.forEach((page, index) => {
      if (page.lines.some((line) => !line.gap && line.blockId === anchor.blockId && line.plainStart <= anchor.plainStart)) found = index;
    });
    if (found >= 0) return Math.min(last, Math.floor(found / 2));
  }
  const chapterId = shown[0]?.chapterId;
  const startBefore = chapterId == null ? -1 : before.findIndex((page) => page.chapterId === chapterId);
  const startAfter = chapterId == null ? -1 : after.findIndex((page) => page.chapterId === chapterId);
  if (startBefore >= 0 && startAfter >= 0) {
    const endAfter = after.map((page) => page.chapterId).lastIndexOf(chapterId!);
    const offset = spread - Math.floor(startBefore / 2);
    return Math.min(last, Math.floor(endAfter / 2), Math.floor(startAfter / 2) + Math.max(0, offset));
  }
  return Math.min(last, Math.max(0, spread));
}
