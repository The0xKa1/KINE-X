import type { EventBus } from "../core/EventBus.js";
import type { MotionFrameBuffer } from "../core/frameBuffer.js";
import type { FrameStreamPacket, PipelineUpdate } from "../types/motion.js";

export interface MotionSocketController {
  connect(url: string): void;
  disconnect(): void;
  reconnect(): void;
  consumePacket(packet: FrameStreamPacket): void;
  status(): SocketStatus;
  latencyMs(): number;
}

export type SocketStatus = "closed" | "connecting" | "open" | "mock";

const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 8_000;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

interface PingPacket {
  type: "PING";
  t: number;
}

interface PongPacket {
  type: "PONG";
  t: number;
}

export function useWebSocket(buffer: MotionFrameBuffer, bus: EventBus): MotionSocketController {
  let socket: WebSocket | null = null;
  let currentStatus: SocketStatus = "mock";
  let currentUrl: string | null = null;
  let attempt = 0;
  let reconnectHandle: number | null = null;
  let pingHandle: number | null = null;
  let pongTimer: number | null = null;
  let lastPingSentAt = 0;
  let measuredLatencyMs = 0;
  let manuallyClosed = false;
  let malformedWarned = false;

  function emitStatus(update: PipelineUpdate): void {
    bus.emit("pipeline:update", update);
  }

  function consumePacket(packet: FrameStreamPacket): void {
    buffer.pushPacket(packet);
  }

  function clearReconnect(): void {
    if (reconnectHandle !== null) {
      window.clearTimeout(reconnectHandle);
      reconnectHandle = null;
    }
  }

  function clearPing(): void {
    if (pingHandle !== null) {
      window.clearInterval(pingHandle);
      pingHandle = null;
    }
    if (pongTimer !== null) {
      window.clearTimeout(pongTimer);
      pongTimer = null;
    }
  }

  function scheduleReconnect(): void {
    if (manuallyClosed || !currentUrl) return;
    clearReconnect();
    const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)] ?? 30_000;
    attempt += 1;
    emitStatus({ runIndex: 0, latencyMs: 0, status: "queued" });
    reconnectHandle = window.setTimeout(() => {
      reconnectHandle = null;
      if (currentUrl) openSocket(currentUrl);
    }, delay);
  }

  function sendPing(): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    lastPingSentAt = performance.now();
    const payload: PingPacket = { type: "PING", t: lastPingSentAt };
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      return;
    }
    if (pongTimer !== null) window.clearTimeout(pongTimer);
    pongTimer = window.setTimeout(() => {
      pongTimer = null;
      try {
        socket?.close();
      } catch {
        // ignore
      }
    }, PONG_TIMEOUT_MS);
  }

  function startPing(): void {
    clearPing();
    pingHandle = window.setInterval(sendPing, PING_INTERVAL_MS);
  }

  function handleMessage(event: MessageEvent<string>): void {
    let payload: unknown;
    try {
      payload = JSON.parse(event.data) as unknown;
    } catch {
      if (!malformedWarned) {
        console.warn("[useWebSocket] dropped malformed JSON frame");
        malformedWarned = true;
      }
      return;
    }
    if (!payload || typeof payload !== "object") return;
    const typed = payload as { type?: string };
    if (typed.type === "PONG") {
      const pong = payload as PongPacket;
      if (pongTimer !== null) {
        window.clearTimeout(pongTimer);
        pongTimer = null;
      }
      measuredLatencyMs = Math.max(0, performance.now() - (pong.t || lastPingSentAt));
      emitStatus({ runIndex: 2, latencyMs: Math.round(measuredLatencyMs), status: "ready" });
      return;
    }
    if (typed.type === "FRAME_STREAM") {
      consumePacket(payload as FrameStreamPacket);
    }
  }

  function openSocket(url: string): void {
    try {
      currentStatus = "connecting";
      emitStatus({ runIndex: 0, latencyMs: 0, status: "busy" });
      socket = new WebSocket(url);
      socket.onopen = () => {
        currentStatus = "open";
        attempt = 0;
        startPing();
        emitStatus({ runIndex: 1, latencyMs: 18, status: "ready" });
      };
      socket.onmessage = handleMessage;
      socket.onerror = () => {
        currentStatus = "closed";
      };
      socket.onclose = () => {
        currentStatus = "closed";
        clearPing();
        scheduleReconnect();
      };
    } catch {
      currentStatus = "closed";
      scheduleReconnect();
    }
  }

  function connect(url: string): void {
    manuallyClosed = false;
    currentUrl = url;
    attempt = 0;
    clearReconnect();
    disconnectInternal();
    openSocket(url);
  }

  function disconnectInternal(): void {
    if (socket) {
      try {
        socket.close();
      } catch {
        // ignore
      }
      socket = null;
    }
    clearPing();
  }

  function disconnect(): void {
    manuallyClosed = true;
    clearReconnect();
    disconnectInternal();
    currentStatus = "closed";
  }

  function reconnect(): void {
    if (!currentUrl) return;
    manuallyClosed = false;
    attempt = 0;
    clearReconnect();
    disconnectInternal();
    openSocket(currentUrl);
  }

  return {
    connect,
    disconnect,
    reconnect,
    consumePacket,
    status: () => currentStatus,
    latencyMs: () => measuredLatencyMs,
  };
}
