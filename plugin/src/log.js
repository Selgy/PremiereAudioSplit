/* Petit utilitaire de log affiché dans le panneau + console UXP. */
const AppLog = (() => {
  function ts() {
    return new Date().toLocaleTimeString();
  }

  function write(level, ...args) {
    const line = `[${ts()}] ${args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ")}`;
    // Console UXP (visible via UDT devtools)
    (console[level] || console.log)(line);
    const el = document.getElementById("log");
    if (el) {
      el.textContent += line + "\n";
      el.scrollTop = el.scrollHeight;
    }
  }

  return {
    info: (...a) => write("log", ...a),
    warn: (...a) => write("warn", ...a),
    error: (...a) => write("error", ...a),
  };
})();
