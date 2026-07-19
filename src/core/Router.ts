export type PageName = "library" | "train" | "report" | "create" | "avatars";

export interface Route {
  name: PageName;
  params: Record<string, string>;
}

export interface Page {
  el: HTMLElement;
  enter?(params: Record<string, string>): void;
  leave?(): void;
}

interface RouterOptions {
  pages: Record<PageName, Page>;
  onNavigate?(route: Route): void;
}

/**
 * Minimal hash router. Pages live in the same DOM and are shown/hidden — no
 * reloads, so MediaPipe assets, the WebSocket and the camera stream survive
 * navigation. Unknown hashes fall back to the library.
 */
export class Router {
  private options: RouterOptions;
  private current: PageName | null = null;

  constructor(options: RouterOptions) {
    this.options = options;
  }

  start(): void {
    window.addEventListener("hashchange", () => this.apply());
    this.apply();
  }

  navigate(path: string): void {
    const hash = path.startsWith("#") ? path : `#${path}`;
    if (window.location.hash === hash) this.apply();
    else window.location.hash = hash;
  }

  currentRoute(): Route {
    return this.parse(window.location.hash);
  }

  private apply(): void {
    const route = this.parse(window.location.hash);
    if (this.current === route.name) {
      // Same page, possibly new params (e.g. seed switch inside the train bay).
      this.options.pages[route.name].enter?.(route.params);
      this.options.onNavigate?.(route);
      return;
    }
    if (this.current) {
      const prev = this.options.pages[this.current];
      prev.leave?.();
      prev.el.hidden = true;
    } else {
      // First apply: hide every page except the active one.
      for (const [name, page] of Object.entries(this.options.pages)) {
        if (name !== route.name) page.el.hidden = true;
      }
    }
    this.current = route.name;
    const next = this.options.pages[route.name];
    next.el.hidden = false;
    next.enter?.(route.params);
    this.options.onNavigate?.(route);
  }

  private parse(hash: string): Route {
    const parts = hash.replace(/^#/, "").split("/").filter(Boolean);
    if (parts[0] === "train") return { name: "train", params: { seedId: parts[1] ?? "" } };
    if (parts[0] === "report") return { name: "report", params: { sessionId: parts[1] ?? "" } };
    if (parts[0] === "create") return { name: "create", params: {} };
    if (parts[0] === "avatars") return { name: "avatars", params: {} };
    return { name: "library", params: {} };
  }
}
