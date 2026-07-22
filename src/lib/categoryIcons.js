import {
  Apple,
  Coffee,
  Droplets,
  Layers3,
  Package,
  Pill,
  Shirt,
  ShoppingBasket,
  Smartphone,
  Utensils,
  Wrench,
} from "lucide-react";

export const CATEGORY_ICONS = [
  { id: "layers", Icon: Layers3 },
  { id: "package", Icon: Package },
  { id: "basket", Icon: ShoppingBasket },
  { id: "utensils", Icon: Utensils },
  { id: "coffee", Icon: Coffee },
  { id: "apple", Icon: Apple },
  { id: "droplets", Icon: Droplets },
  { id: "pill", Icon: Pill },
  { id: "shirt", Icon: Shirt },
  { id: "phone", Icon: Smartphone },
  { id: "wrench", Icon: Wrench },
];

export function resolveCategoryIcon(iconId) {
  return CATEGORY_ICONS.find((entry) => entry.id === iconId)?.Icon || Layers3;
}

export function isCategoryActive(category) {
  return category?.active !== false && category?.is_active !== false;
}
