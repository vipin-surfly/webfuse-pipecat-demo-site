/* Acme Insurance voice agent — the "Pipecat AI agent + JS script in your HTML".
 *
 * One <script> tag gives the site a voice agent that talks over raw PCM
 * WebSocket to the Pipecat bot (bot.py) and, when the agent needs to act in
 * the page, moves the customer into a secure Webfuse co-browsing session
 * showing THIS SAME page.
 */
(() => {
  // Where the Pipecat bot's voice websocket is reachable (ngrok tunnel).
  const BOT_WS = "wss://d3f1-95-97-8-146.ngrok-free.app";
  // Fallback: the Webfuse Space link (used if the widget didn't load).
  const SPACE_LINK = "https://webfu.se/+pipecat-poc/";
  // The voice websocket, hoisted so enterSession can use it.
  let ws = null;

  // Bind the bot to ANY session that starts on this page — the one the
  // agent triggers, one started with the support button, or one restored
  // after the widget's cookie-transfer page reload.
  function bindSession(s) {
    const sid = s?.sessionId ?? s?._sessionId ?? s?.id;
    console.log("[agent] session_started:", sid, s);
    if (sid && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "bind", session_id: sid }));
    }
  }
  if (typeof webfuse !== "undefined" && typeof webfuse.on === "function") {
    webfuse.on("session_started", bindSession);
  }

  // Inside the Webfuse session (cloud browser) the mic cannot work — the
  // session's own top bar carries the voice button (via the Webfuse
  // extension). Hide this page's widget and point the customer there.
  if (new URLSearchParams(location.search).get("via") === "webfuse") {
    const hint = document.createElement("div");
    hint.textContent = "🎙 Your voice agent is in the session top bar";
    hint.style.cssText =
      "position:fixed;right:16px;bottom:16px;background:#1c2333;color:#fff;" +
      "padding:.6rem .9rem;border-radius:999px;font:600 .8rem system-ui;" +
      "box-shadow:0 4px 14px rgba(0,0,0,.25)";
    document.body.appendChild(hint);
    return;
  }

  // ---- the site's own voice widget --------------------------------------
  const button = document.createElement("button");
  button.textContent = "🎙";
  button.title = "Talk to the voice agent";
  button.style.cssText =
    "position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;" +
    "border:0;background:#2463eb;color:#fff;font-size:1.4rem;cursor:pointer;" +
    "box-shadow:0 6px 18px rgba(36,99,235,.45)";
  const status = document.createElement("div");
  status.style.cssText =
    "position:fixed;right:20px;bottom:84px;background:#fff;color:#1c2333;" +
    "padding:.45rem .7rem;border-radius:8px;font:500 .78rem system-ui;" +
    "border:1px solid #dbe3ee;display:none;max-width:16rem";
  document.body.append(status, button);

  const setStatus = (text, live = false) => {
    status.style.display = "block";
    status.textContent = (live ? "● " : "") + text;
  };

  button.addEventListener("click", async () => {
    button.disabled = true;
    button.style.background = "#94a3b8";
    try {
      await start();
    } catch (err) {
      setStatus("Error: " + err.message);
      button.disabled = false;
      button.style.background = "#2463eb";
    }
  });

  async function start() {
    // One AudioContext at 16 kHz: mic resampled on capture; bot audio
    // (Int16 PCM @16 kHz) plays back natively — no resampling.
    const ctx = new AudioContext({ sampleRate: 16000 });

    // After an auto-reconnect (page reload), browsers keep the AudioContext
    // suspended until the next user interaction — the agent's voice would be
    // inaudible. Resume it on the first click or keypress.
    if (ctx.state === "suspended") {
      setStatus("Tap anywhere to re-enable the agent's voice");
      const resume = () => ctx.resume().catch(() => {});
      document.addEventListener("click", resume, { once: true });
      document.addEventListener("keydown", resume, { once: true });
    }

    setStatus("Requesting microphone…");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    await ctx.audioWorklet.addModule("pcm-worklet.js");
    const source = ctx.createMediaStreamSource(stream);
    const sender = new AudioWorkletNode(ctx, "pcm-sender");
    const receiver = new AudioWorkletNode(ctx, "pcm-receiver");
    source.connect(sender);
    receiver.connect(ctx.destination);

    setStatus("Connecting…");
    ws = new WebSocket(BOT_WS);
    ws.binaryType = "arraybuffer";
    console.log("[agent] connecting to", BOT_WS);

    // mic -> bot
    sender.port.onmessage = (e) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(e.data);
    };

    // bot -> speaker / page
    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        console.log("[agent] control message from bot:", e.data);
        const message = JSON.parse(e.data);
        if (message.type === "start_session") enterSession();
      } else {
        receiver.port.postMessage(e.data);
      }
    };

    ws.onopen = () => { console.log("[agent] ws open"); setStatus("Connected — just talk", true); };
    ws.onclose = (e) => { console.log("[agent] ws closed", e.code, e.reason); setStatus("Disconnected — reload the page to reconnect"); };
    ws.onerror = () => { console.log("[agent] ws error"); setStatus("Connection error — is the agent online?"); };
  }

  // The agent asked for hands: open a Webfuse co-browsing session on this
  // page. The session appears as an overlay on the same page — the mic
  // connection keeps running. When it starts, tell the bot which session to
  // drive (bind message), so its browser tools act on the page the customer
  // is watching.
  function enterSession() {
    console.log("[agent] enterSession() called");
    setStatus("Opening a secure session…");
    if (typeof webfuse === "undefined" || typeof webfuse.session !== "function") {
      // Widget not loaded — fall back to navigating into the session.
      console.log("[agent] webfuse widget not loaded, falling back to navigation");
      const url = new URL(location.href);
      url.searchParams.set("via", "webfuse");
      location.href = SPACE_LINK + "?url=" + encodeURIComponent(url.toString());
      return;
    }
    const session = webfuse.session({ cookie_transfer_enabled: false });
    session.on("session_started", bindSession);
    session.startLeader();
    console.log("[agent] webfuse session startLeader() called");
  }

  // The Webfuse widget may reload the page once when a session starts
  // (cookie transfer). If the mic permission is already granted, reconnect
  // automatically so the voice agent survives the reload.
  function maybeAutoReconnect() {
    if (!navigator.permissions?.query) return;
    navigator.permissions
      .query({ name: "microphone" })
      .then((p) => {
        if (p.state === "granted") {
          console.log("[agent] mic permission granted — auto-connecting");
          button.click();
        }
      })
      .catch(() => {});
  }
  maybeAutoReconnect();

  // Demo form behaviour: no backend, just a friendly success message.
  document.getElementById("quote-form").addEventListener("submit", (e) => {
    e.preventDefault();
    document.getElementById("success").style.display = "block";
    document.getElementById("submit-btn").disabled = true;
  });
})();
