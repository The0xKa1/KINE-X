                                                 
import { ImportFlow,                                               } from "../../core/import/ImportFlow.js";
import { $ } from "../../bootstrap/dom.js";

                             
                  
                     
                                             
 

/**
 * Video → coach wizard: upload → optional MLLM segmentation → backend parse →
 * apply to library. The heavy lifting lives in ImportFlow; this page renders
 * the step rail and wires the DOM.
 */
export class CreatePage                 {
  el             ;
          options                   ;
          initialized = false;

  constructor(options                   ) {
    this.options = options;
    this.el = options.el;
  }

  enter()       {
    if (this.initialized) return;
    this.initialized = true;
    this.render();
    this.initFlow();
  }

          render()       {
    this.el.innerHTML = `
      <div class="create-scroll">
        <header class="create-head">
          <div>
            <span class="eyebrow">04 · CREATE / 创作工坊</span>
            <h2>视频 → 虚拟教练</h2>
          </div>
          <ol class="create-steps">
            <li data-step="file"><b>01</b>上传</li>
            <li data-step="segment"><b>02</b>分片</li>
            <li data-step="parse"><b>03</b>解析</li>
            <li data-step="apply"><b>04</b>入库</li>
          </ol>
        </header>

        <div class="create-grid">
          <section class="create-block">
            <div class="create-block-head"><h3>01 · SOURCE</h3><span>standard motion clip</span></div>
            <label id="createDrop" class="import-drop" for="createFile">
              <strong>选择视频或拖拽到这里</strong>
              <span>建议正面 / 侧面拍摄、全身入境的 mp4，时长 3-15 秒</span>
              <input id="createFile" type="file" accept="video/*" hidden />
            </label>
            <video id="createPreview" class="import-preview" muted playsinline></video>
            <label class="settings-field">
              <span>动作类型</span>
              <select id="createMotion">
                <option value="flow">Flow · 通用 / 流动</option>
                <option value="squat">Squat · 下蹲</option>
                <option value="hinge">Hinge · 髋铰</option>
                <option value="bounce">Bounce · 弹跳</option>
                <option value="throw">Throw · 投掷</option>
              </select>
            </label>
          </section>

          <section class="create-block">
            <div class="create-block-head"><h3>02 · SEGMENT</h3><span>可选：MLLM 分片</span></div>
            <button id="createSegment" class="secondary-button" type="button">用 MLLM 切片</button>
            <p id="createSegmentSummary" class="segment-summary"></p>
            <div id="createSegmentList" class="segment-list is-empty"></div>
            <p class="settings-hint">不选段时整段导入。选中某段后，后端只对该时间区间抽帧/推理。</p>
          </section>

          <section class="create-block">
            <div class="create-block-head"><h3>03 · PARSE</h3><span id="createStatus">等待上传视频</span></div>
            <div class="import-progress"><i id="createProgress"></i></div>
            <div class="import-progress-label" id="createProgressLabel">—</div>
            <button id="createStart" class="secondary-button" type="button">开始解析</button>
            <p class="settings-hint">视频上传到 SAM3D 导入后端；模型在 GPU 上跑，~30s/100 帧。</p>
          </section>

          <section class="create-block">
            <div class="create-block-head"><h3>04 · APPLY</h3><span>加入动作库</span></div>
            <button id="createApply" class="primary-button" type="button">应用为当前教练</button>
            <p class="settings-hint">应用后自动进入训练舱，新种子会保留在动作库中。</p>
          </section>
        </div>
      </div>
    `;
  }

          initFlow()       {
    new ImportFlow({
      fileInput: $("#createFile")                    ,
      dropZone: $("#createDrop"),
      motionSelect: $("#createMotion")                     ,
      startButton: $("#createStart")                     ,
      applyButton: $("#createApply")                     ,
      segmentButton: $("#createSegment")                     ,
      segmentList: $("#createSegmentList"),
      segmentSummary: $("#createSegmentSummary"),
      progressBar: $("#createProgress"),
      progressLabel: $("#createProgressLabel"),
      statusLabel: $("#createStatus"),
      preview: $("#createPreview")                    ,
      backendUrl: this.options.backendUrl,
      onApply: (payload) => this.options.onApply(payload),
      onStateChange: (state) => this.syncSteps(state),
    });
  }

          syncSteps(state                 )       {
    if (state === "error") return;
    // done = completed step count; active = 1-based active step index.
    const map                                                                              = {
      empty: { done: 0, active: -1 },
      file: { done: 1, active: 2 },
      segmenting: { done: 1, active: 2 },
      segmented: { done: 2, active: 3 },
      parsing: { done: 2, active: 3 },
      ready: { done: 3, active: 4 },
      applied: { done: 4, active: -1 },
    };
    const { done, active } = map[state];
    this.el.querySelectorAll             (".create-steps li").forEach((li, index) => {
      const stepNo = index + 1;
      li.classList.toggle("is-done", stepNo <= done);
      li.classList.toggle("is-active", stepNo === active);
    });
  }
}
