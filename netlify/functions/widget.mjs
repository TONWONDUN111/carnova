// Embeddable website chat widget. Dealerships add one tag to their site:
//   <script src="https://<novacar host>/api/widget.js" data-dealer="<inbound token>" async></script>
// The widget lives in a shadow root so the host page's CSS can't touch it.
// Andy greets visitors after a few seconds with a soft chime the visitor can
// mute. The TCPA consent checkbox sits above the phone field, unchecked.

export const config = { path: "/api/widget.js" };

const SCRIPT = String.raw`(() => {
  const tag = document.currentScript;
  const token = tag && tag.dataset.dealer;
  if (!token || window.__novacarWidget) return;
  window.__novacarWidget = true;
  const origin = new URL(tag.src).origin;
  const api = origin + "/api/widget-chat";
  const store = (() => { try { return window.localStorage; } catch { return null; } })();
  const key = (name) => "novacar." + token + "." + name;
  let sessionId = store && store.getItem(key("session"));
  if (!sessionId) {
    sessionId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()) + "-" + Date.now();
    store && store.setItem(key("session"), sessionId);
  }
  let muted = store ? store.getItem(key("muted")) === "1" : false;
  const history = [];

  const chime = () => {
    if (muted) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const play = (freq, start) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + 0.6);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + 0.65);
      };
      play(880, 0);
      play(1318.5, 0.12);
    } catch {}
  };

  fetch(api + "?d=" + encodeURIComponent(token)).then((r) => r.ok ? r.json() : null).then((cfg) => {
    if (!cfg) return;
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483000";
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    const color = cfg.color;
    root.innerHTML = '<style>' +
      '*{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}' +
      '.fab{width:56px;height:56px;border-radius:50%;border:0;background:' + color + ';color:#fff;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25);font-size:24px}' +
      '.panel{position:absolute;right:0;bottom:70px;width:340px;max-width:calc(100vw - 40px);height:480px;max-height:calc(100vh - 110px);background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;color:#1b1f24}' +
      '.panel.open{display:flex}' +
      '.head{background:' + color + ';color:#fff;padding:12px 14px;display:flex;align-items:center;gap:8px}' +
      '.head strong{flex:1;font-size:15px}.head button{background:none;border:0;color:#fff;cursor:pointer;font-size:16px;padding:4px}' +
      '.log{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#f6f8fa}' +
      '.msg{max-width:85%;padding:8px 11px;border-radius:12px;font-size:14px;line-height:1.35;white-space:pre-wrap}' +
      '.andy{background:#fff;border:1px solid #e1e4e8;align-self:flex-start}.me{background:' + color + ';color:#fff;align-self:flex-end}' +
      '.bar{display:flex;gap:6px;padding:8px;border-top:1px solid #e1e4e8}.bar input{flex:1;padding:9px 10px;border:1px solid #c9d1d9;border-radius:8px;font-size:14px}' +
      '.bar button,.form button{background:' + color + ';color:#fff;border:0;border-radius:8px;padding:0 12px;font-weight:600;cursor:pointer}' +
      '.cta{margin:0 8px 8px;padding:8px;border:1px dashed ' + color + ';border-radius:8px;background:#fff;color:' + color + ';font-weight:600;cursor:pointer}' +
      '.form{padding:10px 12px;border-top:1px solid #e1e4e8;display:none;flex-direction:column;gap:6px;overflow:auto;max-height:70%}' +
      '.form.open{display:flex}.form input[type=text],.form input[type=tel]{padding:8px 10px;border:1px solid #c9d1d9;border-radius:8px;font-size:14px}' +
      '.form label.c{display:flex;gap:6px;align-items:flex-start;font-size:11px;color:#57606a;line-height:1.3}.form label.c input{margin-top:2px}' +
      '.form button{padding:9px}.err{color:#b42318;font-size:12px}' +
      '</style>' +
      '<div class="panel" role="dialog" aria-label="Chat with ' + cfg.name.replace(/"/g, "") + '">' +
        '<div class="head"><strong></strong><button class="mute" type="button"></button><button class="close" type="button" aria-label="Close chat">✕</button></div>' +
        '<div class="log" aria-live="polite"></div>' +
        '<button class="cta" type="button">Text me</button>' +
        '<form class="form">' +
          '<input type="text" name="name" placeholder="Name" autocomplete="name" maxlength="160" required>' +
          '<label class="c"><input type="checkbox" name="consent"><span class="disc"></span></label>' +
          '<input type="tel" name="phone" placeholder="Mobile phone" autocomplete="tel" maxlength="40" required>' +
          '<input type="text" name="zip" placeholder="ZIP code (optional)" inputmode="numeric" autocomplete="postal-code" maxlength="10">' +
          '<div class="err"></div><button type="submit">Send</button>' +
        '</form>' +
        '<form class="bar"><input name="q" placeholder="Type a message…" maxlength="1000" autocomplete="off"><button type="submit">Send</button></form>' +
      '</div><button class="fab" type="button" aria-label="Open chat">💬</button>';
    const $ = (selector) => root.querySelector(selector);
    $(".head strong").textContent = cfg.name;
    $(".disc").textContent = cfg.disclosure;
    const panel = $(".panel");
    const log = $(".log");
    const form = $(".form");
    const setMute = () => {
      $(".mute").textContent = muted ? "🔇" : "🔔";
      $(".mute").setAttribute("aria-label", muted ? "Unmute chime" : "Mute chime");
    };
    setMute();
    const add = (text, who) => {
      const node = document.createElement("div");
      node.className = "msg " + who;
      node.textContent = text;
      log.appendChild(node);
      log.scrollTop = log.scrollHeight;
      history.push({ role: who === "me" ? "user" : "assistant", content: text });
    };
    const open = () => panel.classList.add("open");
    let greeted = false;
    const greet = (withChime) => {
      if (greeted) return;
      greeted = true;
      add(cfg.greeting, "andy");
      if (withChime && cfg.chime) chime();
    };
    $(".fab").onclick = () => { panel.classList.toggle("open"); greet(false); };
    $(".close").onclick = () => panel.classList.remove("open");
    $(".mute").onclick = () => { muted = !muted; store && store.setItem(key("muted"), muted ? "1" : "0"); setMute(); };
    $(".cta").onclick = () => form.classList.toggle("open");
    if (!(store && store.getItem(key("greeted")))) {
      setTimeout(() => { store && store.setItem(key("greeted"), "1"); open(); greet(true); }, 4000);
    }
    const post = (payload) => fetch(api, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.assign({ d: token, sessionId }, payload)) }).then((r) => r.json());
    $(".bar").onsubmit = (event) => {
      event.preventDefault();
      const input = event.target.q;
      const text = input.value.trim();
      if (!text) return;
      const prior = history.slice();
      add(text, "me");
      input.value = "";
      post({ message: text, history: prior }).then((res) => {
        add(res.reply || res.error || "Sorry, something went wrong.", "andy");
        if (res.askContact) form.classList.add("open");
      }).catch(() => add("Chat is unavailable right now. Please call us.", "andy"));
    };
    form.onsubmit = (event) => {
      event.preventDefault();
      const f = event.target.elements;
      $(".err").textContent = "";
      post({ history: history.slice(), contact: { name: f.namedItem("name").value, phone: f.namedItem("phone").value, zip: f.namedItem("zip").value, consent: f.namedItem("consent").checked } }).then((res) => {
        if (res.error) { $(".err").textContent = res.error; return; }
        form.classList.remove("open");
        $(".cta").style.display = "none";
        add(res.message, "andy");
      }).catch(() => { $(".err").textContent = "Could not send. Please try again."; });
    };
  }).catch(() => {});
})();`;

export default async () =>
  new Response(SCRIPT, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
