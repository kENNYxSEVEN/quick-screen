import { ArrowLeft, SearchX } from "lucide-react";
import { Link } from "react-router-dom";

import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

interface NotFoundProps {
  title?: string;
  description?: string;
}

export function NotFound({
  title = "This page is not available",
  description = "The link may be incomplete, or the page may have moved.",
}: NotFoundProps) {
  return (
    <main className="flex min-h-svh flex-col bg-zinc-950 px-6 py-6 text-white">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between">
        <Brand />
      </header>
      <section className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-300">
          <SearchX className="size-5" aria-hidden="true" />
        </span>
        <p className="mt-6 text-sm font-medium text-zinc-400">404</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-500">
          {description}
        </p>
        <Button className="mt-7 h-10 px-4" render={<Link to="/" />}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back home
        </Button>
      </section>
    </main>
  );
}
