                                       

                        
             
                                       
                                    
 

class DrawerStackImpl {
          backdrop                     = null;
          registry = new Map                      ();
          openSet = new Set        ();
          wired = false;

  init(backdrop             )       {
    if (this.wired) return;
    this.wired = true;
    this.backdrop = backdrop;
    backdrop.addEventListener("click", () => this.closeAll());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.openSet.size > 0) this.closeAll();
    });
  }

  register(record              )       {
    this.registry.set(record.id, record);
  }

  open(id        )       {
    for (const otherId of [...this.openSet]) {
      if (otherId !== id) this.tryClose(otherId);
    }
    this.openSet.add(id);
    this.backdrop?.classList.add("is-open");
    const record = this.registry.get(id);
    record?.trigger?.setAttribute("aria-expanded", "true");
  }

  close(id        )       {
    if (!this.openSet.delete(id)) return;
    if (this.openSet.size === 0) {
      this.backdrop?.classList.remove("is-open");
    }
    const record = this.registry.get(id);
    record?.trigger?.setAttribute("aria-expanded", "false");
  }

  closeAll()       {
    for (const id of [...this.openSet]) {
      this.tryClose(id);
    }
    if (this.openSet.size === 0) {
      this.backdrop?.classList.remove("is-open");
    }
  }

  isOpen(id        )          {
    return this.openSet.has(id);
  }

          tryClose(id        )          {
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
