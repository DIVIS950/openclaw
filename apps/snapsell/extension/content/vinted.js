// Fills in Vinted's "Sell an item" form (/items/new).
(() => {
  if (window.snapsellVinted) return;
  window.snapsellVinted = true;
  const s = window.snapsell;

  // Vinted's condition list order: New with tags, New without tags, Very good, Good, Satisfactory.
  const CONDITION_INDEX = { new: 0, like_new: 2, good: 3, fair: 4, poor: 4 };
  const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);

  /** Opens a Vinted dropdown, searches in it and takes the first hit. */
  async function searchSelect(openId, searchIds, text) {
    const open = byTestId(openId);
    if (!open || !text) return false;
    open.click();
    await s.pause(500, 900);
    const search = await s.waitFor(
      () => searchIds.map(byTestId).find(Boolean) || [...document.querySelectorAll('input[type="search"]')].find(s.visible),
      3000,
    );
    if (!search) return false;
    await s.type(search, text);
    await s.sleep(1200);
    const hit = await s.waitFor(
      () => [...document.querySelectorAll('[role="option"], [data-testid*="dropdown-row"], [data-testid^="catalog-search"]')].find(s.visible),
      3000,
    );
    if (!hit) return false;
    hit.click();
    await s.pause();
    return true;
  }

  s.onFill(async (job, photos) => {
    const todo = [];
    if (/signup|login/.test(location.pathname)) return s.result("error", "Not logged in to Vinted in this Chrome.");

    s.progress("Uploading photos");
    const input = await s.waitFor(() => document.querySelector('input[type="file"]'), 20000);
    if (!input) return s.result("error", "Couldn't find the photo upload on Vinted.");
    s.upload(input, photos.slice(0, 20));
    await s.sleep(2500);

    s.progress("Filling in title and description");
    const title = await s.waitFor(() => byTestId("title--input") || document.querySelector('input[name="title"]'), 10000);
    if (title) await s.type(title, job.title.slice(0, 100));
    else todo.push("title");
    const desc = byTestId("description--input") || document.querySelector('textarea[name="description"]');
    if (desc) await s.type(desc, job.description);
    else todo.push("description");

    s.progress("Choosing category, brand and condition");
    if (!(await searchSelect("catalog-select-dropdown-input", ["catalog-select-dropdown-search-input"], job.category))) {
      todo.push("category");
    }
    if (job.brand) await searchSelect("brand-select-dropdown-input", ["brand-search--input", "brand-select-dropdown-search-input"], job.brand);

    const cond = byTestId("status-select-dropdown-input");
    if (cond) {
      cond.click();
      await s.pause(500, 900);
      const rows = [...document.querySelectorAll('[data-testid^="status-select-dropdown-row"], [role="option"]')].filter(s.visible);
      const row = rows[CONDITION_INDEX[job.condition] ?? 3];
      if (row) row.click();
      else todo.push("condition");
      await s.pause();
    } else todo.push("condition");

    s.progress("Setting the price");
    const price = byTestId("price-input--input") || document.querySelector('input[name="price"]');
    if (price) await s.type(price, String(job.price));
    else todo.push("price");

    const missing = todo.length ? ` Please add: ${todo.join(", ")}.` : "";
    if (!job.autoPublish) {
      return s.result("needs_review", `Filled in on Vinted. Add size or parcel size if asked, then press Upload.${missing}`);
    }

    s.progress("Publishing");
    const save = byTestId("upload-form-save-button");
    if (!save) return s.result("needs_review", `Couldn't find Vinted's Upload button. Finish in the open tab.${missing}`);
    save.click();
    const done = await s.waitFor(() => /\/items\/\d+/.test(location.pathname), 30000);
    if (!done) return s.result("needs_review", `Vinted needs a hand in the open tab.${missing}`);
    s.result("live", "Posted on Vinted", location.href);
  });
})();
