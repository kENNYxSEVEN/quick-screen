import { CirclePlay, Radio } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DashboardLayout } from "@/layouts/dashboard-layout";

interface ViewerJoinProps {
  roomId: string;
  onJoin(): void;
}

export function ViewerJoin({ roomId, onJoin }: ViewerJoinProps) {
  return (
    <DashboardLayout>
      <div className="relative min-h-[calc(100svh-10rem)]">
        <div className="pointer-events-none flex flex-col gap-3 opacity-70 blur-[2px] sm:gap-4" aria-hidden="true">
          <Card className="gap-0 bg-white/[0.03] p-3 ring-white/10 sm:p-3.5">
            <div className="flex items-center gap-2">
              <span className="h-8 w-28 animate-pulse rounded-md bg-white/[0.07]" />
              <span className="h-8 w-24 animate-pulse rounded-md bg-white/[0.05]" />
            </div>
          </Card>

          <Card className="gap-0 overflow-hidden bg-white/[0.03] p-0 ring-white/10">
            <div className="relative aspect-video min-h-72 overflow-hidden bg-zinc-950 sm:min-h-80">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.04),transparent_55%)]" />
              <div className="absolute inset-x-[18%] top-[35%] h-3 animate-pulse rounded-full bg-white/[0.06]" />
              <div className="absolute inset-x-[30%] top-[43%] h-2 animate-pulse rounded-full bg-white/[0.04]" />
            </div>
          </Card>
        </div>

        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/35 px-4 backdrop-blur-sm">
          <Card className="w-full max-w-md items-center gap-4 border-white/10 bg-zinc-950/85 p-5 text-center shadow-2xl shadow-black/40 sm:p-6">
            <span className="flex size-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-zinc-200">
              <Radio className="size-5" aria-hidden="true" />
            </span>

            <div>
              <h1 className="text-lg font-semibold tracking-tight text-white">Ready to join?</h1>
              <p className="mt-1 text-sm leading-6 text-zinc-500">
                Connect to <span className="font-mono text-zinc-300">{roomId}</span> when you are ready.
              </p>
            </div>

            <Button type="button" size="lg" onClick={onJoin}>
              <CirclePlay className="size-4" aria-hidden="true" />
              Join room
            </Button>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
