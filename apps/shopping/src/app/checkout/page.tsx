import { Suspense } from "react";
import { CheckoutView } from "./CheckoutView";

export default function CheckoutPage() {
  return (
    <Suspense>
      <CheckoutView />
    </Suspense>
  );
}
