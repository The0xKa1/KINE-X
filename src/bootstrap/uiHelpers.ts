import type { ExerciseConfig } from "../types/motion.js";

type ConnectionKind = "ready" | "busy" | "offline";

export class ConnectionIndicator {
  private text: HTMLElement;
  private dot: HTMLElement;
  private root: HTMLElement | null;

  constructor(text: HTMLElement, dot: HTMLElement) {
    this.text = text;
    this.dot = dot;
    this.root = text.closest<HTMLElement>(".connection");
  }

  set(text: string, kind: ConnectionKind): void {
    this.text.textContent = text;
    this.dot.classList.toggle("is-busy", kind === "busy");
    this.dot.classList.toggle("is-offline", kind === "offline");
  }

  onClick(handler: () => void): void {
    const host = this.root ?? this.text;
    host.setAttribute("role", "button");
    host.setAttribute("tabindex", "0");
    host.style.cursor = "pointer";
    host.addEventListener("click", handler);
    host.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handler();
      }
    });
  }
}

export function renderDnaList(host: HTMLElement, exercise: ExerciseConfig): void {
  host.innerHTML = "";
  Object.entries(exercise.params).forEach(([key, value]) => {
    const row = document.createElement("div");
    row.innerHTML = `<dt>${key}</dt><dd title="${value}">${value}</dd>`;
    host.appendChild(row);
  });
}

export function beatsPerMinute(motion: string, speed: number): number {
  const base = motion === "bounce" ? 110 : motion === "throw" ? 86 : motion === "flow" ? 64 : 92;
  return base * speed * 1.4;
}
