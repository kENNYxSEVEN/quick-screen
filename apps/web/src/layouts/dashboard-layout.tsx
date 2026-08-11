import type { PropsWithChildren } from "react";

import { Brand } from "@/components/brand";

export function DashboardLayout({ children }: PropsWithChildren) {
  return (
    <main className="flex min-h-svh flex-col bg-zinc-950 text-white">
      <header className="h-16 shrink-0 border-b border-white/[0.06] px-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex h-full w-full max-w-6xl items-center">
          <Brand />
        </div>
      </header>

      <section className="flex-1 px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 sm:gap-4">
          {children}
        </div>
      </section>

      <footer className="flex h-12 shrink-0 items-center justify-center border-t border-white/[0.04] px-5 text-xs text-zinc-700">
        © 2026 iNGAMERS.PRO
      </footer>
    </main>
  );
}
