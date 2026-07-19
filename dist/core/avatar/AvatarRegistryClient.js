



























export class AvatarRegistryHttpError extends Error {
           status        ;

  constructor(status        , message        ) {
    super(message);
    this.name = "AvatarRegistryHttpError";
    this.status = status;
  }
}

export class AvatarRegistryOfflineError extends Error {
  constructor() {
    super("无法连接分身服务");
    this.name = "AvatarRegistryOfflineError";
  }
}

export class AvatarRegistryClient {
                   baseUrl        ;
                   fetchImpl           ;
                   schedule              ;
                   cancelSchedule                    ;
                   pollIntervalMs        ;

  constructor(baseUrl        , options                              = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.schedule = options.schedule ?? ((callback, delayMs) => window.setTimeout(callback, delayMs));
    this.cancelSchedule = options.cancelSchedule ?? ((handle) => window.clearTimeout(handle));
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
  }

  list()                                  {
    return this.request                        ("/avatars", { method: "GET" });
  }

  upload(photo      , name         )                                {
    const body = new FormData();
    body.append("photo", photo);
    const trimmed = name?.trim();
    if (trimmed) body.append("name", trimmed);
    return this.request                      ("/avatars", { method: "POST", body });
  }

  rename(avatarId        , name        )                                {
    return this.request                      (`/avatars/${encodeURIComponent(avatarId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
  }

  remove(avatarId        )                                {
    return this.request                      (`/avatars/${encodeURIComponent(avatarId)}`, {
      method: "DELETE",
    });
  }

  watch(
    onRecords                                           ,
    onError                           = () => {},
  )             {
    let active = true;
    let scheduled                = null;

    const tick = async ()                => {
      try {
        const records = await this.list();
        if (!active) return;
        onRecords(records);
        if (records.some((record) => record.status === "queued" || record.status === "running")) {
          scheduled = this.schedule(() => void tick(), this.pollIntervalMs);
        }
      } catch (error) {
        if (active) onError(error);
      }
    };

    void tick();
    return () => {
      active = false;
      if (scheduled !== null) this.cancelSchedule(scheduled);
      scheduled = null;
    };
  }

          async request   (path        , init             )             {
    let response          ;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    } catch {
      throw new AvatarRegistryOfflineError();
    }
    if (!response.ok) {
      throw new AvatarRegistryHttpError(response.status, await readErrorMessage(response));
    }
    return (await response.json())     ;
  }
}

async function readErrorMessage(response          )                  {
  try {
    const payload = (await response.json())


     ;
    if (typeof payload.detail === "string") return payload.detail;
    if (payload.detail && typeof payload.detail.error === "string") return payload.detail.error;
    if (typeof payload.error === "string") return payload.error;
  } catch {
    // Fall through to a stable status-based message.
  }
  return `分身服务请求失败（HTTP ${response.status}）`;
}
