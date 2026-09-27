import { LayoutGrid, Plug, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Me, Settings } from "../shared/types.ts";
import { Avatar, Logo, cx } from "./components/ui.tsx";
import { api, AuthError, SetupError, type Health } from "./lib/api.ts";
import { Connections } from "./screens/Connections.tsx";
import { Home } from "./screens/Home.tsx";
import { ListingScreen } from "./screens/Listing.tsx";
import { NewListing } from "./screens/NewListing.tsx";
import { Setup } from "./screens/Setup.tsx";
import { SetupChecklist } from "./screens/SetupChecklist.tsx";
import { Welcome } from "./screens/Welcome.tsx";

type Route = { name: "home" } | { name: "new" } | { name: "listing"; id: string } | { name: "connections" } | { name: "setup" };

function parse(hash: string): Route {
  const [, a, b] = hash.replace(/^#/, "").split("?")[0].split("/");
  if (a === "new") return { name: "new" };
  if (a === "l" && b) return { name: "listing", id: b };
  if (a === "connections" || a === "settings") return { name: "connections" };
  if (a === "setup") return { name: "setup" };
  return { name: "home" };
}

/** Query parameters inside the hash, e.g. #/connections?ebay=connected */
export function hashParams() {
  return new URLSearchParams(location.hash.split("?")[1] ?? "");
}

type AppCtx = {
  me: Me;
  settings: Settings;
  setSettings: (s: Settings) => void;
  health: Health | null;
  refreshHealth: () => Promise<void>;
  go: (path: string, replace?: boolean) => void;
  back: () => void;
  signOut: () => Promise<void>;
};
const Ctx = createContext<AppCtx>(null!);
export const useApp = () => useContext(Ctx);

export function App() {
  const [route, setRoute] = useState<Route>(() => parse(location.hash));
  const [me, setMe] = useState<Me | null | "signed-out" | "setup">(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [health, setHealth] = useState<Health | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, s] = await Promise.all([api.me(), api.settings()]);
      setMe(m);
      setSettings(s);
    } catch (e) {
      if (e instanceof AuthError) setMe("signed-out");
      else if (e instanceof SetupError) setMe("setup");
      else setTimeout(load, 2000); // server restarting: retry
    }
  }, []);

  useEffect(() => {
    const on = () => {
      setRoute(parse(location.hash));
      scrollTo(0, 0);
    };
    addEventListener("hashchange", on);
    api.health().then(setHealth).catch(() => {});
    void load();
    return () => removeEventListener("hashchange", on);
  }, [load]);

  const go = useCallback((path: string, replace = false) => {
    if (replace) location.replace(`#${path}`);
    else location.hash = path;
  }, []);
  const back = useCallback(() => (history.length > 1 ? history.back() : go("/")), [go]);
  const refreshHealth = useCallback(async () => setHealth(await api.health()), []);
  const signOut = useCallback(async () => {
    await api.logout();
    setMe("signed-out");
    go("/", true);
  }, [go]);

  if (me === null) return <div className="min-h-dvh" />;
  if (me === "setup") return <SetupChecklist />;
  if (me === "signed-out") return <Welcome health={health} />;
  if (!settings) return <div className="min-h-dvh" />;
  if (!settings.onboarded) {
    return (
      <Setup
        settings={settings}
        local={Boolean(health?.local)}
        onDone={(s) => {
          setSettings(s);
          void api.health().then(setHealth);
        }}
      />
    );
  }

  const key = route.name === "listing" ? `l-${route.id}` : route.name;
  return (
    <Ctx.Provider value={{ me, settings, setSettings, health, refreshHealth, go, back, signOut }}>
      <Shell route={route}>
        {/* Slide in; the transform is cleared when it ends, so the screens' fixed bottom bars stay put. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={key}
            initial={{ opacity: 0, x: route.name === "home" ? -24 : 32 }}
            animate={{ opacity: 1, x: 0, transitionEnd: { transform: "none" } }}
            exit={{ opacity: 0, x: route.name === "home" ? 24 : -24 }}
            transition={{ type: "spring", stiffness: 420, damping: 38 }}
          >
            {route.name === "home" && <Home />}
            {route.name === "new" && <NewListing />}
            {route.name === "listing" && <ListingScreen id={route.id} />}
            {route.name === "connections" && <Connections />}
            {route.name === "setup" && <SetupChecklist onBack={() => go("/connections")} />}
          </motion.div>
        </AnimatePresence>
      </Shell>
    </Ctx.Provider>
  );
}

/** Phone: one column. Desktop (lg+): sidebar navigation beside the content, as in the web design. */
function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const { me, go } = useApp();
  const [ext, setExt] = useState<{ online: boolean; paired: boolean } | null>(null);
  useEffect(() => {
    api.extension().then(setExt).catch(() => {});
  }, [route.name]);

  const nav = [
    { id: "home", label: "Listings", icon: LayoutGrid, path: "/" },
    { id: "new", label: "New listing", icon: Plus, path: "/new" },
    { id: "connections", label: "Connections", icon: Plug, path: "/connections" },
  ];
  return (
    <div className="lg:flex lg:min-h-dvh">
      <nav className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col gap-1 border-r border-line px-4 py-7 lg:flex" aria-label="Main">
        <div className="px-2 pb-5">
          <Logo size={34} />
        </div>
        {nav.map((n) => (
          <a
            key={n.id}
            href={`#${n.path}`}
            className={cx(
              "flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-semibold",
              route.name === n.id || (n.id === "home" && route.name === "listing") ? "bg-ink text-white" : "hover:bg-soft",
            )}
          >
            <n.icon className="size-[18px]" /> {n.label}
          </a>
        ))}
        <div className="flex-1" />
        {ext && (
          <button onClick={() => go("/connections")} className="rounded-2xl border border-line bg-card p-3 text-left">
            <div className="flex items-center gap-1.5 text-[13px] font-bold">
              <span className={cx("size-2 rounded-full", ext.online ? "bg-ok" : "bg-faint")} />
              Chrome extension {ext.paired ? (ext.online ? "online" : "offline") : "not set up"}
            </div>
            <div className="mt-1 text-xs text-muted">Posts to Facebook and Vinted from your computer</div>
          </button>
        )}
        <button onClick={() => go("/connections")} className="mt-2 flex items-center gap-2.5 rounded-xl p-2 text-left hover:bg-soft">
          <Avatar name={me.name} picture={me.picture} size={32} />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{me.name}</span>
        </button>
      </nav>
      <main className="mx-auto min-h-dvh w-full min-w-0 max-w-lg lg:max-w-none lg:flex-1">{children}</main>
    </div>
  );
}
