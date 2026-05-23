import { drawerStack } from "../../core/DrawerStack.js";

interface DnaDrawerOptions {
  drawer: HTMLElement;
  trigger: HTMLElement;
  closeButton: HTMLElement;
}

const DRAWER_ID = "dna";

export class DnaDrawer {
  private options: DnaDrawerOptions;
  private isOpen = false;

  constructor(options: DnaDrawerOptions) {
    this.options = options;
    drawerStack.register({
      id: DRAWER_ID,
      onForceClose: () => this.close(),
      trigger: this.options.trigger,
    });
    this.options.trigger.addEventListener("click", () => this.toggle());
    this.options.closeButton.addEventListener("click", () => this.close());
  }

  open(): void {
    this.isOpen = true;
    this.options.drawer.classList.add("is-open");
    drawerStack.open(DRAWER_ID);
  }

  close(): void {
    this.isOpen = false;
    this.options.drawer.classList.remove("is-open");
    drawerStack.close(DRAWER_ID);
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }
}
