// "More › Claude AI key" links elsewhere open More with the key row already
// open and in view (AiKeyRow takes the request once).
let wanted = false;

export const keyHandoff = {
  set: () => {
    wanted = true;
  },
  peek: (): boolean => wanted,
  take: (): boolean => {
    const was = wanted;
    wanted = false;
    return was;
  },
};
