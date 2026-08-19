import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative grid w-full grid-cols-[min-content_minmax(0,1fr)] items-start gap-x-3 rounded-xl border px-4 py-3 text-sm",
  {
    variants: {
      variant: {
        default:
          "border-white/[0.09] bg-[#141414] text-zinc-200",
        destructive:
          "border-red-400/[0.14] bg-[#141414] text-zinc-200",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "min-w-0 pr-7 text-[13px] font-medium leading-5 text-zinc-100",
        className,
      )}
      {...props}
    />
  );
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "col-start-2 mt-0.5 min-w-0 pr-7 text-xs leading-5 text-zinc-400",
        className,
      )}
      {...props}
    />
  );
}

function AlertAction({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute right-2.5 top-2.5", className)}
      {...props}
    />
  );
}

export {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
};
