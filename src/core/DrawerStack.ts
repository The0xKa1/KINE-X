type ForceCloseResult = boolean | void;

interface DrawerRecord {
  id: string;
  onForceClose: () => ForceCloseResult;
  trigger?: HTMLElement | undefined;
}

class DrawerStackImpl {
  private backdrop: HTMLElement | null = null;
  private registry = new Map<string, DrawerRecord>();
  private openSet = new Set<string>();
  private wired = false;

  init(backdrop: HTMLElement): void {
    if (this.wired) return;
    this.wired = true;
    this.backdrop = backdrop;
    backdrop.addEventListener("click", () => this.closeAll());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.openSet.size > 0) this.closeAll();
    });
  }

  register(record: DrawerRecord): void {
    this.registry.set(record.id, record);
  }

  open(id: string): void {
    for (const otherId of [...this.openSet]) {
      if (otherId !== id) this.tryClose(otherId);
    }
    this.openSet.add(id);
    this.backdrop?.classList.add("is-open");
    const record = this.registry.get(id);
    record?.trigger?.setAttribute("aria-expanded", "true");
  }

  close(id: string): void {
    if (!this.openSet.delete(id)) return;
    if (this.openSet.size === 0) {
      this.backdrop?.classList.remove("is-open");
    }
    const record = this.registry.get(id);
    record?.trigger?.setAttribute("aria-expanded", "false");
  }

  closeAll(): void {
    for (const id of [...this.openSet]) {
      this.tryClose(id);
    }
    if (this.openSet.size === 0) {
      this.backdrop?.classList.remove("is-open");
    }
  }

  isOpen(id: string): boolean {
    return this.openSet.has(id);
  }

  private tryClose(id: string): boolean {
    const record = this.registry.get(id);
    if (!record) {
      this.openSet.delete(id);
      return true;
    }
    const result = record.onForceClose();
    if (result === false) return false;
    return true;
  }
}

export const drawerStack = new DrawerStackImpl();
