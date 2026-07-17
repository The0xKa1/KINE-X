import { modalA11y,                      } from "../../core/modalA11y.js";

                            
                    
                           
                   
                     
                    
                   
                      
                          
                              
                                                                         
                                 
                             
 

const RECORD_MS = 4000;

/**
 * Records the live 3D stage into a real webm clip via MediaRecorder —
 * replaces the old fake progress + fake QR with an actual deliverable.
 */
export class DnaExport {
          options                  ;
          a11y                 ;
          recorder                       = null;
          progressRaf = 0;
          blobUrl                = null;

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

  open()       {
    this.options.root.classList.add("is-open");
    this.options.root.setAttribute("aria-hidden", "false");
    this.a11y.activate();
    this.options.result.style.display = "none";
    this.options.bar.style.width = "0%";
    this.options.label.textContent = "0%";
    this.revokeBlob();

    const canvas = this.options.stageCanvas;
    const canRecord =
      typeof MediaRecorder !== "undefined" && typeof canvas.captureStream === "function";
    if (!canRecord) {
      this.options.head.textContent = "当前浏览器不支持视频录制";
      this.options.sub.textContent = "请使用最新版 Chrome / Edge / Safari 再试";
      return;
    }

    this.options.head.textContent = "正在录制你的 3D 动作…";
    this.options.sub.textContent = `录制舞台 ${RECORD_MS / 1000} 秒 · webm 直出`;
    this.startRecording(canvas);
  }

  close()       {
    this.options.root.classList.remove("is-open");
    this.options.root.setAttribute("aria-hidden", "true");
    this.a11y.deactivate();
    this.stopRecording();
    this.revokeBlob();
  }

          startRecording(canvas                   )       {
    const stream = canvas.captureStream(30);
    const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) =>
      MediaRecorder.isTypeSupported(t),
    );
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this.recorder = recorder;
    const chunks         = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      this.blobUrl = URL.createObjectURL(blob);
      const label = this.options.getSeedLabel();
      this.options.video.src = this.blobUrl;
      this.options.download.href = this.blobUrl;
      this.options.download.download = `kinex-dna-${label}.webm`;
      this.options.head.textContent = "已生成 · 3D 动作视频";
      this.options.sub.textContent = `seed#${label} · ${(blob.size / 1024 / 1024).toFixed(1)} MB · 可直接投递`;
      this.options.result.style.display = "grid";
    };

    const startedAt = performance.now();
    const tick = () => {
      const elapsed = performance.now() - startedAt;
      const pct = Math.min(100, (elapsed / RECORD_MS) * 100);
      this.options.bar.style.width = `${pct}%`;
      this.options.label.textContent = `${Math.floor(pct)}%`;
      if (elapsed < RECORD_MS && this.recorder) {
        this.progressRaf = requestAnimationFrame(tick);
      } else {
        this.stopRecording();
      }
    };
    recorder.start(250);
    this.progressRaf = requestAnimationFrame(tick);
  }

          stopRecording()       {
    if (this.progressRaf) {
      cancelAnimationFrame(this.progressRaf);
      this.progressRaf = 0;
    }
    if (this.recorder) {
      try {
        if (this.recorder.state !== "inactive") this.recorder.stop();
      } catch {
        // already stopped
      }
      this.recorder = null;
    }
  }

          revokeBlob()       {
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
  }
}
