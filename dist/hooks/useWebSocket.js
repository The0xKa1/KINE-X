














const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 8_000;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];











export function useWebSocket(buffer                   , bus          )                         {
  let socket                   = null;
  let currentStatus               = "mock";
  let currentUrl                = null;
  let attempt = 0;
  let reconnectHandle                = null;
  let pingHandle                = null;
  let pongTimer                = null;
  let lastPingSentAt = 0;
  let measuredLatencyMs = 0;
  let manuallyClosed = false;
  let malformedWarned = false;

  function emitStatus(update                )       {
    bus.emit("pipeline:update", update);
  }

  function consumePacket(packet                   )       {
    buffer.pushPacket(packet);
  }

  function clearReconnect()       {
    if (reconnectHandle !== null) {
      window.clearTimeout(reconnectHandle);
      reconnectHandle = null;
    }
  }

  function clearPing()       {
    if (pingHandle !== null) {
      window.clearInterval(pingHandle);
      pingHandle = null;
    }
    if (pongTimer !== null) {
      window.clearTimeout(pongTimer);
      pongTimer = null;
    }
  }

  function scheduleReconnect()       {
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

  function sendPing()       {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    lastPingSentAt = performance.now();
    const payload             = { type: "PING", t: lastPingSentAt };
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

  function startPing()       {
    clearPing();
    pingHandle = window.setInterval(sendPing, PING_INTERVAL_MS);
  }

  function handleMessage(event                      )       {
    let payload         ;
    try {
      payload = JSON.parse(event.data)           ;
    } catch {
      if (!malformedWarned) {
        console.warn("[useWebSocket] dropped malformed JSON frame");
        malformedWarned = true;
      }
      return;
    }
    if (!payload || typeof payload !== "object") return;
    const typed = payload                     ;
    if (typed.type === "PONG") {
      const pong = payload              ;
      if (pongTimer !== null) {
        window.clearTimeout(pongTimer);
        pongTimer = null;
      }
      measuredLatencyMs = Math.max(0, performance.now() - (pong.t || lastPingSentAt));
      emitStatus({ runIndex: 2, latencyMs: Math.round(measuredLatencyMs), status: "ready" });
      return;
    }
    if (typed.type === "FRAME_STREAM") {
      consumePacket(payload                     );
    }
  }

  function openSocket(url        )       {
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

  function connect(url        )       {
    manuallyClosed = false;
    currentUrl = url;
    attempt = 0;
    clearReconnect();
    disconnectInternal();
    openSocket(url);
  }

  function disconnectInternal()       {
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

  function disconnect()       {
    manuallyClosed = true;
    clearReconnect();
    disconnectInternal();
    currentStatus = "closed";
  }

  function reconnect()       {
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
