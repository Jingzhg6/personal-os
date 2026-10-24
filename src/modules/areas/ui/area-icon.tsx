import {
  BookOpen,
  Briefcase,
  Circle,
  ClipboardList,
  Code,
  Dumbbell,
  GraduationCap,
  Heart,
  House,
  Leaf,
  type LucideIcon,
  Music,
  Palette,
  Plane,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";

import { cn } from "@/shared/lib/cn";

import type { AreaIconId } from "../domain";

export const areaIcons: Record<AreaIconId, LucideIcon> = {
  circle: Circle,
  heart: Heart,
  "graduation-cap": GraduationCap,
  dumbbell: Dumbbell,
  briefcase: Briefcase,
  "trending-up": TrendingUp,
  clipboard: ClipboardList,
  home: House,
  users: Users,
  wallet: Wallet,
  plane: Plane,
  code: Code,
  music: Music,
  palette: Palette,
  leaf: Leaf,
  book: BookOpen,
};

export function AreaIcon({ icon, className }: { icon: AreaIconId; className?: string }) {
  const Icon = areaIcons[icon] ?? Circle;
  return <Icon aria-hidden className={cn("size-4 shrink-0", className)} />;
}
