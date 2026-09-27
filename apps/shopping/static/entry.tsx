import { Suspense } from "react";
import { createRoot } from "react-dom/client";
import CheckoutView from "@/app/checkout/page";
import OrdersPage from "@/app/orders/page";
import Home from "@/app/page";
import { ProductView } from "@/app/product/[id]/ProductView";
import ProfilePage from "@/app/profile/page";
import { SearchView } from "@/app/search/SearchView";
import SignInPage from "@/app/signin/page";
import { TrackView } from "@/app/track/[id]/TrackView";
import { AppShell } from "@/components/AppShell";
import { Providers } from "@/components/Providers";
import { getProduct } from "@/lib/data";
import { usePathname } from "./shims/navigation";

function Routes() {
  const path = usePathname();
  const [section, id] = path.split("/").filter(Boolean);
  const page = (() => {
    switch (section) {
      case undefined:
        return <Home />;
      case "search":
        return <SearchView />;
      case "product":
        return getProduct(id ?? "") ? <ProductView productId={id!} /> : <Missing />;
      case "checkout":
        return <CheckoutView />;
      case "orders":
        return <OrdersPage />;
      case "track":
        return <TrackView id={id ?? ""} />;
      case "profile":
        return <ProfilePage />;
      case "signin":
        return <SignInPage />;
      default:
        return <Missing />;
    }
  })();
  // Keyed by path so each screen starts fresh, like a real page navigation.
  return (
    <Suspense key={path}>
      {page}
    </Suspense>
  );
}

function Missing() {
  return <p className="py-24 text-center text-muted">That page doesn't exist.</p>;
}

createRoot(document.getElementById("root")!).render(
  <Providers value={{ user: null, googleEnabled: false, gmailEnabled: false, aiEnabled: false }}>
    <AppShell>
      <Routes />
    </AppShell>
  </Providers>,
);
