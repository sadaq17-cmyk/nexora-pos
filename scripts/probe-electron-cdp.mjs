import http from "node:http";

const port = process.argv[2] || "9230";

function get(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve(d));
      })
      .on("error", reject);
  });
}

const tabs = JSON.parse(await get(`http://127.0.0.1:${port}/json`));
const tab = tabs[0];
if (!tab) {
  console.log("NO_TAB");
  process.exit(1);
}
console.log("URL", tab.url);
console.log("TITLE", tab.title);

// Prefer chrome-remote-interface free approach via raw WebSocket if available
let WebSocket;
try {
  WebSocket = (await import("ws")).default;
} catch {
  console.log("NO_WS_MODULE");
  process.exit(tab.url.includes("/login") && !tab.url.startsWith("file:") ? 0 : 2);
}

await new Promise((resolve, reject) => {
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  const timer = setTimeout(() => {
    ws.close();
    reject(new Error("timeout"));
  }, 12000);
  ws.on("open", () => {
    ws.send(
      JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          expression: "document.body ? document.body.innerText.slice(0, 1200) : ''",
          returnByValue: true,
        },
      })
    );
  });
  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.id !== 1) return;
    clearTimeout(timer);
    const text = msg.result?.result?.value || "";
    console.log("BODY_SNIPPET", JSON.stringify(text));
    console.log(text.includes("That page doesn't exist") ? "HAS_404" : "NO_404");
    console.log(/Sign in|Email|Password|Company|Platform/i.test(text) ? "HAS_LOGIN_UI" : "NO_LOGIN_UI");
    ws.close();
    resolve();
  });
  ws.on("error", reject);
});
