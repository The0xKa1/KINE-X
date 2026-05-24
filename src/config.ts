export const API_BASE_URL = (() => {
  const STORAGE_KEY = "holomotion.apiBaseUrl";
  const trim = (raw: string) => raw.replace(/\/$/, "");

  const fromQuery = new URLSearchParams(window.location.search).get("api");
  if (fromQuery) {
    try {
      localStorage.setItem(STORAGE_KEY, fromQuery);
    } catch {
      // ignore — localStorage may be disabled
    }
    return trim(fromQuery);
  }

  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  if (stored) return trim(stored);

  const protocol = window.location.protocol || "http:";
  const hostname = window.location.hostname || "localhost";
  return `${protocol}//${hostname}:8766`;
})();
