/* Acme Insurance voice agent — the "Pipecat AI agent + JS script in your HTML".
 *
 * One <script> tag gives the site a voice agent that talks over raw PCM
 * WebSocket to the Pipecat bot (bot.py) and, when the agent needs to act in
 * the page, moves the customer into a secure Webfuse co-browsing session
 * showing THIS SAME page.
 */
(() => {
  // Inside a Webfuse session this page is the PROXIED copy shown in the
  // session — the customer's live voice connection is on the outer page.
  // Don't run a second voice widget here (it would double-connect, load
  // worklets through the proxy, and confuse the mic).
  if (
    (window.webfuse && webfuse.isInsideSession) ||
    window.__surfly ||
    location.hostname.endsWith(".webfu.se")
  ) {
    console.log("[agent] inside a Webfuse session — voice widget stays on the outer page");
    return;
  }
  console.log("[agent] voice widget v18 loaded");
  // Where the Pipecat bot's voice websocket is reachable (ngrok tunnel).
  const BOT_WS = "wss://d3f1-95-97-8-146.ngrok-free.app";
  // Fallback: the Webfuse Space link (used if the widget didn't load).
  const SPACE_LINK = "https://webfu.se/+pipecat-poc/";
  // The voice websocket, hoisted so enterSession can use it.
  let ws = null;
  // Set when the browser keeps the agent's voice suspended (after the page
  // reload when a session starts) — clicking the mic resumes it.
  let resumeAudio = null;
  // Set when a Webfuse session has started on this page (bindSession).
  let sessionStarted = false;

  // Bind the bot to ANY session that starts on this page — the one the
  // agent triggers, one started with the support button, or one restored
  // after the widget's cookie-transfer page reload.
  function bindSession(s) {
    const sid = s?.sessionId ?? s?._sessionId ?? s?.id;
    console.log("[agent] session_started:", sid, s);
    sessionStarted = true;
    setStatus("Secure session started — the agent is now on the page with you");
    if (sid && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "bind", session_id: sid }));
    }
  }
  if (typeof webfuse !== "undefined" && typeof webfuse.on === "function") {
    webfuse.on("session_started", bindSession);
    // Surface the widget's own error events (e.g. "refused to start")
    // instead of failing silently.
    webfuse.on("error", (e) => {
      console.error("[agent] webfuse session error:", e);
      setStatus("Session error: " + (e?.details || e?.reason || "unknown"));
    });
  }

  // ---- the site's own voice widget --------------------------------------
  const button = document.createElement("button");
  button.textContent = "🎙";
  button.title = "Talk to the voice agent";
  // z-index 2147483647 (the max) keeps the mic ABOVE the Webfuse session
  // overlay (its iframe sits at 2147483548), so the customer keeps seeing —
  // and clicking — their site's own voice widget while the session is open.
  button.style.cssText =
    "position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;" +
    "border:0;background:#2463eb;color:#fff;font-size:1.4rem;cursor:pointer;" +
    "box-shadow:0 6px 18px rgba(36,99,235,.45);z-index:2147483647";
  const status = document.createElement("div");
  status.style.cssText =
    "position:fixed;right:20px;bottom:84px;background:#fff;color:#1c2333;" +
    "padding:.45rem .7rem;border-radius:8px;font:500 .78rem system-ui;" +
    "border:1px solid #dbe3ee;display:none;max-width:16rem;z-index:2147483647";
  document.body.append(status, button);

  // Mic mute: a pill button next to the mic. While muted, the customer's
  // audio is not sent to the agent (they hear silence); the voice connection
  // itself stays open.
  let muted = false;
  const muteBtn = document.createElement("button");
  muteBtn.textContent = "Mute";
  muteBtn.title = "Mute your microphone";
  muteBtn.style.cssText =
    "position:fixed;right:84px;bottom:32px;height:32px;padding:0 .9rem;" +
    "border-radius:999px;border:1px solid #dbe3ee;background:#fff;color:#1c2333;" +
    "font:600 .78rem system-ui;cursor:pointer;z-index:2147483647;display:none";
  document.body.append(muteBtn);
  muteBtn.addEventListener("click", () => {
    muted = !muted;
    muteBtn.textContent = muted ? "Unmute" : "Mute";
    muteBtn.style.background = muted ? "#ef4444" : "#fff";
    muteBtn.style.color = muted ? "#fff" : "#1c2333";
    muteBtn.title = muted ? "Unmute your microphone" : "Mute your microphone";
    setStatus(muted ? "You are muted — the agent cannot hear you" : "Mic live — just talk", true);
  });

  const setStatus = (text, live = false) => {
    status.style.display = "block";
    status.textContent = (live ? "● " : "") + text;
  };
  setStatus("Voice widget v18 — tap 🎙 to talk");

  // Visual state of the mic button: amber pulsing while the agent's voice is
  // browser-muted (needs one tap to unmute), green when fully live.
  const pulseStyle = document.createElement("style");
  pulseStyle.textContent =
    "@keyframes agentPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}";
  document.head.appendChild(pulseStyle);

  function paintMuted() {
    button.style.background = "#f59e0b"; // amber — muted, tap to unmute
    button.style.animation = "agentPulse 1.4s ease-in-out infinite";
    button.title = "Tap to unmute the agent's voice";
    setStatus("Tap 🎙 to unmute the agent's voice", true);
  }

  function paintLive() {
    button.style.background = "#16a34a"; // live green — the agent is listening
    button.style.animation = "";
    button.title = "Voice agent live";
    setStatus("Connected — just talk", true);
  }

  button.addEventListener("click", async () => {
    // After the session starts, the browser may keep the agent's voice
    // muted until a click — the floating mic IS that click.
    if (resumeAudio) {
      const resume = resumeAudio;
      resumeAudio = null;
      resume();
      button.style.animation = "";
      return;
    }
    // Already connected: clicking the mic just confirms it's live.
    if (ws && ws.readyState === WebSocket.OPEN) {
      setStatus("Connected — just talk", true);
      return;
    }
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
    // inaudible (the mic often still works, which is confusing). Try to
    // resume without a gesture; if that fails, the floating mic button turns
    // amber and pulses until the customer taps it.
    try {
      await ctx.resume();
    } catch (_) { /* needs a gesture */ }
    if (ctx.state === "suspended") {
      resumeAudio = () =>
        ctx
          .resume()
          .then(() => paintLive())
          .catch(() => {});
      const resume = () => {
        if (resumeAudio) {
          const r = resumeAudio;
          resumeAudio = null;
          r();
        }
      };
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

    // mic -> bot (dropped while muted)
    sender.port.onmessage = (e) => {
      if (ws.readyState === WebSocket.OPEN && !muted) ws.send(e.data);
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

    ws.onopen = () => {
      console.log("[agent] ws open");
      button.disabled = false;
      muteBtn.style.display = "block";
      if (resumeAudio) paintMuted(); else paintLive();
    };
    ws.onclose = (e) => { console.log("[agent] ws closed", e.code, e.reason); muteBtn.style.display = "none"; setStatus("Disconnected — reload the page to reconnect"); };
    ws.onerror = () => { console.log("[agent] ws error"); setStatus("Connection error — is the agent online?"); };
  }

  // The agent asked for hands: start the Webfuse session programmatically
  // — the documented widget-API way — and embed it into OUR iframe on this
  // page (session.start('#agent-session-frame')). With a selector the
  // widget never navigates the page away or opens separate tabs; it also
  // bypasses the "restored session" start refusal. On browsers without
  // third-party cookies the widget shows its own "Start session" dialog —
  // the customer's click there supplies the user gesture — then the
  // session embeds here. The global session_started handler binds the bot.
  function enterSession() {
    console.log("[agent] enterSession() called");
    const space = window.__wfSpace;
    const frame = document.getElementById("agent-session-frame");
    if (!space || typeof space.session !== "function" || !frame) {
      setStatus("Session frame not ready — reload the page");
      return;
    }
    setStatus("A “Start session” dialog will pop up — please click Accept", true);
    const session = space.session();
    session.on("session_started", () => {
      frame.style.display = "block";
    });
    try {
      const p = session.start("#agent-session-frame");
      if (p && typeof p.catch === "function") {
        p.catch((err) => {
          console.error("[agent] session.start failed:", err);
          setStatus("Could not start the session: " + (err?.message || err));
        });
      }
      console.log("[agent] session.start('#agent-session-frame') called");
    } catch (err) {
      console.error("[agent] session.start threw:", err);
      setStatus("Could not start the session: " + err.message);
    }
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
