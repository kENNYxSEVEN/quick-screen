export interface RecentRoom {
  roomId: string;
  lastUsedAt: number;
}

const STORAGE_KEY = "ingamers-screen:recent-room";

export function getRecentRoom(): RecentRoom | null {
  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);

    if (!rawValue) {
      return null;
    }

    const parsedValue: unknown = JSON.parse(rawValue);

    if (
      typeof parsedValue !== "object" ||
      parsedValue === null ||
      !("roomId" in parsedValue) ||
      !("lastUsedAt" in parsedValue) ||
      typeof parsedValue.roomId !== "string" ||
      typeof parsedValue.lastUsedAt !== "number"
    ) {
      return null;
    }

    return {
      roomId: parsedValue.roomId,
      lastUsedAt: parsedValue.lastUsedAt,
    };
  } catch {
    return null;
  }
}

export function rememberRoom(roomId: string) {
  const recentRoom: RecentRoom = {
    roomId,
    lastUsedAt: Date.now(),
  };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(recentRoom));
  } catch {
    // Local storage is optional. Sharing must still work if it is unavailable.
  }
}
