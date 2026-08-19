import {
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export type FloatingAlertVariant = "error" | "warning" | "info" | "success";

export interface FloatingAlertItem {
  id: string;
  title?: string;
  description: string;
  variant?: FloatingAlertVariant;

  /**
   * Undefined -> use the default duration for the variant.
   * null      -> keep the alert visible until dismissed/cleared.
   * number    -> auto-dismiss after this many milliseconds.
   */
  durationMs?: number | null;
}

interface FloatingAlertStackProps {
  alerts: FloatingAlertItem[];
  className?: string;
}

interface AlertVisual {
  icon: LucideIcon;
  iconClassName: string;
  iconShellClassName: string;
  alertClassName: string;
}

const DEFAULT_ALERT_DURATION_MS: Record<
  FloatingAlertVariant,
  number | null
> = {
  error: null,
  warning: 8_000,
  info: 5_000,
  success: 3_500,
};

const alertVisuals: Record<FloatingAlertVariant, AlertVisual> = {
  error: {
    icon: CircleAlert,
    iconClassName: "text-red-300/80",
    iconShellClassName:
      "border-red-400/[0.12] bg-red-400/[0.045]",
    alertClassName: "border-red-400/[0.14]",
  },
  warning: {
    icon: TriangleAlert,
    iconClassName: "text-amber-300/80",
    iconShellClassName:
      "border-amber-400/[0.12] bg-amber-400/[0.04]",
    alertClassName: "border-amber-400/[0.13]",
  },
  info: {
    icon: Info,
    iconClassName: "text-sky-200/75",
    iconShellClassName:
      "border-sky-300/[0.10] bg-sky-300/[0.03]",
    alertClassName: "border-white/[0.09]",
  },
  success: {
    icon: CircleCheck,
    iconClassName: "text-emerald-300/80",
    iconShellClassName:
      "border-emerald-400/[0.12] bg-emerald-400/[0.04]",
    alertClassName: "border-emerald-400/[0.13]",
  },
};

function getDefaultAlertTitle(description: string) {
  const message = description.toLowerCase();

  if (message.includes("room name is already in use")) {
    return "Room name unavailable";
  }

  if (message.includes("screen sharing is not available")) {
    return "Screen sharing unavailable";
  }

  if (
    message.includes("screen sharing was cancelled") ||
    message.includes("could not be started")
  ) {
    return "Screen sharing failed";
  }

  if (
    message.includes("source change") ||
    message.includes("change the shared screen")
  ) {
    return "Unable to change source";
  }

  if (message.includes("publish the screen")) {
    return "Unable to start stream";
  }

  if (message.includes("pause state")) {
    return "Unable to update stream";
  }

  if (message.includes("end the room")) {
    return "Unable to end room";
  }

  if (message.includes("create the room")) {
    return "Unable to create room";
  }

  return "Something went wrong";
}

function getAlertSignature(alert: FloatingAlertItem) {
  return `${alert.id}:${alert.variant ?? "error"}:${alert.title ?? ""}:${alert.description}`;
}

interface FloatingAlertCardProps {
  alert: FloatingAlertItem;
  signature: string;
  onDismiss(signature: string): void;
}

const ALERT_EXIT_DURATION_MS = 180;

function FloatingAlertCard({
  alert,
  signature,
  onDismiss,
}: FloatingAlertCardProps) {
  const variant = alert.variant ?? "error";
  const visual = alertVisuals[variant];
  const Icon = visual.icon;

  const durationMs =
    alert.durationMs === undefined
      ? DEFAULT_ALERT_DURATION_MS[variant]
      : alert.durationMs;

  const [isExiting, setIsExiting] = useState(false);
  const exitTimerRef = useRef<number | null>(null);

  const requestDismiss = useCallback(() => {
    if (isExiting) {
      return;
    }

    setIsExiting(true);

    exitTimerRef.current = window.setTimeout(() => {
      onDismiss(signature);
    }, ALERT_EXIT_DURATION_MS);
  }, [isExiting, onDismiss, signature]);

  useEffect(() => {
    if (durationMs === null || durationMs <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      requestDismiss();
    }, durationMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [durationMs, requestDismiss]);

  useEffect(() => {
    return () => {
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
      }
    };
  }, []);

  return (
    <div
      className={cn(
        "grid overflow-hidden",
        isExiting
          ? "floating-alert-shell-exit"
          : "floating-alert-shell-enter",
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <Alert
          role={variant === "error" || variant === "warning" ? "alert" : "status"}
          variant={variant === "error" ? "destructive" : "default"}
          className={cn(
            "pointer-events-auto bg-[#141414]/98",
            "shadow-[0_12px_36px_rgba(0,0,0,0.28)] backdrop-blur-md",
            isExiting
              ? "floating-alert-card-exit"
              : "floating-alert-card-enter",
            visual.alertClassName,
          )}
        >
          <span
            className={cn(
              "flex size-8 items-center justify-center rounded-lg border",
              visual.iconShellClassName,
            )}
          >
            <Icon
              className={cn("size-4", visual.iconClassName)}
              aria-hidden="true"
            />
          </span>

          <AlertTitle>
            {alert.title ?? getDefaultAlertTitle(alert.description)}
          </AlertTitle>

          <AlertDescription>{alert.description}</AlertDescription>

          <AlertAction>
            <button
              type="button"
              onClick={requestDismiss}
              className="flex size-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
              aria-label="Dismiss alert"
              title="Dismiss"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </AlertAction>
        </Alert>
      </div>
    </div>
  );
}

export function FloatingAlertStack({
  alerts,
  className,
}: FloatingAlertStackProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  const activeSignatures = useMemo(
    () => alerts.map(getAlertSignature),
    [alerts],
  );
  const activeSignatureKey = activeSignatures.join("\u0000");

  useEffect(() => {
    setDismissed((current) => {
      if (current.size === 0) {
        return current;
      }

      const active = new Set(activeSignatures);
      const next = new Set(
        Array.from(current).filter((signature) => active.has(signature)),
      );

      return next.size === current.size ? current : next;
    });
  }, [activeSignatureKey]);

  const dismissAlert = useCallback((signature: string) => {
    setDismissed((current) => {
      if (current.has(signature)) {
        return current;
      }

      const next = new Set(current);
      next.add(signature);

      return next;
    });
  }, []);

  const visibleAlerts = alerts.filter(
    (alert) => !dismissed.has(getAlertSignature(alert)),
  );

  if (visibleAlerts.length === 0) {
    return null;
  }

  return (
    <>
      <style>{`
        @keyframes quick-screen-alert-card-enter {
          from {
            opacity: 0;
            transform: translate3d(10px, -2px, 0) scale(0.985);
          }
          to {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
          }
        }

        @keyframes quick-screen-alert-card-exit {
          from {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
          }
          to {
            opacity: 0;
            transform: translate3d(8px, -2px, 0) scale(0.985);
          }
        }

        @keyframes quick-screen-alert-shell-enter {
          from {
            grid-template-rows: 0fr;
            margin-bottom: 0;
          }
          to {
            grid-template-rows: 1fr;
            margin-bottom: 10px;
          }
        }

        @keyframes quick-screen-alert-shell-exit {
          from {
            grid-template-rows: 1fr;
            margin-bottom: 10px;
          }
          to {
            grid-template-rows: 0fr;
            margin-bottom: 0;
          }
        }

        .floating-alert-card-enter {
          animation: quick-screen-alert-card-enter 220ms
            cubic-bezier(0.16, 1, 0.3, 1) both;
          transform-origin: top right;
        }

        .floating-alert-card-exit {
          animation: quick-screen-alert-card-exit 180ms
            cubic-bezier(0.4, 0, 1, 1) both;
          transform-origin: top right;
        }

        .floating-alert-shell-enter {
          animation: quick-screen-alert-shell-enter 220ms
            cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        .floating-alert-shell-exit {
          animation: quick-screen-alert-shell-exit 180ms
            cubic-bezier(0.4, 0, 1, 1) both;
        }

        @media (max-width: 639px) {
          @keyframes quick-screen-alert-card-enter {
            from {
              opacity: 0;
              transform: translate3d(0, -8px, 0) scale(0.99);
            }
            to {
              opacity: 1;
              transform: translate3d(0, 0, 0) scale(1);
            }
          }

          @keyframes quick-screen-alert-card-exit {
            from {
              opacity: 1;
              transform: translate3d(0, 0, 0) scale(1);
            }
            to {
              opacity: 0;
              transform: translate3d(0, -6px, 0) scale(0.99);
            }
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .floating-alert-card-enter,
          .floating-alert-card-exit,
          .floating-alert-shell-enter,
          .floating-alert-shell-exit {
            animation-duration: 1ms !important;
          }
        }
      `}</style>

      <div
        className={cn(
          "pointer-events-none fixed left-4 right-4 top-20 z-[100] flex flex-col",
          "sm:left-auto sm:right-4 sm:w-[340px]",
          "lg:right-6",
          className,
        )}
        aria-live="polite"
        aria-label="Application alerts"
      >
      {visibleAlerts.map((alert) => {
        const signature = getAlertSignature(alert);

        return (
          <FloatingAlertCard
            key={signature}
            alert={alert}
            signature={signature}
            onDismiss={dismissAlert}
          />
        );
        })}
      </div>
    </>
  );
}
