










const DISCIPLINE_TAG                         = {
  Fitness: "FITNESS · 抖音热推",
  Imported: "IMPORTED · 我的虚拟教练",
};

/**
 * Seed wall: every playable coach clip as a big card with cover and training
 * stats, the import entry card, and the recent-sessions strip.
 */
export class LibraryPage                 {
  el             ;
          options                    ;

  constructor(options                    ) {
    this.options = options;
    this.el = options.el;
  }

  enter()       {
    this.render();
  }

          render()       {
    const cards = this.options.order
      .map((id) => this.options.exercises[id])
      .filter((exercise)                             => Boolean(exercise))
      .map((exercise) => {
        const tag = DISCIPLINE_TAG[exercise.discipline] ?? exercise.discipline.toUpperCase();
        const frames = exercise.clip ? `${exercise.clip.frames.length}F` : "—";
        const thumb = exercise.clip?.thumbnails[0];
        const sessions = this.options.archive.forExercise(exercise.id);
        const best = sessions.reduce((acc, s) => Math.max(acc, s.score), 0);
        const stats =
          sessions.length > 0 ? `${sessions.length} 场 · BEST ${best}` : "未完成训练";
        return `
          <button type="button" class="library-card" data-seed="${exercise.id}">
            ${thumb ? `<span class="library-cover" style="background-image:url('${thumb}')"></span>` : `<span class="library-cover is-empty">NO COVER</span>`}
            <span class="library-card-tag">${tag}</span>
            <strong class="library-card-name">${exercise.name}</strong>
            <span class="library-card-meta">
              <span>${exercise.target}</span>
              <b>${exercise.durationSeconds.toFixed(1)}s · ${frames} · ${stats}</b>
            </span>
            <span class="library-card-cta">进入训练舱 →</span>
          </button>
        `;
      })
      .join("");

    const history = this.options.archive.list().slice(0, 6);
    const historyRows = history
      .map((session) => {
        const date = new Date(session.finishedAt);
        const label = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
        return `
          <button type="button" class="library-history-row" data-session="${session.id}">
            <span>${session.exerciseName}</span>
            <b>${session.score}</b>
            <span>${label}</span>
          </button>
        `;
      })
      .join("");

    this.el.innerHTML = `
      <section class="library-hero">
        <p class="eyebrow">01 · LIBRARY / 动作库</p>
        <h2>选择你的动作教练</h2>
        <p class="library-sub">标准动作视频 → ACTION DNA → 实时跟练评分</p>
      </section>
      <section class="library-grid">
        ${cards}
        <button type="button" class="library-card is-create" data-nav-create>
          <span class="library-create-plus">+</span>
          <strong class="library-card-name">导入新动作</strong>
          <span class="library-card-meta"><span>上传 3-15s 全身视频，生成你的虚拟教练</span></span>
          <span class="library-card-cta">进入创作工坊 →</span>
        </button>
      </section>
      ${
        history.length > 0
          ? `<section class="library-history">
              <div class="library-history-head">RECENT SESSIONS · 最近训练</div>
              <div class="library-history-rows">${historyRows}</div>
            </section>`
          : ""
      }
    `;

    this.el.querySelectorAll             ("[data-seed]").forEach((card) => {
      card.addEventListener("click", () => {
        window.location.hash = `#/train/${card.dataset.seed ?? ""}`;
      });
    });
    this.el.querySelector("[data-nav-create]")?.addEventListener("click", () => {
      window.location.hash = "#/create";
    });
    this.el.querySelectorAll             ("[data-session]").forEach((row) => {
      row.addEventListener("click", () => {
        window.location.hash = `#/report/${row.dataset.session ?? ""}`;
      });
    });
  }
}
