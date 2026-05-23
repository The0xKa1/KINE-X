import { modalA11y,                      } from "../../core/modalA11y.js";

                            
                    
                           
                   
                     
                    
                   
                  
                      
 

export class DnaExport {
          options                  ;
          timer = 0;
          rendered = false;
          a11y                 ;

  constructor(options                  ) {
    this.options = options;
    this.a11y = modalA11y({
      root: this.options.root,
      onEscape: () => this.close(),
      initialFocus: () => this.options.closeButton               ,
    });
    this.options.closeButton.addEventListener("click", () => this.close());
    this.options.root.addEventListener("click", (event) => {
      if (event.target === this.options.root) this.close();
    });
  }

  open(seedLabel        )       {
    this.options.root.classList.add("is-open");
    this.options.root.setAttribute("aria-hidden", "false");
    this.a11y.activate();
    this.options.head.textContent = "渲染 DNA 视频中…";
    this.options.sub.textContent = "正在把你的动作打成抖音可一键投递的格式";
    this.options.qr.style.display = "none";
    this.options.bar.style.width = "0%";
    this.options.label.textContent = "0%";
    this.runProgress(seedLabel);
  }

  close()       {
    this.options.root.classList.remove("is-open");
    this.options.root.setAttribute("aria-hidden", "true");
    this.a11y.deactivate();
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = 0;
    }
  }

          runProgress(seedLabel        )       {
    if (this.timer) window.clearInterval(this.timer);
    let progress = 0;
    this.timer = window.setInterval(() => {
      const step = 4 + Math.random() * 8;
      progress = Math.min(100, progress + step);
      this.options.bar.style.width = `${progress}%`;
      this.options.label.textContent = `${Math.floor(progress)}%`;
      if (progress >= 100) {
        window.clearInterval(this.timer);
        this.timer = 0;
        this.showQr(seedLabel);
      }
    }, 80);
  }

          showQr(seedLabel        )       {
    this.options.head.textContent = "已生成 · 抖音扫码即看";
    this.options.sub.textContent = `seed#${seedLabel} · 你的 3D 分身已就位`;
    this.options.qr.style.display = "grid";
    if (!this.rendered) {
      this.renderFakeQr();
      this.rendered = true;
    }
  }

          renderFakeQr()       {
    this.options.qrCode.innerHTML = "";
    const seedPattern = [
      "1111111000111111",
      "1000001011000001",
      "1011101001011101",
      "1011101010011101",
      "1011101001011101",
      "1000001010000001",
      "1111111010101111",
      "0000000100000000",
      "1011010110011010",
      "1100101001100101",
      "0010110011001100",
      "1101001100110011",
      "0000000110100110",
      "1111111011011001",
      "1000001000110011",
      "1011101011001100",
    ];
    seedPattern.forEach((row) => {
      [...row].forEach((cell) => {
        const dot = document.createElement("i");
        if (cell === "0") dot.classList.add("off");
        this.options.qrCode.appendChild(dot);
      });
    });
  }
}
