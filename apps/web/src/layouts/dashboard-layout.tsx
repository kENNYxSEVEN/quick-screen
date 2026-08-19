import type { PropsWithChildren } from "react";

import { Brand } from "@/components/brand";
import { HeaderUtilities } from "@/components/header-utilities";

interface DashboardLayoutProps {
  showGrid?: boolean;
}

function DashboardGridBackground() {
  const gridStyle = {
    backgroundImage:
      "linear-gradient(to right, rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.045) 1px, transparent 1px)",
    backgroundSize: "43px 43px",
    backgroundPosition: "center center",

    maskImage:
      "linear-gradient(to right, transparent 0%, black 22%, black 52%, transparent 100%), linear-gradient(to bottom, transparent 0%, black 32%, black 80%, transparent 100%)",
    maskComposite: "intersect",

    WebkitMaskImage:
      "linear-gradient(to right, transparent 0%, black 22%, black 52%, transparent 100%), linear-gradient(to bottom, transparent 0%, black 32%, black 80%, transparent 100%)",
    WebkitMaskComposite: "source-in",
  } as const;

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      <div className="absolute inset-0 opacity-80" style={gridStyle} />
    </div>
  );
}

export function DashboardLayout({
  children,
  showGrid = false,
}: PropsWithChildren<DashboardLayoutProps>) {
  return (
    <main className="flex min-h-svh flex-col bg-[#080808] text-white">
      <header className="h-16 shrink-0 border-b border-white/[0.055] bg-[#0d0d0d] px-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex h-full w-full max-w-6xl items-center">
          <Brand />
          <HeaderUtilities />
        </div>
      </header>

      <section className="relative flex-1 overflow-hidden px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
        {showGrid && <DashboardGridBackground />}

        <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-3 sm:gap-4">
          {children}
        </div>
      </section>

      <footer className="flex h-12 shrink-0 items-center justify-center border-t border-white/[0.04] bg-[#0d0d0d] px-5 text-[11px] text-zinc-600">
        © 2026 iNGAMERS.PRO
      </footer>
    </main>
  );
}
