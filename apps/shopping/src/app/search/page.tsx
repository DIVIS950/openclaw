import { Suspense } from "react";
import { SearchView } from "./SearchView";

export default function SearchPage() {
  return (
    <Suspense>
      <SearchView />
    </Suspense>
  );
}
