import { ArrowLeft, SearchX } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { DashboardLayout } from "@/layouts/dashboard-layout";

interface NotFoundProps {
  title?: string;
  description?: string;
}

export function NotFound({
  title = "This page is not available",
  description = "The link may be incomplete, or the page may have moved.",
}: NotFoundProps) {
  return (
    <DashboardLayout showGrid>
      <div className="flex min-h-[calc(100svh-10rem)] items-center justify-center py-8">
        <div className="w-full max-w-[360px] sm:-translate-y-5">
          <div className="rounded-xl border border-white/[0.07] bg-[#121212] px-7 py-6">
            <div className="text-center">
              <span className="mx-auto flex size-9 items-center justify-center rounded-lg border border-white/[0.09] bg-white/[0.025] text-zinc-400">
                <SearchX className="size-4" aria-hidden="true" />
              </span>

              <p className="mt-3 text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">
                404
              </p>

              <h1 className="mt-1.5 text-[1.375rem] font-semibold leading-none tracking-[-0.025em] text-zinc-50">
                {title}
              </h1>

              <p className="mx-auto mt-3 max-w-[270px] text-xs leading-5 text-zinc-400">
                {description}
              </p>
            </div>

            <div className="mx-auto mt-5 w-full max-w-[280px]">
              <Button
                size="lg"
                className="h-11 w-full rounded-lg bg-zinc-100 px-4 text-zinc-950 hover:bg-white"
                render={<Link to="/" />}
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                Back home
              </Button>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}