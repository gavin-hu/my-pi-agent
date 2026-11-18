/**
 * The review's deliberate endings: one confirmation for Save, Post and Back to Pi.
 *
 * A fragment of the same IIFE `web-client.ts` ships (`WEB_CONFIRM_JS` is interpolated into
 * `REVIEW_CLIENT_JS`). The dialog markup and its runtime are the page's; what an action asks,
 * and what it runs once answered, live here. `dirty` is the only fact that gates a prompt:
 * with nothing the file does not have, the action runs as it always did.
 */

export const WEB_CONFIRM_JS = String.raw`  var pendingConfirm = null;

  function openConfirm(kind, action) {
    if (!confirmDialog || !window.bfConfirm) { action(); return; }
    pendingConfirm = action;
    var saving = kind === "save";
    var posting = kind === "post";
    confirmTitle.textContent = saving ? "Save and return?" : posting ? "Post comments?" : "Leave without saving?";
    confirmBody.textContent = saving
      ? "These comments go into the plan and the review ends."
      : posting
        ? "Your comments go to the plan now. The review stays open."
        : "This review has comments you have not saved. Leaving now discards them.";
    confirmAccept.textContent = saving ? "Save and return" : posting ? "Post comments" : "Leave without saving";
    window.bfConfirm.open();
  }

  if (confirmAccept) confirmAccept.addEventListener("click", function () {
    var action = pendingConfirm;
    pendingConfirm = null;
    if (window.bfConfirm) window.bfConfirm.close();
    if (action) action();
  });

  // With nothing unsaved the action runs as before; with comments the file does not have,
  // the dialog says what the action ends. A reviewer has no way to end the review, so only
  // the owner's Back to Pi asks.
  function askSave() {
    if (saved || approved || closed) return;
    if (confirmNoDraft()) return;
    if (!dirty) return save();
    openConfirm("save", save);
  }

  function askPost() {
    if (saved || approved || closed) return;
    if (confirmNoDraft()) return;
    if (!dirty) return postComments();
    openConfirm("post", postComments);
  }

  function askCancel() {
    if (saved || approved || closed) return;
    if (confirmNoDraft()) return;
    if (role !== "owner") return;
    if (!dirty) return cancel();
    openConfirm("leave", cancel);
  }

  if (postButton) postButton.addEventListener("click", askPost);
  if (saveButton) saveButton.addEventListener("click", askSave);
  if (cancelButton) cancelButton.addEventListener("click", askCancel);
`;
