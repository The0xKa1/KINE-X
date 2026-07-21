









import { drawerStack } from "../../core/DrawerStack.js?v=0.1.3";



































const STORAGE_KEY = "kinex.cameraSettings.v1";
















const RESOLUTION_PRESETS                                                                         = [
  { value: "960x540", label: "960 × 540 (轻量)", width: 960, height: 540 },
  { value: "1280x720", label: "1280 × 720 (标配)", width: 1280, height: 720 },
  { value: "1920x1080", label: "1920 × 1080 (高清)", width: 1920, height: 1080 },
];

export class CameraSettings {
          options                       ;
          isOpen = false;
          safeZone = false;
          persona               = "biomech";
          aiHighlightTimer                = null;

  constructor(options                       ) {
    this.options = options;
    drawerStack.register({
      id: "camera",
      onForceClose: () => this.close(),
      trigger: this.options.trigger,
    });
    this.populateResolution();
    this.restore();
    this.bindEvents();
    this.syncControls();
    this.refreshCalibrationLabel();
    this.options.profileStore.onChange(() => this.refreshCalibrationLabel());
    this.options.calibration.onChange(() => this.refreshCalibrationLabel());
    this.options.callbacks.onSafeZoneChange(this.safeZone);
  }

  getPersona()               {
    return this.persona;
  }

  getMllmConfig()                     {
    return this.readLlmConfig(this.options.mllmModel);
  }

  getCoachConfig()                     {
    return this.readLlmConfig(this.options.coachModel);
  }

  open()       {
    this.isOpen = true;
    this.options.drawer.classList.add("is-open");
    drawerStack.open("camera");
    void this.refreshDevices();
  }

  openAiSettings()       {
    this.open();
    if (this.aiHighlightTimer !== null) window.clearTimeout(this.aiHighlightTimer);
    window.requestAnimationFrame(() => {
      this.options.aiApiSection.scrollIntoView({ block: "start" });
      this.options.aiApiSection.classList.add("is-targeted");
      const target =
        [this.options.llmBaseUrl, this.options.llmApiKey, this.options.mllmModel, this.options.coachModel]
          .find((input) => !input.value.trim()) ?? this.options.coachModel;
      target.focus({ preventScroll: true });
      this.aiHighlightTimer = window.setTimeout(() => {
        this.options.aiApiSection.classList.remove("is-targeted");
        this.aiHighlightTimer = null;
      }, 1600);
    });
  }

  close()       {
    this.isOpen = false;
    this.options.drawer.classList.remove("is-open");
    drawerStack.close("camera");
    this.options.aiApiSection.classList.remove("is-targeted");
  }

  toggle()       {
    if (this.isOpen) this.close();
    else this.open();
  }

          bindEvents()       {
    this.options.trigger.addEventListener("click", () => this.toggle());
    this.options.closeButton.addEventListener("click", () => this.close());

    this.options.deviceSelect.addEventListener("change", () => {
      const value = this.options.deviceSelect.value;
      const deviceId = value === "" ? null : value;
      void this.options.webcam.applySettings({ deviceId }).then(() => this.persist());
    });

    this.options.resolutionSelect.addEventListener("change", () => {
      const preset = RESOLUTION_PRESETS.find((p) => p.value === this.options.resolutionSelect.value);
      if (!preset) return;
      void this.options.webcam
        .applySettings({ resolution: { width: preset.width, height: preset.height } })
        .then(() => this.persist());
    });

    this.options.fitSelect.addEventListener("change", () => {
      const fit = this.options.fitSelect.value            ;
      void this.options.webcam.applySettings({ fit }).then(() => this.persist());
    });

    this.options.mirrorToggle.addEventListener("change", () => {
      void this.options.webcam
        .applySettings({ mirror: this.options.mirrorToggle.checked })
        .then(() => this.persist());
    });

    this.options.safeZoneToggle.addEventListener("change", () => {
      this.safeZone = this.options.safeZoneToggle.checked;
      this.options.callbacks.onSafeZoneChange(this.safeZone);
      this.persist();
    });

    this.options.modelSelect.addEventListener("change", () => {
      const model = this.options.modelSelect.value             ;
      this.options.landmarker.setModel(model);
      this.persist();
    });

    const bindModality = (toggle                  , kind              ) => {
      toggle.addEventListener("change", () => {
        this.options.landmarker.setEnabled(kind, toggle.checked);
        this.persist();
      });
    };
    bindModality(this.options.modalityPoseToggle, "pose");
    bindModality(this.options.modalityHandToggle, "hand");
    bindModality(this.options.modalityFaceToggle, "face");

    this.options.recalibrateButton.addEventListener("click", () => {
      if (!this.options.webcam.isActive() || this.options.webcam.getMode() !== "camera") {
        this.options.calibrationStatusLabel.textContent = "请先开启摄像头";
        return;
      }
      this.options.calibration.start();
    });

    const persistLlm = () => {
      this.persist();
      this.refreshLlmStatus();
    };
    this.options.llmBaseUrl.addEventListener("change", persistLlm);
    this.options.llmApiKey.addEventListener("change", persistLlm);
    this.options.mllmModel.addEventListener("change", persistLlm);
    this.options.coachModel.addEventListener("change", persistLlm);
    this.options.llmClearButton.addEventListener("click", () => this.clearLlmSettings());

    this.options.personaSelect.addEventListener("change", () => {
      const value = this.options.personaSelect.value;
      if (value === "biomech" || value === "baduanjin") {
        this.persona = value;
      }
      this.persist();
    });
  }

          async refreshDevices()                {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    let devices                    = [];
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch {
      return;
    }
    const cameras = devices.filter((d) => d.kind === "videoinput");
    const current = this.options.webcam.getSettings().deviceId;
    const select = this.options.deviceSelect;
    select.textContent = "";
    const autoOption = document.createElement("option");
    autoOption.value = "";
    autoOption.textContent = "自动 (面向自己)";
    select.appendChild(autoOption);
    cameras.forEach((cam, index) => {
      const opt = document.createElement("option");
      opt.value = cam.deviceId;
      opt.textContent = cam.label || `摄像头 ${index + 1}`;
      select.appendChild(opt);
    });
    select.value = current ?? "";
  }

          populateResolution()       {
    const select = this.options.resolutionSelect;
    select.textContent = "";
    RESOLUTION_PRESETS.forEach((preset) => {
      const opt = document.createElement("option");
      opt.value = preset.value;
      opt.textContent = preset.label;
      select.appendChild(opt);
    });
  }

          syncControls()       {
    const settings = this.options.webcam.getSettings();
    const presetValue = `${settings.resolution.width}x${settings.resolution.height}`;
    if (RESOLUTION_PRESETS.some((p) => p.value === presetValue)) {
      this.options.resolutionSelect.value = presetValue;
    }
    this.options.fitSelect.value = settings.fit;
    this.options.mirrorToggle.checked = settings.mirror;
    this.options.safeZoneToggle.checked = this.safeZone;
    this.options.deviceSelect.value = settings.deviceId ?? "";
    this.options.modelSelect.value = this.options.landmarker.getModel();
    this.options.modalityPoseToggle.checked = this.options.landmarker.isEnabled("pose");
    this.options.modalityHandToggle.checked = this.options.landmarker.isEnabled("hand");
    this.options.modalityFaceToggle.checked = this.options.landmarker.isEnabled("face");
    this.options.personaSelect.value = this.persona;
    this.refreshLlmStatus();
  }

          refreshCalibrationLabel()       {
    const profile = this.options.profileStore.get();
    const status = this.options.calibration.getStatus();
    if (status.phase === "sampling") {
      this.options.calibrationStatusLabel.textContent = `采集中 ${Math.round(status.progress * 100)}%`;
      return;
    }
    if (status.phase === "waiting") {
      this.options.calibrationStatusLabel.textContent = "等待入镜";
      return;
    }
    if (!profile) {
      this.options.calibrationStatusLabel.textContent = "未校准";
      return;
    }
    this.options.calibrationStatusLabel.textContent = `身高 ${profile.heightMeters.toFixed(2)}m`;
  }

          persist()       {
    const payload                    = {
      settings: this.options.webcam.getSettings(),
      safeZone: this.safeZone,
      model: this.options.landmarker.getModel(),
      modalities: {
        pose: this.options.landmarker.isEnabled("pose"),
        hand: this.options.landmarker.isEnabled("hand"),
        face: this.options.landmarker.isEnabled("face"),
      },
      persona: this.persona,
      llm: {
        baseUrl: this.options.llmBaseUrl.value.trim(),
        apiKey: this.options.llmApiKey.value.trim(),
        mllmModel: this.options.mllmModel.value.trim(),
        coachModel: this.options.coachModel.value.trim(),
      },
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // localStorage may be disabled — ignore.
    }
  }

          restore()       {
    let raw                = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw)                     ;
      if (parsed.settings) {
        void this.options.webcam.applySettings(parsed.settings);
      }
      this.safeZone = !!parsed.safeZone;
      if (parsed.model) {
        this.options.landmarker.setModel(parsed.model);
      }
      if (parsed.modalities) {
        (Object.keys(parsed.modalities)                  ).forEach((kind) => {
          const value = parsed.modalities?.[kind];
          if (typeof value === "boolean") {
            this.options.landmarker.setEnabled(kind, value);
          }
        });
      }
      if (parsed.persona === "biomech" || parsed.persona === "baduanjin") {
        this.persona = parsed.persona;
      }
      if (parsed.llm) {
        this.options.llmBaseUrl.value = parsed.llm.baseUrl ?? "";
        this.options.llmApiKey.value = parsed.llm.apiKey ?? "";
        const legacyModel = parsed.llm.model ?? "";
        this.options.mllmModel.value = parsed.llm.mllmModel ?? legacyModel;
        this.options.coachModel.value = parsed.llm.coachModel ?? legacyModel;
      }
    } catch {
      // ignore corrupted state
    }
  }

          readLlmConfig(modelInput                  )                     {
    const baseUrl = this.options.llmBaseUrl.value.trim();
    const apiKey = this.options.llmApiKey.value.trim();
    const model = modelInput.value.trim();
    if (!baseUrl || !apiKey || !model) return null;
    return { baseUrl, apiKey, model };
  }

          refreshLlmStatus()       {
    const mllmReady = Boolean(this.getMllmConfig());
    const coachReady = Boolean(this.getCoachConfig());
    this.options.llmStatusLabel.textContent =
      mllmReady && coachReady ? "MLLM / COACH READY" : mllmReady ? "MLLM READY" : coachReady ? "COACH READY" : "NOT CONFIGURED";
  }

          clearLlmSettings()       {
    this.options.llmBaseUrl.value = "";
    this.options.llmApiKey.value = "";
    this.options.mllmModel.value = "";
    this.options.coachModel.value = "";
    this.persist();
    this.refreshLlmStatus();
    const original = this.options.llmClearButton.textContent;
    this.options.llmClearButton.textContent = "已清除本机 API 配置 ✓";
    this.options.llmClearButton.disabled = true;
    window.setTimeout(() => {
      this.options.llmClearButton.textContent = original;
      this.options.llmClearButton.disabled = false;
    }, 1400);
  }
}
