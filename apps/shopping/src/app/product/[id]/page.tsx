import { ProductView } from "./ProductView";

// Search results are created in the browser, so the view resolves the product client-side.
export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductView productId={id} />;
}
