/* Offertfabriken – inbäddning av förfrågningsformulär. Användning:
   <div id="offertpilot-form"></div>
   <script src="https://DIN-APP/embed.js" data-form="FORMULÄRNYCKEL" async></script> */
(function () {
  var s = document.currentScript || document.querySelector('script[data-form]');
  if (!s) return;
  var key = s.getAttribute("data-form");
  if (!/^[a-f0-9]{24}$/.test(key || "")) return;
  var origin = new URL(s.src).origin;
  var host = document.getElementById(s.getAttribute("data-target") || "offertpilot-form");
  if (!host) { host = document.createElement("div"); s.parentNode.insertBefore(host, s); }
  var f = document.createElement("iframe");
  f.src = origin + "/forfragan/" + key + "?embed=1";
  f.title = "Offertförfrågan";
  f.loading = "lazy";
  f.style.cssText = "width:100%;border:0;min-height:560px;border-radius:16px;transition:height .3s ease";
  host.appendChild(f);
  window.addEventListener("message", function (e) {
    if (e.origin !== origin || !e.data || e.data.type !== "offertpilot:height") return;
    f.style.height = Math.min(Math.max(Number(e.data.height) || 560, 400), 2000) + "px";
  });
})();
