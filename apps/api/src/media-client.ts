export interface MediaSessionDescription {
  type: "offer" | "answer";
  sdp: string;
}

export interface MediaClient {
  publish(roomId: string, offer: MediaSessionDescription): Promise<MediaSessionDescription>;
  subscribe(roomId: string, offer: MediaSessionDescription): Promise<MediaSessionDescription>;
  closeRoom(roomId: string): Promise<void>;
}

export class MediaServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, status = 502, code = "media_unavailable") {
    super(message);
    this.name = "MediaServiceError";
    this.status = status;
    this.code = code;
  }
}

interface MediaSignalResponse {
  answer: MediaSessionDescription;
}

interface MediaErrorResponse {
  error: string;
  message: string;
}

function isSessionDescription(value: unknown): value is MediaSessionDescription {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "sdp" in value &&
    (value.type === "offer" || value.type === "answer") &&
    typeof value.sdp === "string"
  );
}

function isMediaSignalResponse(value: unknown): value is MediaSignalResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "answer" in value &&
    isSessionDescription(value.answer)
  );
}

function isMediaErrorResponse(value: unknown): value is MediaErrorResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    "message" in value &&
    typeof value.error === "string" &&
    typeof value.message === "string"
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

export class HttpMediaClient implements MediaClient {
  private readonly origin: string;

  constructor(origin = process.env.MEDIA_ORIGIN ?? "http://localhost:3002") {
    this.origin = origin.replace(/\/$/, "");
  }

  async publish(roomId: string, offer: MediaSessionDescription) {
    return this.signal(`/rooms/${encodeURIComponent(roomId)}/publish`, offer);
  }

  async subscribe(roomId: string, offer: MediaSessionDescription) {
    return this.signal(`/rooms/${encodeURIComponent(roomId)}/subscribe`, offer);
  }

  async closeRoom(roomId: string) {
    try {
      const response = await fetch(`${this.origin}/rooms/${encodeURIComponent(roomId)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new MediaServiceError("The media service could not close this room.", response.status);
      }
    } catch (error) {
      if (error instanceof MediaServiceError) {
        throw error;
      }

      throw new MediaServiceError("The media service is unavailable.");
    }
  }

  private async signal(path: string, offer: MediaSessionDescription) {
    try {
      const response = await fetch(`${this.origin}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ offer }),
      });
      const payload = await readJson(response);

      if (!response.ok) {
        if (isMediaErrorResponse(payload)) {
          throw new MediaServiceError(payload.message, response.status, payload.error);
        }

        throw new MediaServiceError(
          "The media service could not negotiate this session.",
          response.status,
        );
      }

      if (!isMediaSignalResponse(payload)) {
        throw new MediaServiceError("The media service returned an invalid session answer.");
      }

      return payload.answer;
    } catch (error) {
      if (error instanceof MediaServiceError) {
        throw error;
      }

      throw new MediaServiceError("The media service is unavailable.");
    }
  }
}
