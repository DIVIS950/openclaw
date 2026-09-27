import { notFound } from "next/navigation";
import { getProduct } from "@/lib/data";
import { ProductView } from "./ProductView";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = getProduct(id);
  if (!product) notFound();
  return <ProductView productId={product.id} />;
}
