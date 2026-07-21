
import { prefersReducedMotion } from "../../core/motionPrefs.js?v=0.1.10";













const tagFor                         = {
  Fitness: "FITNESS · 抖音热推",
  Strength: "STRENGTH · 训练营",
  Traditional: "TRADITIONAL · 国风",
  Dance: "DANCE · 街舞精选",
  Ball: "BALL · 校园联赛",
  Imported: "IMPORTED · 我的虚拟教练",
};

export class SeedCarousel {
          options                     ;
          cards = new Map                           ();
          activeId                = null;

  constructor(options                     ) {
    this.options = options;
    this.render();
    this.bindModes();
  }

  setActive(id        )       {
    this.activeId = id;
    this.cards.forEach((card, cardId) => {
      card.classList.toggle("is-active", cardId === id);
    });
    const exercise = this.options.exercises[id];
    if (exercise) this.options.headName.textContent = exercise.name;
    const card = this.cards.get(id);
    if (!card) return;
    const container = this.options.container;
    const target =
      card.offsetLeft - container.clientWidth / 2 + card.offsetWidth / 2;
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    container.scrollTo({ left: Math.max(0, target), behavior });
  }

  setMode(mode            )       {
    this.options.modeButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.mode === mode));
  }

  syncExercise(exercise                )       {
    this.setActive(exercise.id);
  }

  addSeed(id        , exercise                )       {
    // Active state is NOT set here — it is driven by setExercise → seed:update
    // → syncExercise. Setting it per added seed would leave the highlight on
    // the last hydrated seed instead of the current exercise.
    if (this.cards.has(id)) {
      this.options.exercises[id] = exercise;
      return;
    }
    if (!this.options.order.includes(id)) this.options.order.push(id);
    this.options.exercises[id] = exercise;
    const card = this.buildCard(id, exercise);
    card.classList.add("is-entering");
    card.addEventListener("animationend", () => card.classList.remove("is-entering"), { once: true });
    this.options.container.appendChild(card);
    this.cards.set(id, card);
  }

          render()       {
    this.options.container.innerHTML = "";
    this.options.order.forEach((id) => {
      const exercise = this.options.exercises[id];
      if (!exercise) return;
      const card = this.buildCard(id, exercise);
      this.cards.set(id, card);
      this.options.container.appendChild(card);
    });
  }

          buildCard(id        , exercise                )                    {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "seed-card";
    card.dataset.id = id;
    card.setAttribute("role", "option");
    const tag = tagFor[exercise.discipline] ?? exercise.discipline.toUpperCase();
    card.innerHTML = `
      <div class="seed-tag">${tag}</div>
      <div class="seed-name">${exercise.name}</div>
      <div class="seed-meta">
        <span>${exercise.target}</span>
        <b>${exercise.durationSeconds.toFixed(1)}s</b>
      </div>
    `;
    card.addEventListener("click", () => {
      if (this.activeId === id) return;
      this.options.onSeedChange(id);
    });
    return card;
  }

          bindModes()       {
    this.options.modeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const mode = button.dataset.mode              ;
        this.options.onModeChange(mode);
        this.setMode(mode);
      });
    });
  }
}
