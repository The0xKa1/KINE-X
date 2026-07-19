










const FOCUSABLE_SELECTOR =
  'button:not([disabled]):not([hidden]), [href], input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), textarea:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])';

export function modalA11y(options                  )                  {
  let prevFocus                     = null;

  const onKeydown = (event               ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      options.onEscape();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = getFocusable(options.root);
    if (focusable.length === 0) return;
    const first = focusable[0] ;
    const last = focusable[focusable.length - 1] ;
    const active = document.activeElement                      ;
    if (event.shiftKey && (active === first || !options.root.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return {
    activate() {
      prevFocus = (document.activeElement               ) ?? null;
      document.addEventListener("keydown", onKeydown);
      requestAnimationFrame(() => {
        const initial = options.initialFocus?.() ?? getFocusable(options.root)[0] ?? null;
        initial?.focus();
      });
    },
    deactivate() {
      document.removeEventListener("keydown", onKeydown);
      if (prevFocus && typeof prevFocus.focus === "function") {
        prevFocus.focus();
      }
      prevFocus = null;
    },
  };
}

function getFocusable(root             )                {
  return Array.from(root.querySelectorAll             (FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true",
  );
}
