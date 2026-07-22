import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "text-foreground border-input",
        success: "border-transparent bg-[color-mix(in_srgb,var(--success)_14%,transparent)] text-[var(--success)]",
        warning: "border-transparent bg-[color-mix(in_srgb,var(--warning)_16%,transparent)] text-[var(--warning)]",
        danger: "border-transparent bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-[var(--danger)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({ className, variant, ...props }) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
