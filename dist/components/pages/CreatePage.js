
import { ImportFlow,                                               } from "../../core/import/ImportFlow.js?v=0.1.12";
import {
  buildAvatarPickerChoices,

} from "../../core/avatar/AvatarBindingController.js?v=0.1.12";
import { AvatarRegistryClient } from "../../core/avatar/AvatarRegistryClient.js?v=0.1.12";
import { $ } from "../../bootstrap/dom.js?v=0.1.12";










/**
 * Creation studio for video coaches: upload → optional MLLM segmentation →
 * backend parse → library. Reusable photo identities live in the dedicated
 * Avatar Vault; this page only offers an optional existing-identity picker.
 */
export class CreatePage                 {
  el             ;
          options                   ;
          initialized = false;
                   avatarClient                      ;
          selectedAvatarId                = null;
          pickerGeneration = 0;
          active = false;

  constructor(options                   ) {
    this.options = options;
    this.el = options.el;
    this.avatarClient = new AvatarRegistryClient(options.backendUrl);
  }

  enter()       {
    this.active = true;
    if (!this.initialized) {
      this.initialized = true;
      this.render();
      this.initFlow();
    }
    void this.refreshAvatarPicker();
  }

  leave()       {
    this.active = false;
    this.pickerGeneration += 1;
  }

          render()       {
    this.el.innerHTML = `
      <div class="create-scroll">
        <header class="create-head">
          <div>
            <span class="eyebrow">04 · CREATE / 创作工坊</span>
            <h2 id="createTitle">视频 → 虚拟教练</h2>
          </div>
          <div class="create-head-side">
            <a class="create-vault-cta" href="#/avatars">
              <span>PHOTO → AVATAR</span>
              <strong>前往分身身份库 →</strong>
              <small>上传与管理分身，不中断当前视频导入</small>
            </a>
            <ol class="create-steps" id="createSteps">
              <li data-step="file"><b>01</b>上传</li>
              <li data-step="segment"><b>02</b>分片</li>
              <li data-step="parse"><b>03</b>解析</li>
              <li data-step="apply"><b>04</b>入库</li>
            </ol>
          </div>
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
              </select>
            </label>
            <fieldset class="create-avatar-picker" aria-describedby="createAvatarPickerStatus">
              <legend>可选分身</legend>
              <div class="create-avatar-picker-head">
                <span>选择一个已有身份，动作导入不会等待分身准备</span>
                <a href="#/avatars">管理身份库</a>
              </div>
              <div id="createAvatarPicker" class="create-avatar-picker-list"></div>
              <div class="create-avatar-picker-foot">
                <p id="createAvatarPickerStatus" class="settings-hint">正在读取身份库…</p>
                <button id="createAvatarPickerRetry" class="text-button" type="button" hidden>重试</button>
              </div>
            </fieldset>
          </section>

          <section class="create-block">
            <div class="create-block-head"><h3>02 · SEGMENT</h3><span>可选：MLLM 分片</span></div>
            <button id="createSegment" class="secondary-button" type="button">用 MLLM 切片</button>
            <p id="createSegmentSummary" class="segment-summary"></p>
            <div id="createSegmentList" class="segment-list is-empty"></div>
            <p class="settings-hint">MLLM 分片和赛后分析都使用你自己的 OpenAI-compatible API，不经过 KINE//X 服务器。</p>
            <button id="createApiSettings" class="create-api-settings" type="button">
              <span>MLLM + POST-MATCH</span>
              <strong>配置 AI API →</strong>
              <small>服务地址与 Key 共用，两个模型分别填写</small>
            </button>
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

    this.renderAvatarPicker(buildAvatarPickerChoices([]));
    ($("#createAvatarPickerRetry")                     ).addEventListener(
      "click",
      () => void this.refreshAvatarPicker(),
    );
    ($("#createApiSettings")                     ).addEventListener(
      "click",
      () => this.options.onOpenSettings(),
    );
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
      getMllmConfig: () => this.options.getMllmConfig(),
      getSelectedAvatarId: () => this.selectedAvatarId,
      onApply: (payload) => this.options.onApply(payload),
      onStateChange: (state) => this.syncSteps(state),
    });
  }

          async refreshAvatarPicker()                {
    const generation = ++this.pickerGeneration;
    const status = $("#createAvatarPickerStatus");
    const retry = $("#createAvatarPickerRetry")                     ;
    status.textContent = "正在读取身份库…";
    retry.hidden = true;
    try {
      const records = await this.avatarClient.list();
      if (!this.active || generation !== this.pickerGeneration) return;
      const choices = buildAvatarPickerChoices(records);
      const selected = choices.find(
        (choice) => choice.avatarId === this.selectedAvatarId && !choice.disabled,
      );
      if (!selected) this.selectedAvatarId = null;
      this.renderAvatarPicker(choices);
      const readyCount = choices.filter((choice) => choice.avatarId && !choice.disabled).length;
      status.textContent = readyCount > 0
        ? `${readyCount} 个身份可用；不选择时只生成普通教练。`
        : "暂无可用身份；仍可正常生成普通教练。";
    } catch (error) {
      if (!this.active || generation !== this.pickerGeneration) return;
      this.selectedAvatarId = null;
      this.renderAvatarPicker(buildAvatarPickerChoices([]));
      status.textContent = error instanceof Error
        ? `${error.message}；动作仍可正常解析。`
        : "分身服务暂不可用；动作仍可正常解析。";
      retry.hidden = false;
    }
  }

          renderAvatarPicker(choices                      )       {
    const host = $("#createAvatarPicker");
    host.textContent = "";

    const field = document.createElement("label");
    field.className = "settings-field create-avatar-select";
    const select = document.createElement("select");
    select.setAttribute("aria-label", "可选分身");
    choices.forEach((choice) => {
      const option = document.createElement("option");
      option.value = choice.avatarId ?? "";
      option.disabled = choice.disabled;
      option.textContent = choice.avatarId
        ? `${choice.label} · ${pickerDetail(choice)}`
        : choice.label;
      select.appendChild(option);
    });
    // A previously selected identity may have become unavailable.
    select.value = this.selectedAvatarId ?? "";
    if (select.value !== (this.selectedAvatarId ?? "")) this.selectedAvatarId = null;
    select.addEventListener("change", () => {
      this.selectedAvatarId = select.value || null;
    });
    field.appendChild(select);
    host.appendChild(field);
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

function pickerDetail(choice                    )         {
  if (choice.status === "none") return "只导入 CoachClip 与 SMPL-X 网格";
  if (choice.status === "ready") return "身份已就绪，可在动作导入后后台绑定";
  if (choice.status === "queued") return "身份等待生成";
  if (choice.status === "running") return `身份生成中 · ${Math.round(choice.progress)}%`;
  if (choice.status === "cancelled") return "身份已取消";
  return "身份生成失败";
}
