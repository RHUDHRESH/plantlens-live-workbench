import type { LucideIcon } from "lucide-react";
import { ASSETS } from "@/lib/domain/plant";
import { assetIcon } from "./plantMeta";

/** Icon component per asset, resolved once at module load so render never creates components. */
export const ASSET_ICONS: Record<string, LucideIcon> = Object.fromEntries(ASSETS.map((a) => [a.id, assetIcon(a.id)]));
