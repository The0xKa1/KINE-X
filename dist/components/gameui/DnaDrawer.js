import { drawerStack } from "../../core/DrawerStack.js?v=0.1.5";







const DRAWER_ID = "dna";

export class DnaDrawer {
          options                  ;
          isOpen = false;

  constructor(options                  ) {
    this.options = options;
    drawerStack.register({
      id: DRAWER_ID,
      onForceClose: () => this.close(),
      trigger: this.options.trigger,
    });
    this.options.trigger.addEventListener("click", () => this.toggle());
    this.options.closeButton.addEventListener("click", () => this.close());
  }

  open()       {
    this.isOpen = true;
    this.options.drawer.classList.add("is-open");
    drawerStack.open(DRAWER_ID);
  }

  close()       {
    this.isOpen = false;
    this.options.drawer.classList.remove("is-open");
    drawerStack.close(DRAWER_ID);
  }

  toggle()       {
    if (this.isOpen) this.close();
    else this.open();
  }
}
