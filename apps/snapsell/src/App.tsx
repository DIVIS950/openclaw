import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Settings } from "../shared/types.ts";
import { api } from "./lib/api.ts";
import { Home } from "./screens/Home.tsx";
import { ListingScreen } from "./screens/Listing.tsx";
import { NewListing } from "./screens/NewListing.tsx";
import { Onboarding } from "./screens/Onboarding.tsx";
import { SettingsScreen } from "./screens/Settings.tsx";

type Route = { name: "home" } | { name: "new" } | { name: "listing"; id: string } | { name: "settings" };

function parse(hash: string): Route {
  const [, a, b] = hash.replace(/^#/, "").split("/");
  if (a === "new") return { name: "new" };
  if (a === "l" && b) return { name: "listing", id: b };
  if (a === "settings") return { name: "settings" };
  return { name: "home" };
}

type AppCtx = {
  settings: Settings | null;
  setSettings: (s: Settings) => void;
  demo: boolean;
  go: (path: string, replace?: boolean) => void;
  back: () => void;
};
const Ctx = createContext<AppCtx>(null!);
export const useApp = () => useContext(Ctx);

export function App() {
  const [route, setRoute] = useState<Route>(() => parse(location.hash));
  const [settings, setSettings] = useState<Settings | null>(null);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    const on = () => {
      setRoute(parse(location.hash));
      scrollTo(0, 0);
    };
    addEventListener("hashchange", on);
    api.settings().then(setSettings).catch(() => {});
    api.health().then((h) => setDemo(h.demo)).catch(() => {});
    return () => removeEventListener("hashchange", on);
  }, []);

  const go = useCallback((path: string, replace = false) => {
    if (replace) location.replace(`#${path}`);
    else location.hash = path;
  }, []);
  const back = useCallback(() => (history.length > 1 ? history.back() : go("/")), [go]);

  if (!settings) return <div className="min-h-dvh" />;

  const key = route.name === "listing" ? `l-${route.id}` : route.name;
  return (
    <Ctx.Provider value={{ settings, setSettings, demo, go, back }}>
      <div className="mx-auto min-h-dvh max-w-lg">
        {!settings.onboarded ? (
          <Onboarding />
        ) : (
          // Opacity-only transition: a transform here would break the screens' fixed bottom bars.
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={key}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {route.name === "home" && <Home />}
              {route.name === "new" && <NewListing />}
              {route.name === "listing" && <ListingScreen id={route.id} />}
              {route.name === "settings" && <SettingsScreen />}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </Ctx.Provider>
  );
}
