export type Nav = {
  view: "desk" | "contents" | "reading" | "colophon";
  spread: number;
  margin: boolean;
  curl: null | { to: number; forward: boolean };
};

export function initialNav(spread = 0): Nav {
  return { view: "reading", spread, margin: false, curl: null };
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
    | { type: "margin"; open: boolean },
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
      return { nav: { view: "reading", spread: action.spread, margin: false, curl: null } };
    case "jump": {
      if (nav.curl) return { nav };
      return { nav: { ...nav, view: "reading", margin: false, curl: { to: action.spread, forward: action.spread > nav.spread } } };
    }
    case "margin":
      return { nav: { ...nav, margin: action.open } };
    case "curl-done":
      if (!nav.curl) return { nav };
      return { nav: { ...nav, spread: nav.curl.to, curl: null, view: "reading" } };
    case "turn": {
      if (nav.curl || nav.view !== "reading") return { nav };
      if (action.forward) {
        const last = Math.max(0, action.spreadCount - 1);
        if (nav.spread >= last) return { nav, effect: "new-chapter" };
        return { nav: { ...nav, margin: false, curl: { to: nav.spread + 1, forward: true } } };
      }
      if (nav.spread <= 0) return { nav };
      return { nav: { ...nav, margin: false, curl: { to: nav.spread - 1, forward: false } } };
    }
    default:
      return { nav };
  }
}
