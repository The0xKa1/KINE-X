// CDP screenshot: navigate, wait real ms, capture. Usage:
//   node scripts/shot.mjs <url> <outfile> [waitMs] [width] [height]
import { writeFile } from "node:fs/promises";

const [url, out, waitMs = "9000", w = "1600", h = "1000"] = process.argv.slice(2);
const port = 9223;

// Find the page target created by the chrome instance launched by the caller.
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === "page");
if (!page) throw new Error("no page target");

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
};

await new Promise((resolve) => (ws.onopen = resolve));
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: Number(w),
  height: Number(h),
  deviceScaleFactor: 1,
  mobile: false,
});
await send("Page.navigate", { url });
await new Promise((resolve) => setTimeout(resolve, Number(waitMs)));
const shot = await send("Page.captureScreenshot", { format: "png" });
await writeFile(out, Buffer.from(shot.data, "base64"));
console.log(`saved ${out}`);
ws.close();
process.exit(0);
