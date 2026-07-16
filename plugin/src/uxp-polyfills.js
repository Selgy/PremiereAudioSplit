/*
 * Polyfills pour APIs DOM manquantes dans UXP, requises par certains composants
 * Spectrum (gestion du focus). Doit être importé AVANT les composants SWC.
 */
(function () {
  const g = typeof globalThis !== "undefined" ? globalThis : window;

  // Observers absents d'UXP : stubs no-op (les composants ne réagiront pas aux
  // mutations/redimensionnements, mais le rendu initial fonctionne).
  function NoopObserver() {}
  NoopObserver.prototype.observe = function () {};
  NoopObserver.prototype.unobserve = function () {};
  NoopObserver.prototype.disconnect = function () {};
  NoopObserver.prototype.takeRecords = function () { return []; };
  ["MutationObserver", "ResizeObserver", "IntersectionObserver"].forEach((name) => {
    if (typeof g[name] === "undefined") g[name] = NoopObserver;
  });

  // Constructable stylesheets absents d'UXP. Stub SANS replace/replaceSync ->
  // lit détecte "non supporté" et bascule sur l'injection de <style>.
  if (typeof g.CSSStyleSheet === "undefined") {
    g.CSSStyleSheet = function () {};
  }

  const doc = typeof document !== "undefined" ? document : null;
  if (!doc) return;

  if (typeof doc.createTreeWalker !== "function") {
    doc.createTreeWalker = function (root, whatToShow, filter) {
      const filterFn =
        filter && (typeof filter === "function" ? filter : filter.acceptNode);
      const nodes = [];
      (function collect(n) {
        for (let c = n.firstChild; c; c = c.nextSibling) {
          if (c.nodeType !== 1) continue; // éléments uniquement
          let r = 1; // FILTER_ACCEPT
          if (filterFn) {
            try { r = filterFn.call(filter, c); } catch (e) { r = 1; }
          }
          if (r === 1) nodes.push(c);
          if (r !== 2) collect(c); // 2 = FILTER_REJECT (ignore le sous-arbre)
        }
      })(root);
      let idx = -1;
      return {
        root: root,
        currentNode: root,
        nextNode() { idx++; return idx < nodes.length ? (this.currentNode = nodes[idx]) : null; },
        previousNode() { idx--; return idx >= 0 ? (this.currentNode = nodes[idx]) : null; },
        firstChild() { return null; },
        lastChild() { return null; },
        parentNode() { return null; },
        nextSibling() { return null; },
        previousSibling() { return null; },
      };
    };
  }
})();
