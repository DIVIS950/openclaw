// Fills in Facebook Marketplace's "Create new listing → Item for sale" form.
(() => {
  if (window.snapsellFacebook) return;
  window.snapsellFacebook = true;
  const s = window.snapsell;

  // Labels are in the account's language; cover the common ones.
  const L = {
    title: /^(title|název|titel|titre|título|titolo|tytuł)$/i,
    price: /^(price|cena|preis|prix|precio|prezzo)$/i,
    description: /^(description|popis|beschreibung|descripción|descrizione|opis)$/i,
    condition: /^(condition|stav|zustand|état|estado|condizione|stan)$/i,
    category: /^(category|kategorie|catégorie|categoría|categoria|kategoria)$/i,
    next: /^(next|další|weiter|suivant|siguiente|avanti|dalej)$/i,
    publish: /^(publish|publikovat|veröffentlichen|publier|publicar|pubblica|opublikuj)$/i,
  };

  // Facebook's condition list order: New, Used - like new, Used - good, Used - fair.
  const CONDITION_INDEX = { new: 0, like_new: 1, good: 2, fair: 3, poor: 3 };

  // AI category words → words that appear in Facebook's category names.
  const CATEGORY_HINTS = [
    [/phone|laptop|computer|headphone|camera|console|tablet|electronic|audio|tv|speaker/i, /electronic|elektronik|počítač|computer/i],
    [/shoe|sneaker|boot|cloth|jacket|dress|shirt|bag|fashion|watch|jewel/i, /cloth|oblečen|kleidung|shoes|fashion|bag/i],
    [/furniture|chair|table|sofa|desk|lamp|shelf/i, /furniture|nábytek|möbel|meuble/i],
    [/toy|lego|game|puzzle|doll/i, /toy|hračk|spielzeug|jouet/i],
    [/bike|bicycle|sport|fitness|ski/i, /sport|bicycl|kolo|fahrrad/i],
    [/book|vinyl|record|cd|dvd|movie|music/i, /book|kniha|buch|music|movie/i],
    [/tool|drill|garden/i, /tool|nářad|werkzeug|garden|zahrad/i],
    [/baby|stroller|kid/i, /baby|dět|kinder/i],
    [/instrument|guitar|piano/i, /instrument|musical/i],
    [/kitchen|appliance|home|decor/i, /home|household|domác|haushalt|appliance/i],
  ];

  async function pickOption(re) {
    const opt = await s.waitFor(
      () => [...document.querySelectorAll('[role="option"], [role="menuitemradio"], [role="listbox"] [role="button"]')].find((o) => s.visible(o) && re.test(o.innerText)),
      4000,
    );
    if (!opt) return false;
    opt.click();
    await s.pause();
    return true;
  }

  s.onFill(async (job, photos) => {
    const todo = [];
    if (/\/login|checkpoint/.test(location.pathname)) return s.result("error", "Not logged in to Facebook in this Chrome.");

    s.progress("Uploading photos");
    const input = await s.waitFor(() => document.querySelector('input[type="file"][accept*="image"]'), 20000);
    if (!input) return s.result("error", "Couldn't find the photo upload on Facebook.");
    s.upload(input, photos.slice(0, 10));
    await s.sleep(2500);

    s.progress("Filling in title and price");
    const title = await s.waitFor(() => s.fieldByLabel(L.title), 10000);
    if (title) await s.type(title, job.title.slice(0, 100));
    else todo.push("title");
    const price = s.fieldByLabel(L.price);
    if (price) await s.type(price, String(job.price));
    else todo.push("price");

    s.progress("Choosing category and condition");
    const cat = s.clickableByText(L.category);
    if (cat) {
      cat.click();
      await s.pause(600, 1000);
      const hint = CATEGORY_HINTS.find(([ai]) => ai.test(job.category))?.[1];
      const ok = hint && (await pickOption(hint));
      if (!ok) {
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        todo.push("category");
      }
    } else todo.push("category");

    const cond = s.clickableByText(L.condition);
    if (cond) {
      cond.click();
      await s.pause(500, 900);
      const options = [...document.querySelectorAll('[role="option"]')].filter(s.visible);
      const opt = options[CONDITION_INDEX[job.condition] ?? 2];
      if (opt) {
        opt.click();
        await s.pause();
      } else todo.push("condition");
    } else todo.push("condition");

    s.progress("Writing the description");
    const desc = s.fieldByLabel(L.description);
    if (desc) await s.type(desc, job.description);
    else todo.push("description");

    const missing = todo.length ? ` Please add: ${todo.join(", ")}.` : "";
    if (!job.autoPublish) {
      return s.result("needs_review", `Filled in on Facebook. Check the open tab and press Publish.${missing}`);
    }

    s.progress("Publishing");
    for (const re of [L.next, L.next, L.publish]) {
      const btn = await s.waitFor(() => {
        const b = s.clickableByText(re);
        return b && b.getAttribute("aria-disabled") !== "true" ? b : null;
      }, 5000);
      if (btn) {
        btn.click();
        await s.sleep(2000);
      }
    }
    const left = await s.waitFor(() => !location.pathname.includes("/create/"), 30000);
    if (!left) return s.result("needs_review", `Facebook needs a hand in the open tab.${missing}`);
    s.result("live", "Posted on Facebook Marketplace", "https://www.facebook.com/marketplace/you/selling");
  });
})();
