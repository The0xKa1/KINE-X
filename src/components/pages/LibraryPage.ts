import type { Page } from "../../core/Router.js";
import type { SessionArchive } from "../../core/scoring/SessionArchive.js";
import type { ExerciseConfig } from "../../types/motion.js";

interface LibraryPageOptions {
  el: HTMLElement;
  exercises: Record<string, ExerciseConfig>;
  order: string[];
  archive: SessionArchive;
}

const DISCIPLINE_TAG: Record<string, string> = {
  Fitness: "FITNESS · 抖音热推",
  Imported: "IMPORTED · 我的虚拟教练",
};

/**
 * Seed wall: every playable coach clip as a big card with cover and training
 * stats, the import entry card, and the recent-sessions strip.
 */
export class LibraryPage implements Page {
  el: HTMLElement;
  private options: LibraryPageOptions;

  constructor(options: LibraryPageOptions) {
    this.options = options;
    this.el = options.el;
  }

  enter(): void {
    this.render();
  }

  private render(): void {
    const cards = this.options.order
      .map((id) => this.options.exercises[id])
      .filter((exercise): exercise is ExerciseConfig => Boolean(exercise))
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

    const history = this.options.archive.list();
    const historyRows = history
      .map((session) => {
        const date = new Date(session.finishedAt);
        const label = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
        return `
          <div class="library-history-row">
            <button type="button" class="library-history-open" data-session="${session.id}" aria-label="查看这次训练报告">
              <span>${session.exerciseName}</span>
              <b>${session.score}</b>
              <span>${label}</span>
            </button>
            <button type="button" class="library-history-delete" data-delete-session="${session.id}" aria-label="删除这次训练记录">删除</button>
          </div>
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

    this.el.querySelectorAll<HTMLElement>("[data-seed]").forEach((card) => {
      card.addEventListener("click", () => {
        window.location.hash = `#/train/${card.dataset.seed ?? ""}`;
      });
    });
    this.el.querySelector("[data-nav-create]")?.addEventListener("click", () => {
      window.location.hash = "#/create";
    });
    this.el.querySelectorAll<HTMLElement>("[data-session]").forEach((row) => {
      row.addEventListener("click", () => {
        window.location.hash = `#/report/${row.dataset.session ?? ""}`;
      });
    });
    this.el.querySelectorAll<HTMLButtonElement>("[data-delete-session]").forEach((button) => {
      button.addEventListener("click", () => {
        const sessionId = button.dataset.deleteSession ?? "";
        const session = this.options.archive.get(sessionId);
        if (!session) {
          this.render();
          return;
        }
        const confirmed = window.confirm(`确定删除「${session.exerciseName}」这次训练记录吗？此操作无法撤销。`);
        if (!confirmed) return;
        if (this.options.archive.remove(sessionId)) this.render();
      });
    });
  }
}
