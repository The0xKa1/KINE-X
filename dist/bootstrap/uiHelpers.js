



export class ConnectionIndicator {
          text             ;
          dot             ;
          root                    ;

  constructor(text             , dot             ) {
    this.text = text;
    this.dot = dot;
    this.root = text.closest             (".connection");
  }

  set(text        , kind                )       {
    this.text.textContent = text;
    this.dot.classList.toggle("is-busy", kind === "busy");
    this.dot.classList.toggle("is-offline", kind === "offline");
  }

  onClick(handler            )       {
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

export function renderDnaList(host             , exercise                )       {
  host.innerHTML = "";
  Object.entries(exercise.params).forEach(([key, value]) => {
    const row = document.createElement("div");
    row.innerHTML = `<dt>${key}</dt><dd title="${value}">${value}</dd>`;
    host.appendChild(row);
  });
}

export function beatsPerMinute(motion        , speed        )         {
  const base = motion === "bounce" ? 110 : motion === "throw" ? 86 : motion === "flow" ? 64 : 92;
  return base * speed * 1.4;
}
