/**
 * The client's writes and its two kit dialogs: one request per named action, the
 * confirmation a claim, a reclaim, or a deletion asks for first, and the card dialog
 * that shows a card whole.
 *
 * A browser is not an identity — the page writes as the session that serves it — so
 * the three actions that move a card between people ask before they act, and the
 * answer names the card and the session. Everything else is a single request whose
 * refusal becomes a banner, never an `alert()`.
 *
 * Both dialogs are the kit's (`bf-dialog` + `dialogScript`): the Tab trap, `Esc`,
 * the backdrop click, and the focus return are `lib/web`'s. This module only fills
 * them, answers them, and notices when the user dismissed one.
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

  function post(path, body) {
    return request(path, "POST", body);
  }

  function remove(path) {
    return request(path, "DELETE");
  }

  /** Call settle(false) when the kit closes the dialog without this module asking. */
  function whenClosed(dialog, settle) {
    var observer = new MutationObserver(function () {
      if (dialog.hidden) {
        observer.disconnect();
        settle(false);
      }
    });
    observer.observe(dialog, { attributes: true, attributeFilter: ["hidden"] });
    return function () {
      observer.disconnect();
    };
  }

  /**
   * Ask one question in the confirm dialog, and answer whether it was accepted.
   *
   * Esc and a backdrop click are the kit's to handle, and both mean "no": the
   * dialog's hidden attribute going back up is what settles the promise, so a
   * dismissed question never leaves the caller waiting.
   */
  function confirm(options) {
    var dialog = document.getElementById("board-confirm");
    var ok = document.getElementById("confirm-ok");
    var cancel = document.getElementById("confirm-cancel");
    if (!dialog || !ok || !cancel || !window.bfConfirm) return Promise.resolve(true);
    document.getElementById("confirm-title").textContent = options.title;
    document.getElementById("confirm-body").textContent = options.body || "";
    ok.textContent = options.ok || "Confirm";
    ok.className = "bf-btn " + (options.danger ? "bf-btn--danger" : "bf-btn--primary");
    return new Promise(function (resolve) {
      var answered = false;
      function finish(value) {
        if (answered) return;
        answered = true;
        ok.removeEventListener("click", accept);
        cancel.removeEventListener("click", dismiss);
        stop();
        if (!dialog.hidden) window.bfConfirm.close();
        resolve(value);
      }
      function accept() { finish(true); }
      function dismiss() { finish(false); }
      var stop = whenClosed(dialog, finish);
      ok.addEventListener("click", accept);
      cancel.addEventListener("click", dismiss);
      window.bfConfirm.open();
      cancel.focus();
    });
  }

  /** The question a claim, a reclaim, or a deletion asks, or none for the rest. */
  function question(verb, card) {
    var me = board.view ? board.view.me.label : "this session";
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
      var notes = card.notes.length;
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
   * A refusal is a banner; a success needs nothing, because the next frame is the
   * truth and it arrives within a second.
   */
  board.act = function (verb, card, extra) {
    var ask = question(verb, card);
    var proceed = ask ? confirm(ask) : Promise.resolve(true);
    return proceed.then(function (accepted) {
      if (!accepted) return undefined;
      var path = "/api/cards/" + encodeURIComponent(card.id);
      var done = verb === "drop" ? remove(path) : post(path + "/" + verb, extra || {});
      return done.catch(function (error) {
        banner(error.message);
        return undefined;
      });
    });
  };

  /** Add a card from the composer. */
  board.add = function (input) {
    return post("/api/cards", input).catch(function (error) {
      banner(error.message);
      return undefined;
    });
  };

  /** Note the card whose dialog is open, from its own field. */
  board.addNote = function () {
    var input = document.getElementById("card-dialog-note");
    if (!input || board.openId === undefined) return undefined;
    var text = input.value.trim();
    if (!text) return undefined;
    var card = board.findCard(board.view, board.openId);
    if (!card) return undefined;
    return post("/api/cards/" + encodeURIComponent(card.id) + "/note", { text: text })
      .then(function (payload) {
        input.value = "";
        return payload;
      })
      .catch(function (error) {
        banner(error.message);
        return undefined;
      });
  };

  /** Fill and open the card dialog; the second argument names what to focus. */
  board.openCard = function (id, focus) {
    var view = board.view;
    if (!view) return;
    var card = board.findCard(view, id);
    if (!card || !window.bfCard) return;
    board.openId = id;
    board.fillDialog(card, view);
    window.bfCard.open();
    if (focus === "note") {
      var input = document.getElementById("card-dialog-note");
      if (input) input.focus();
    }
  };

  board.closeCard = function () {
    if (window.bfCard) window.bfCard.close();
  };

  board.dialogOpen = function () {
    return window.bfCard ? window.bfCard.isOpen() : false;
  };

  /**
   * The card dialog's footer: the lane buttons this card may move to, then its
   * destructive ones. Nothing here is a card-face action, so a reader cannot delete
   * a card from the lane by hitting the wrong button.
   */
  board.fillDialogActions = function (card, view) {
    var footer = document.getElementById("card-dialog-actions");
    if (!footer) return;
    footer.textContent = "";
    var isMine = board.mine(card, view.me);
    if (isMine && card.status !== "done") {
      var lanes = board.el("div", "bf-segmented board-dialog__lanes");
      var targets = ["doing", "blocked", "done"];
      for (var i = 0; i < targets.length; i++) {
        (function (lane) {
          var item = board.el("button", "bf-segmented__item", board.laneLabel(lane));
          item.type = "button";
          item.setAttribute("aria-pressed", String(card.status === lane));
          item.disabled = card.status === lane;
          item.addEventListener("click", function () { board.act("move", card, { status: lane }); });
          lanes.appendChild(item);
        })(targets[i]);
      }
      footer.appendChild(lanes);
    }
    if (isMine && card.status !== "done") {
      footer.appendChild(board.actionButton("Release", function () { board.act("release", card); }));
    }
    if (card.status === "todo" || card.status === "done" || isMine) {
      footer.appendChild(board.actionButton("Drop", function () { board.act("drop", card); }, "danger"));
    }
    footer.appendChild(board.actionButton("Close", function () { board.closeCard(); }));
  };

  // A dialog the kit closed — Esc, a backdrop click, or its own close button —
  // forgets which card it showed, so the next frame stops filling a hidden panel.
  var cardDialog = document.getElementById("board-card-dialog");
  if (cardDialog) {
    new MutationObserver(function () {
      if (cardDialog.hidden) board.openId = undefined;
    }).observe(cardDialog, { attributes: true, attributeFilter: ["hidden"] });
  }

  board.banner = banner;
  board.confirm = confirm;
  board.post = post;
})();`;
