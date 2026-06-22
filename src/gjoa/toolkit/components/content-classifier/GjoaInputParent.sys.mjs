/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Parent half of gjoa's INPUT-STATE actor. Each frame's child reports whether an
// editable element is focused in IT; the parent aggregates across frames and
// stamps the live state onto the top <browser> element as `_gjoaEditable`, which
// chrome (tabs/content-focus.bjs `contentInputFocused`) reads SYNCHRONOUSLY at
// every keydown. This is the reliable transport that the rejected `data:` frame
// script used to (fail to) provide.
//
// Aggregation: a page can focus an input inside a (same- or cross-origin) iframe,
// where the top document's activeElement is just the <iframe>. With allFrames the
// child in THAT frame reports true. We track the set of frame BrowsingContext ids
// currently editable under each top browser; editable := set non-empty. A frame
// reporting false (focusout) or unloading (pagehide) removes its id, so the set
// self-heals on the next focus change even if an actor dies without a focusout.

export class GjoaInputParent extends JSWindowActorParent {
  receiveMessage(msg) {
    if (msg.name !== "GjoaInput:Focus") {
      return;
    }
    const browser = this.browsingContext?.top?.embedderElement;
    if (!browser) {
      return;
    }
    let set = browser._gjoaEditableFrames;
    if (!set) {
      set = new Set();
      browser._gjoaEditableFrames = set;
    }
    const id = this.browsingContext.id;
    if (msg.data?.editable) {
      set.add(id);
    } else {
      set.delete(id);
    }
    browser._gjoaEditable = set.size > 0;
  }
}
