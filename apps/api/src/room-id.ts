const ROOM_ID_PATTERN = /^[a-z0-9-]{3,48}$/;

export function isValidRoomId(roomId: string) {
  return ROOM_ID_PATTERN.test(roomId);
}
