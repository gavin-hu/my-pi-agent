/**
 * The Activity column: what nobody has read, then what the cards say happened.
 *
 * Two panes, because they answer two different questions. **Waiting** is a queue — mail that
 * has not been read, oldest first — and it is the only pane on this page whose fact lives
 * outside the board. **Recent** is history, derived from the cards' own records
 * (`lib/board/activity.ts`), and it is what says a board is moving when nobody is writing to
 * it.
 *
 * Three rules the panes keep:
 *
 * - **A waiting row carries its recipient's state.** A handoff to a session that is gone looks
 *   exactly like one to a live peer otherwise, and picking the first up is the lead's work.
 * - **A broadcast is one row.** The bus writes one file per recipient sharing one message id;
 *   the row names them once, `all (3)`, and keeps every name and state in its tooltip.
 * - **A glyph is decoration.** Every kind is spelled out in words beside its glyph, so the
 *   page never asks a reader to know what `✎` means.
 *
 * Neither pane writes: the bus owns the inbox, and a page that marked mail read would eat the
 * queue it was describing.
 */

export function feedJs(rules: { labels: string }): string {
	return feedTemplate.replace("__ACTIVITY_LABEL__", rules.labels);
}

const feedTemplate = String.raw`(function () {
  "use strict";
  var board = window.bfBoard || (window.bfBoard = {});
  var el = board.el;
  var chip = board.chip;
  var ago = board.ago;
  var plural = board.plural;
  var stamp = board.stamp;
  var paneHead = board.paneHead;

  var ACTIVITY_LABEL = __ACTIVITY_LABEL__;

  /** One glyph per kind, decoration only: the word is beside it. */
  var MAIL_GLYPH = { message: "\u2709", event: "\u2691", ask: "?", handoff: "\u2709" };
  var EVENT_GLYPH = { blocked: "\u2691", moved: "\u21bb", approved: "\u2605", reviewed: "\u2713", noted: "\u270e", offered: "\u2709" };

  /** The state a dot wears, worst first: the one a reader must act on leads a group. */
  var STATE_RANK = { gone: 0, quiet: 1, absent: 2, unknown: 3, live: 4 };

  /** A state dot, with the word it stands for on the hover: a colour alone says nothing. */
  function dot(state) {
    var node = el("span", N.dot);
    node.setAttribute("data-state", state === undefined ? "unknown" : state);
    node.setAttribute("aria-hidden", "true");
    node.title = state === undefined ? "the bus says nothing" : state;
    return node;
  }

  /** The worst state among a message's recipients, which is the one worth a dot. */
  function worstOf(to) {
    var worst = undefined;
    for (var i = 0; i < to.length; i++) {
      var state = to[i].state === undefined ? "unknown" : to[i].state;
      if (worst === undefined || STATE_RANK[state] < STATE_RANK[worst]) worst = state;
    }
    return worst;
  }

  /** Who a message waits for: one name, or all (3) with every name on the hover. */
  function recipients(to) {
    var node = el("span", N.mailTo);
    node.appendChild(dot(worstOf(to)));
    if (to.length === 1) {
      node.appendChild(document.createTextNode(to[0].label));
      return node;
    }
    node.appendChild(document.createTextNode("all (" + to.length + ")"));
    var names = [];
    for (var i = 0; i < to.length; i++) {
      names.push(to[i].label + " (" + (to[i].state === undefined ? "no bus" : to[i].state) + ")");
    }
    node.title = names.join(", ");
    return node;
  }

  /** One message nobody has read. */
  function mailRow(message) {
    var row = el("li", N.mailRow);
    row.setAttribute("data-kind", message.kind);
    var glyph = el("span", N.glyph, MAIL_GLYPH[message.kind] || "\u2709");
    glyph.setAttribute("aria-hidden", "true");
    row.appendChild(glyph);
    row.appendChild(el("span", N.mailFrom, message.fromLabel));
    var arrow = el("span", N.mailArrow, "\u2192");
    arrow.setAttribute("aria-hidden", "true");
    row.appendChild(arrow);
    row.appendChild(recipients(message.to));
    // The kind, in words: the pill is the shape and the word is the fact.
    row.appendChild(chip(message.kind, "muted"));
    row.appendChild(stamp(ago(message.at), message.at));
    // The text is the reason to open it, and it never fits a row: on the hover, whole.
    row.title = message.fromLabel + " \u2192 " + message.to.map(function (each) { return each.label; }).join(", ") + ": " + message.text;
    return row;
  }

  /** What an event did, in the table's own words, with the lane the move went to. */
  function eventWhat(event) {
    var label = ACTIVITY_LABEL[event.kind] || event.kind;
    if (event.lane === undefined) return label;
    var lane = board.laneOf(board.view, event.lane);
    return label.replace("{lane}", lane === undefined ? event.lane : lane.label.toLowerCase());
  }

  /** One thing that happened: a glyph, the lane it happened in, the card, and what it was. */
  function eventRow(event) {
    var row = el("li", N.event);
    row.setAttribute("data-kind", event.kind);
    var glyph = el("span", N.glyph, EVENT_GLYPH[event.kind] || "\u2022");
    glyph.setAttribute("aria-hidden", "true");
    row.appendChild(glyph);
    if (event.lane !== undefined) {
      var laneDot = dot("live");
      laneDot.setAttribute("data-lane", event.lane);
      laneDot.removeAttribute("data-state");
      row.appendChild(laneDot);
    }
    row.appendChild(el("span", N.eventRef, "#" + event.card));
    row.appendChild(el("span", N.eventWhat, eventWhat(event)));
    row.appendChild(stamp(ago(event.at), event.at));
    row.title = "#" + event.card + " " + event.title;
    return row;
  }

  /** Whether a message matches the filter: its sender, its recipients, or what it says. */
  function mailMatches(message, query) {
    var hay = [message.fromLabel, message.text].concat(message.to.map(function (each) { return each.label; })).join(" ").toLowerCase();
    return hay.indexOf(query.toLowerCase()) !== -1;
  }

  /**
   * The two panes, as separate signatures and builders.
   *
   * Separately, because they move on different clocks: a message landing must not rebuild the
   * history behind it, and a card's move must not repaint a queue somebody is reading.
   */
  board.feedPanes = function (view, query, filtering) {
    // The queue arrives with the count its cap left out, so a repository with twenty unread
    // messages does not read like a quiet one.
    var queue = view.waiting === undefined ? { messages: [], dropped: 0 } : view.waiting;
    var waiting = queue.messages;
    var recent = view.activity === undefined ? { events: [], dropped: 0 } : view.activity;
    var mails = filtering ? waiting.filter(function (message) { return mailMatches(message, query); }) : waiting;
    var events = filtering
      ? recent.events.filter(function (event) {
          var hay = ("#" + event.card + " " + event.title + " " + eventWhat(event)).toLowerCase();
          return hay.indexOf(query.toLowerCase()) !== -1;
        })
      : recent.events;

    var mailSig = [query];
    for (var m = 0; m < mails.length; m++) {
      var names = [];
      for (var t = 0; t < mails[m].to.length; t++) names.push(mails[m].to[t].label + ":" + mails[m].to[t].state);
      mailSig.push(mails[m].id + ":" + mails[m].kind + ":" + mails[m].at + ":" + names.join("+"));
    }
    var eventSig = [query, String(recent.dropped)];
    for (var e = 0; e < events.length; e++) {
      eventSig.push(events[e].kind + ":" + events[e].card + ":" + events[e].at + ":" + (events[e].lane || ""));
    }

    return {
      waiting: {
        sig: mailSig.join("|"),
        count: mails.length,
        total: waiting.length,
        build: function (slot) {
          // A filter shows what it matched against the queue; unfiltered, the pane says how deep
          // the queue is, the way RECENT says how much history it left out.
          slot.appendChild(
            paneHead("WAITING", mails.length, filtering ? waiting.length : waiting.length + queue.dropped, mails.length > 0 ? "accent" : undefined)
          );
          if (mails.length === 0) {
            slot.appendChild(el("p", N.teamEmpty, filtering ? "nothing matches \"" + query + "\"" : "no mail is waiting"));
            return;
          }
          var list = el("ul", N.waiting);
          for (var i = 0; i < mails.length; i++) list.appendChild(mailRow(mails[i]));
          slot.appendChild(list);
        }
      },
      recent: {
        sig: eventSig.join("|"),
        count: events.length,
        total: recent.events.length,
        build: function (slot) {
          // The count is what the rail has room for against what the board holds, so a busy
          // board does not read like a quiet one.
          slot.appendChild(paneHead("RECENT", events.length, filtering ? recent.events.length : events.length + recent.dropped));
          if (events.length === 0) {
            slot.appendChild(el("p", N.teamEmpty, filtering ? "nothing matches \"" + query + "\"" : "nothing has happened yet"));
            return;
          }
          var list = el("ul", N.recent);
          for (var i = 0; i < events.length; i++) list.appendChild(eventRow(events[i]));
          slot.appendChild(list);
        }
      }
    };
  };

})();`;
