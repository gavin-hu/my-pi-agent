/**
 * The client's writes: one request per named action, and the confirmation a
 * claim, a reclaim, or a deletion asks for first.
 *
 * A browser is not an identity — the page writes as the session that serves it — so
 * the three actions that move a card between people ask before they act, and the
 * answer names the card and the session. Everything else is a single request whose
 * refusal becomes a banner, never an `alert()`.
 */

export const BOARD_ACTIONS_JS = String.raw`(function () {
  "use strict";
  var board = window.bfBoard || (window.bfBoard = {});
  var token = new URLSearchParams(window.location.search).get("token") || "";

  /** The one place a message reaches the reader: a banner, cleared by the next success. */
  function banner(message) {
    var node = document.getElementById("board-banner");
    if (!node) return;
    node.hidden = !message;
    node.textContent = message || "";
  }

  /** One write. The token rides in the query string, the body is JSON. */
  function post(path, body) {
    return request(path, "POST", body);
  }

  /** The one deletion. */
  function remove(path) {
    return request(path, "DELETE");
  }

  function request(path, method, body) {
    var url = path + "?token=" + encodeURIComponent(token);
    var options = { method: method };
    if (body !== undefined) {
      options.headers = { "Content-Type": "application/json" };
      options.body = JSON.stringify(body);
    }
    return fetch(url, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok) {
          throw new Error(payload && payload.error ? payload.error : "The board refused that (" + response.status + ").");
        }
        banner("");
        return payload;
      });
    });
  }

  /**
   * Ask one question in the confirm dialog, and answer whether it was accepted.
   *
   * The native dialog element gives the focus trap, Esc, and the focus return; this
   * only names the question, the consequence, and which answer is the dangerous one.
   */
  function confirm(options) {
    var dialog = document.getElementById("board-confirm");
    var ok = document.getElementById("confirm-ok");
    var cancel = document.getElementById("confirm-cancel");
    if (!dialog || !ok || !cancel) return Promise.resolve(true);
    document.getElementById("confirm-title").textContent = options.title;
    document.getElementById("confirm-body").textContent = options.body || "";
    ok.textContent = options.ok || "Confirm";
    ok.className = "bf-btn " + (options.danger ? "bf-btn--danger" : "bf-btn--primary");
    return new Promise(function (resolve) {
      function settle(value) {
        ok.removeEventListener("click", accept);
        cancel.removeEventListener("click", dismiss);
        dialog.removeEventListener("cancel", onCancel);
        if (dialog.open) dialog.close();
        resolve(value);
      }
      function accept() { settle(true); }
      function dismiss() { settle(false); }
      function onCancel(event) { event.preventDefault(); settle(false); }
      ok.addEventListener("click", accept);
      cancel.addEventListener("click", dismiss);
      dialog.addEventListener("cancel", onCancel);
      dialog.showModal();
      cancel.focus();
    });
  }

  /** The question a claim, a reclaim, or a deletion asks, or none for the rest. */
  function question(verb, card) {
    var me = board.view ? board.view.me.label : "this session";
    var notes = card.notes.length;
    if (verb === "claim") {
      return { title: "Claim #" + card.id + "?", body: "Claim #" + card.id + " as " + me + "?", ok: "Claim" };
    }
    if (verb === "reclaim") {
      return {
        title: "Reclaim #" + card.id + "?",
        body: "Reclaim #" + card.id + " from " + (card.owner ? card.owner.label : "nobody") + "? It returns to To do and keeps its notes.",
        ok: "Reclaim",
        danger: true
      };
    }
    if (verb === "drop") {
      return {
        title: "Delete #" + card.id + "?",
        body: "Delete #" + card.id + (notes > 0 ? " and its " + notes + " notes?" : "?"),
        ok: "Delete",
        danger: true
      };
    }
    return undefined;
  }

  /**
   * Run one named action against a card, after its question when it has one.
   *
   * The answer is the card, or the refusal's message; either way the next frame is
   * what the page shows, so a refused write leaves the board as it was rather than
   * guessing at what should have happened.
   */
  board.act = function (verb, card, extra) {
    var ask = question(verb, card);
    var proceed = ask ? confirm(ask) : Promise.resolve(true);
    return proceed.then(function (accepted) {
      if (!accepted) return undefined;
      var path = "/api/cards/" + encodeURIComponent(card.id);
      var done = verb === "drop" ? remove(path) : post(path + "/" + verb, extra || {});
      // A refusal is a banner; a success needs nothing, because the next frame is
      // the truth and it arrives within a second.
      return done.catch(function (error) {
        banner(error.message);
        return undefined;
      });
    });
  };

  /** Add a card from the composer. */
  board.add = function (input) {
    return post("/api/cards", input).then(function (payload) {
      return payload;
    }).catch(function (error) {
      banner(error.message);
      return undefined;
    });
  };

  /** Note a card from its dialog. */
  board.note = function (card, text) {
    return post("/api/cards/" + encodeURIComponent(card.id) + "/note", { text: text }).catch(function (error) {
      banner(error.message);
      return undefined;
    });
  };

  /** Record the plan a card is executing. */
  board.plan = function (card, path) {
    return post("/api/cards/" + encodeURIComponent(card.id) + "/plan", { path: path }).catch(function (error) {
      banner(error.message);
      return undefined;
    });
  };

  board.banner = banner;
  board.post = post;
  board.confirm = confirm;
})();`;
