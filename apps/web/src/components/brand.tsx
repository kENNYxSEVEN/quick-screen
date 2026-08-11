import { Link } from "react-router-dom";

import { cn } from "@/lib/utils";

interface BrandProps {
  className?: string;
}

export function Brand({ className }: BrandProps) {
  return (
    <Link
      to="/"
      className={cn("inline-flex shrink-0 items-center", className)}
      aria-label="Quick Screen"
    >
      <img
        src="/logo-horizontal.svg"
        alt=""
        className="h-9 w-auto"
        aria-hidden="true"
      />
    </Link>
  );
}