export const viewerConnectionStates = [
  "waiting",
  "connecting",
  "watching",
  "disconnected",
] as const;

export type ViewerConnectionState = (typeof viewerConnectionStates)[number];

export function isViewerConnectionState(
  value: string | null,
): value is ViewerConnectionState {
  return viewerConnectionStates.some((state) => state === value);
}
