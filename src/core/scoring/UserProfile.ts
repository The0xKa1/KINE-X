// User body measurements used to (a) normalize scoring across body sizes and
// (b) detect out-of-distribution MediaPipe frames where bone lengths suddenly
// disagree with the calibrated user.

export interface UserProfile {
  heightMeters: number;
  shoulderSpanMeters: number;
  hipSpanMeters: number;
  legLengthMeters: number;
  floorY: number; // world y of the floor in MediaPipe world space (after our axis flip)
  capturedAt: number;
  boneLengths: {
    lThigh: number;
    lShin: number;
    rThigh: number;
    rShin: number;
    lUpperArm: number;
    lForearm: number;
    rUpperArm: number;
    rForearm: number;
  };
}

const STORAGE_KEY = "kinex.userProfile.v1";

export class UserProfileStore {
  private profile: UserProfile | null = null;
  private listeners: Array<(profile: UserProfile | null) => void> = [];

  constructor() {
    this.profile = readPersisted();
  }

  get(): UserProfile | null {
    return this.profile;
  }

  set(profile: UserProfile | null): void {
    this.profile = profile;
    persist(profile);
    this.listeners.forEach((fn) => fn(profile));
  }

  onChange(listener: (profile: UserProfile | null) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((fn) => fn !== listener);
    };
  }
}

function readPersisted(): UserProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserProfile;
    if (typeof parsed.heightMeters !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function persist(profile: UserProfile | null): void {
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
