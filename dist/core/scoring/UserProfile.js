// User body measurements used to (a) normalize scoring across body sizes and
// (b) detect out-of-distribution MediaPipe frames where bone lengths suddenly
// disagree with the calibrated user.




















const STORAGE_KEY = "kinex.userProfile.v1";

export class UserProfileStore {
          profile                     = null;
          listeners                                               = [];

  constructor() {
    this.profile = readPersisted();
  }

  get()                     {
    return this.profile;
  }

  set(profile                    )       {
    this.profile = profile;
    persist(profile);
    this.listeners.forEach((fn) => fn(profile));
  }

  onChange(listener                                       )             {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((fn) => fn !== listener);
    };
  }
}

function readPersisted()                     {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw)               ;
    if (typeof parsed.heightMeters !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function persist(profile                    )       {
  try {
    if (!profile) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    }
  } catch {
    // localStorage may be disabled — ignore.
  }
}
