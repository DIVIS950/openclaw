// "More › Claude AI key" links elsewhere open More with the key row already
// open and in view (AiKeyRow takes the request once).
let wanted = false;
export const KEY_EVENT = "psh:keyrow";

export const keyHandoff = {
  set: () => {
    wanted = true;
    // More may already be open: it listens and opens the row in place.
    window.dispatchEvent(new Event(KEY_EVENT));
  },
  peek: (): boolean => wanted,
  take: (): boolean => {
    const was = wanted;
    wanted = false;
    return was;
  },
};
