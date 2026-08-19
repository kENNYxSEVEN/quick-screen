import { ArrowRight, CirclePlay, Radio } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DashboardLayout } from "@/layouts/dashboard-layout";

interface ViewerJoinProps {
  roomId: string;
  onJoin(): void;
}

export function ViewerJoin({ roomId, onJoin }: ViewerJoinProps) {
  return (
    <DashboardLayout showGrid>
      <div className="flex min-h-[calc(100svh-10rem)] items-center justify-center py-8">
        <div className="w-full max-w-[360px] sm:-translate-y-5">
          <div className="rounded-xl border border-white/[0.07] bg-[#121212] px-7 py-4 sm:px-7">
            <div className="text-center">
              <span className="mx-auto flex size-9 items-center justify-center rounded-lg border border-white/[0.09] bg-white/[0.025] text-zinc-400">
                <Radio className="size-4" aria-hidden="true" />
              </span>

              <p className="mt-3 text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">
                Joining room
              </p>

              <h1 title={roomId} className="mt-1.5 max-w-full truncate text-[1.375rem] font-semibold leading-none tracking-[-0.025em] text-zinc-50">
                {roomId}
              </h1>
            </div>

            <div className="mx-auto mt-5 w-full max-w-[280px]">
              <Button
                type="button"
                size="lg"
                onClick={onJoin}
                className="h-11 w-full rounded-lg bg-zinc-100 px-4 text-zinc-950 hover:bg-white"
              >
                <CirclePlay className="size-4" aria-hidden="true" />
                Join room
                <ArrowRight className="ml-auto size-4" aria-hidden="true" />
              </Button>
            </div>

            <p className="mt-3 text-center text-[11px] leading-5 text-zinc-500">
              The stream will start automatically.
            </p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}