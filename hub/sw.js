// Student Hub service worker: only here so notifications work from the Home
// Screen (iPhone needs one). It caches nothing, so updates arrive as usual.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Tapping a reminder opens the hub (or brings it to the front).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
