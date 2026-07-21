

















/**
 * Minimal hash router. Pages live in the same DOM and are shown/hidden — no
 * reloads, so MediaPipe assets, the WebSocket and the camera stream survive
 * navigation. Unknown hashes fall back to the library.
 */
export class Router {
          options               ;
          current                  = null;

  constructor(options               ) {
    this.options = options;
  }

  start()       {
    window.addEventListener("hashchange", () => this.apply());
    this.apply();
  }

  navigate(path        )       {
    const hash = path.startsWith("#") ? path : `#${path}`;
    if (window.location.hash === hash) this.apply();
    else window.location.hash = hash;
  }

  currentRoute()        {
    return this.parse(window.location.hash);
  }

          apply()       {
    const route = this.parse(window.location.hash);
    // Route-scoped styling hook (e.g. the vault page's hard viewport bound).
    document.body.dataset.route = route.name;
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

          parse(hash        )        {
    const parts = hash.replace(/^#/, "").split("/").filter(Boolean);
    if (parts[0] === "train") return { name: "train", params: { seedId: parts[1] ?? "" } };
    if (parts[0] === "report") return { name: "report", params: { sessionId: parts[1] ?? "" } };
    if (parts[0] === "create") return { name: "create", params: {} };
    if (parts[0] === "avatars") return { name: "avatars", params: {} };
    return { name: "library", params: {} };
  }
}
