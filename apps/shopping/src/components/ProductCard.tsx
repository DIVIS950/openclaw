"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { getStore, offersFor, type Product } from "@/lib/data";
import { money } from "@/lib/format";
import { assessStore } from "@/lib/safety";
import { ProductArt } from "./ui";

/** Lowest price among shops that pass the safety check. */
export function bestSafeOffer(product: Product) {
  return offersFor(product.id)
    .filter((o) => assessStore(getStore(o.storeId)!, o.price, product.typicalPrice).level !== "danger")
    .sort((a, b) => a.price - b.price)[0];
}

export function ProductCard({ product, index = 0 }: { product: Product; index?: number }) {
  const best = bestSafeOffer(product);
  const shops = offersFor(product.id).length;
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}>
      <Link href={`/product/${product.id}`} className="group block">
        <ProductArt product={product} className="aspect-square transition duration-300 group-hover:scale-[1.02]" />
        <div className="mt-2.5 px-0.5">
          <div className="truncate font-medium">{product.title}</div>
          <div className="mt-0.5 flex items-baseline gap-1.5 text-sm">
            {best && <span className="font-semibold">{money(best.price)}</span>}
            <span className="truncate text-muted">{best ? `at ${getStore(best.storeId)?.name}` : "no safe offer"}</span>
          </div>
          <div className="mt-0.5 text-xs text-muted">
            {shops} {shops === 1 ? "shop" : "shops"} compared{product.source === "estimate" ? " · est." : product.source === "web" ? " · live" : ""}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
