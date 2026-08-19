import {
  publishRoomMedia,
  subscribeRoomMedia,
  type MediaSessionDescription,
} from "@/lib/api";
import { browserIceConfiguration } from "@/lib/ice-config";

const ICE_GATHERING_TIMEOUT_MS = 10_000;
const mediaKinds = ["video", "audio"] as const;
const diagnosticCandidateTypes = ["host", "srflx", "relay"] as const;

type MediaKind = (typeof mediaKinds)[number];
type MediaTracks = Record<MediaKind, MediaStreamTrack[]>;
type DiagnosticCandidateType = (typeof diagnosticCandidateTypes)[number];
type WebRtcRole = "host" | "viewer";
type WebRtcStage =
  | "peer-connection-create"
  | "subscriber-setup"
  | "create-offer"
  | "set-local-description"
  | "ice-gathering"
  | "ice-gathering-timeout"
  | "local-description"
  | "subscribe-request"
  | "set-remote-description";

export interface PublisherConnection {
  replaceTracks(stream: MediaStream): Promise<void>;
  setPaused(paused: boolean): Promise<void>;
  setBitrate(maxBitrate: number | null): Promise<void>;
  close(): void;
}

export interface SubscriberConnection {
  close(): void;
}

export interface WebRtcDiagnostic {
  role: WebRtcRole;
  stage: WebRtcStage;
  reason: string;
}

export class WebRtcSignalingError extends Error {
  readonly diagnostic: WebRtcDiagnostic;
  readonly cause: unknown;

  constructor(role: WebRtcRole, stage: WebRtcStage, error: unknown) {
    const reason = error instanceof Error ? error.message : "Unknown WebRTC error.";

    super(`WebRTC ${role} failed during ${stage}: ${reason}`);
    this.name = "WebRtcSignalingError";
    this.diagnostic = { role, stage, reason };
    this.cause = error;
  }
}

interface SubscriberCallbacks {
  onConnectionStateChange(state: RTCPeerConnectionState): void;
  onTrack(stream: MediaStream): void;
}

interface CandidatePairStats extends RTCStats {
  localCandidateId?: string;
  nominated?: boolean;
  remoteCandidateId?: string;
  selected?: boolean;
  state?: string;
}

interface CandidateStats extends RTCStats {
  candidateType?: string;
}

function logWebRtc(event: string, details: Record<string, unknown>) {
  if (import.meta.env.DEV || import.meta.env.VITE_WEBRTC_DIAGNOSTICS === "true") {
    console.info(`[webrtc] ${event}`, details);
  }
}

function getDiagnosticCandidateType(candidate: RTCIceCandidate): DiagnosticCandidateType | null {
  return diagnosticCandidateTypes.find((type) => type === candidate.type) ?? null;
}

function collectCandidateTypesFromSdp(description: RTCSessionDescription | null) {
  const candidateTypes = new Set<DiagnosticCandidateType>();
  if (!description?.sdp) {
    return candidateTypes;
  }

  for (const match of description.sdp.matchAll(/\btyp\s+(host|srflx|relay)\b/gi)) {
    const candidateType = match[1]?.toLowerCase();
    if (candidateType && diagnosticCandidateTypes.includes(candidateType as DiagnosticCandidateType)) {
      candidateTypes.add(candidateType as DiagnosticCandidateType);
    }
  }

  return candidateTypes;
}

function getCandidateTypes(candidateTypes: Set<DiagnosticCandidateType>) {
  return [...candidateTypes].sort();
}

function toWebRtcSignalingError(role: WebRtcRole, stage: WebRtcStage, error: unknown) {
  if (error instanceof WebRtcSignalingError) {
    return error;
  }

  return new WebRtcSignalingError(role, stage, error);
}

async function runWebRtcStage<T>(
  role: WebRtcRole,
  stage: WebRtcStage,
  operation: () => Promise<T>,
) {
  try {
    return await operation();
  } catch (error) {
    throw toWebRtcSignalingError(role, stage, error);
  }
}

function isCandidatePairStats(stats: RTCStats): stats is CandidatePairStats {
  return stats.type === "candidate-pair";
}

function isCandidateStats(stats: RTCStats | undefined): stats is CandidateStats {
  return stats?.type === "local-candidate" || stats?.type === "remote-candidate";
}

function attachConnectionLogging(
  role: WebRtcRole,
  peerConnection: RTCPeerConnection,
) {
  let selectedCandidatePairId: string | null = null;

  async function logSelectedCandidatePair() {
    try {
      const stats = await peerConnection.getStats();
      const statsById = new Map<string, RTCStats>();
      let selectedPair: CandidatePairStats | undefined;

      for (const report of stats.values()) {
        statsById.set(report.id, report);

        if (
          isCandidatePairStats(report) &&
          (report.selected || (report.nominated && report.state === "succeeded"))
        ) {
          selectedPair = report;
        }
      }

      if (!selectedPair || selectedPair.id === selectedCandidatePairId) {
        return;
      }

      const localCandidate = statsById.get(selectedPair.localCandidateId ?? "");
      const remoteCandidate = statsById.get(selectedPair.remoteCandidateId ?? "");

      selectedCandidatePairId = selectedPair.id;
      logWebRtc(`${role} selected ICE candidate pair`, {
        localCandidateType: isCandidateStats(localCandidate)
          ? localCandidate.candidateType
          : undefined,
        remoteCandidateType: isCandidateStats(remoteCandidate)
          ? remoteCandidate.candidateType
          : undefined,
      });
    } catch (error) {
      logWebRtc(`${role} selected ICE candidate pair unavailable`, {
        reason: error instanceof Error ? error.name : "unknown",
      });
    }
  }

  peerConnection.addEventListener("icegatheringstatechange", () => {
    logWebRtc(`${role} ICE gathering state`, {
      iceGatheringState: peerConnection.iceGatheringState,
    });
  });
  peerConnection.addEventListener("icecandidate", (event) => {
    if (!event.candidate) {
      logWebRtc(`${role} ICE candidate gathering completed`, {});

      return;
    }

    const candidateType = getDiagnosticCandidateType(event.candidate);
    if (candidateType) {
      logWebRtc(`${role} ICE candidate gathered`, { candidateType });
    }
  });
  peerConnection.addEventListener("connectionstatechange", () => {
    logWebRtc(`${role} connection state`, {
      connectionState: peerConnection.connectionState,
    });

    if (peerConnection.connectionState === "connected") {
      void logSelectedCandidatePair();
    }
  });
  peerConnection.addEventListener("iceconnectionstatechange", () => {
    logWebRtc(`${role} ICE connection state`, {
      iceConnectionState: peerConnection.iceConnectionState,
    });

    if (
      peerConnection.iceConnectionState === "connected" ||
      peerConnection.iceConnectionState === "completed"
    ) {
      void logSelectedCandidatePair();
    }
  });
}

function toSessionDescription(description: RTCSessionDescription): MediaSessionDescription {
  if (
    !description.sdp ||
    (description.type !== "offer" && description.type !== "answer")
  ) {
    throw new Error("WebRTC did not produce a usable session description.");
  }

  return { type: description.type, sdp: description.sdp };
}

function getMediaTracks(stream: MediaStream): MediaTracks {
  const tracks: MediaTracks = {
    video: stream.getVideoTracks(),
    audio: stream.getAudioTracks(),
  };

  if (tracks.video.length === 0) {
    throw new Error("The selected screen does not contain a video track.");
  }

  return tracks;
}

interface IceGatheringResult {
  outcome: "complete" | "timeout";
  candidateTypes: DiagnosticCandidateType[];
}

function waitForIceGatheringComplete(
  peerConnection: RTCPeerConnection,
  signal?: AbortSignal,
) {
  const candidateTypes = collectCandidateTypesFromSdp(peerConnection.localDescription);
  if (peerConnection.iceGatheringState === "complete") {
    return Promise.resolve<IceGatheringResult>({
      outcome: "complete",
      candidateTypes: getCandidateTypes(candidateTypes),
    });
  }

  return new Promise<IceGatheringResult>((resolve, reject) => {
    let isSettled = false;
    let timeout: number | null = null;

    function cleanup() {
      if (timeout !== null) {
        window.clearTimeout(timeout);
      }
      peerConnection.removeEventListener("icecandidate", onCandidate);
      peerConnection.removeEventListener("icegatheringstatechange", onStateChange);
      signal?.removeEventListener("abort", onAbort);
    }

    function finish(outcome: IceGatheringResult["outcome"]) {
      if (isSettled) {
        return;
      }

      isSettled = true;
      cleanup();
      for (const candidateType of collectCandidateTypesFromSdp(peerConnection.localDescription)) {
        candidateTypes.add(candidateType);
      }

      resolve({ outcome, candidateTypes: getCandidateTypes(candidateTypes) });
    }

    function onAbort() {
      if (isSettled) {
        return;
      }

      isSettled = true;
      cleanup();
      reject(new DOMException("The viewer connection was cancelled.", "AbortError"));
    }

    function onCandidate(event: RTCPeerConnectionIceEvent) {
      if (!event.candidate) {
        return;
      }

      const candidateType = getDiagnosticCandidateType(event.candidate);
      if (candidateType) {
        candidateTypes.add(candidateType);
      }
    }

    function onStateChange() {
      if (peerConnection.iceGatheringState === "complete") {
        finish("complete");
      }
    }

    peerConnection.addEventListener("icecandidate", onCandidate);
    peerConnection.addEventListener("icegatheringstatechange", onStateChange);
    signal?.addEventListener("abort", onAbort, { once: true });
    timeout = window.setTimeout(() => finish("timeout"), ICE_GATHERING_TIMEOUT_MS);

    if (signal?.aborted) {
      onAbort();

      return;
    }
    if (peerConnection.iceGatheringState === "complete") {
      finish("complete");
    }
  });
}

async function createOffer(
  peerConnection: RTCPeerConnection,
  role: WebRtcRole,
  signal?: AbortSignal,
) {
  logWebRtc(`${role} createOffer started`, {});
  const offer = await runWebRtcStage(role, "create-offer", () => peerConnection.createOffer());
  logWebRtc(`${role} createOffer completed`, {});

  await runWebRtcStage(role, "set-local-description", () => peerConnection.setLocalDescription(offer));
  logWebRtc(`${role} setLocalDescription completed`, {});

  const iceGathering = await runWebRtcStage(role, "ice-gathering", () =>
    waitForIceGatheringComplete(peerConnection, signal),
  );
  if (iceGathering.outcome === "timeout") {
    logWebRtc(`${role} ICE gathering timeout`, {
      candidateTypes: iceGathering.candidateTypes,
    });
    if (iceGathering.candidateTypes.length === 0) {
      throw new WebRtcSignalingError(
        role,
        "ice-gathering-timeout",
        new Error("ICE gathering timed out before any usable candidates were collected."),
      );
    }
  } else {
    logWebRtc(`${role} ICE gathering complete`, {
      candidateTypes: iceGathering.candidateTypes,
    });
  }

  if (!peerConnection.localDescription) {
    throw new WebRtcSignalingError(
      role,
      "local-description",
      new Error("WebRTC local description is unavailable."),
    );
  }

  try {
    return toSessionDescription(peerConnection.localDescription);
  } catch (error) {
    throw toWebRtcSignalingError(role, "local-description", error);
  }
}

export async function createPublisher(
  roomId: string,
  stream: MediaStream,
): Promise<PublisherConnection> {
  const peerConnection = new RTCPeerConnection(browserIceConfiguration);

  try {
    const tracks = getMediaTracks(stream);
    attachConnectionLogging("host", peerConnection);
    logWebRtc("host publisher creating", {
      roomId,
      videoTracks: tracks.video.map((track) => track.id),
      audioTracks: tracks.audio.map((track) => track.id),
    });
    if (tracks.video.length !== 1 || tracks.audio.length > 1) {
      throw new Error(
        "Screen sharing requires exactly one video track and at most one audio track.",
      );
    }

    // Keep the publisher SDP topology stable for the lifetime of this
    // PeerConnection: one video m-line and one audio m-line are negotiated
    // even when the selected source currently has no audio.
    //
    // This lets source switching use RTCRtpSender.replaceTrack() for:
    //   video + audio -> video only   (audio sender -> null)
    //   video only    -> video + audio (null -> audio track)
    //
    // No publisher renegotiation is needed merely because source audio
    // appears or disappears.
    const videoTransceiver = peerConnection.addTransceiver("video", {
      direction: "sendonly",
    });
    const audioTransceiver = peerConnection.addTransceiver("audio", {
      direction: "sendonly",
    });

    await Promise.all([
      videoTransceiver.sender.replaceTrack(tracks.video[0]),
      audioTransceiver.sender.replaceTrack(tracks.audio[0] ?? null),
    ]);

    const senders: Record<MediaKind, RTCRtpSender[]> = {
      video: [videoTransceiver.sender],
      audio: [audioTransceiver.sender],
    };
    let isPaused = false;

    const offer = await createOffer(peerConnection, "host");
    const answer = await publishRoomMedia(roomId, offer);

    await peerConnection.setRemoteDescription(answer);
    logWebRtc("host publisher answer applied", { roomId });

    return {
      async replaceTracks(nextStream) {
        const nextTracks = getMediaTracks(nextStream);

        if (nextTracks.video.length !== 1 || nextTracks.audio.length > 1) {
          throw new Error(
            "The selected source has an unsupported media track layout.",
          );
        }

        const videoSender = senders.video[0];
        const audioSender = senders.audio[0];

        if (!videoSender || !audioSender) {
          throw new Error("The publisher media senders are unavailable.");
        }

        const nextVideoTrack = nextTracks.video[0];
        const nextAudioTrack = nextTracks.audio[0] ?? null;

        logWebRtc("host publisher replacing media tracks", {
          videoTracks: [nextVideoTrack.id],
          audioTracks: nextAudioTrack ? [nextAudioTrack.id] : [],
          audioMode: nextAudioTrack ? "source" : "none",
        });

        await Promise.all([
          videoSender.replaceTrack(nextVideoTrack),
          audioSender.replaceTrack(nextAudioTrack),
        ]);

        // setPaused() skips senders that currently have no track. If a source
        // switch attaches a new audio track while the room is paused, apply
        // the existing pause state to that newly active sender immediately.
        if (isPaused) {
          const activeSenders = [videoSender, audioSender].filter(
            (sender) => sender.track !== null,
          );

          await Promise.all(
            activeSenders.map(async (sender) => {
              const parameters = sender.getParameters();

              if (parameters.encodings.length === 0) {
                throw new Error(
                  "The media sender does not expose encoding parameters.",
                );
              }

              for (const encoding of parameters.encodings) {
                encoding.active = false;
              }

              await sender.setParameters(parameters);
            }),
          );
        }
      },
      async setBitrate(maxBitrate) {
        if (senders.video.length === 0) {
          throw new Error("No active video sender is available.");
        }

        await Promise.all(
          senders.video.map(async (sender) => {
            const parameters = sender.getParameters();

            if (parameters.encodings.length === 0) {
              throw new Error("The video sender does not expose encoding parameters.");
            }

            for (const encoding of parameters.encodings) {
              encoding.maxBitrate = maxBitrate ?? undefined;
            }

            await sender.setParameters(parameters);
          }),
        );

        logWebRtc("host publisher bitrate updated", {
          roomId,
          maxBitrate,
        });
      },
      async setPaused(paused) {
        isPaused = paused;

        // A fixed audio sender can intentionally have track=null for a
        // source without shared audio. Do not treat that as an error.
        const activeSenders = mediaKinds
          .flatMap((kind) => senders[kind])
          .filter((sender) => sender.track !== null);

        await Promise.all(
          activeSenders.map(async (sender) => {
            const parameters = sender.getParameters();

            if (parameters.encodings.length === 0) {
              throw new Error("The media sender does not expose encoding parameters.");
            }

            for (const encoding of parameters.encodings) {
              encoding.active = !paused;
            }

            await sender.setParameters(parameters);
          }),
        );

        logWebRtc("host publisher stream pause updated", {
          roomId,
          paused,
          senderCount: activeSenders.length,
          hasAudioTrack: senders.audio[0]?.track !== null,
        });
      },
      close() {
        peerConnection.close();
      },
    };
  } catch (error) {
    peerConnection.close();
    throw error;
  }
}

export async function createSubscriber(
  roomId: string,
  callbacks: SubscriberCallbacks,
  signal?: AbortSignal,
): Promise<SubscriberConnection> {
  const remoteStream = new MediaStream();
  let peerConnection: RTCPeerConnection | null = null;

  try {
    try {
      peerConnection = new RTCPeerConnection(browserIceConfiguration);
    } catch (error) {
      throw toWebRtcSignalingError("viewer", "peer-connection-create", error);
    }
    if (!peerConnection) {
      throw new WebRtcSignalingError(
        "viewer",
        "peer-connection-create",
        new Error("WebRTC peer connection is unavailable."),
      );
    }
    const subscriberPeerConnection = peerConnection;

    attachConnectionLogging("viewer", subscriberPeerConnection);
    logWebRtc("viewer peer connection created", { roomId });
    await runWebRtcStage("viewer", "subscriber-setup", async () => {
      subscriberPeerConnection.addTransceiver("video", { direction: "recvonly" });
      subscriberPeerConnection.addTransceiver("audio", { direction: "recvonly" });
    });
    subscriberPeerConnection.addEventListener("connectionstatechange", () => {
      callbacks.onConnectionStateChange(subscriberPeerConnection.connectionState);
    });
    subscriberPeerConnection.addEventListener("track", (event) => {
      if (!remoteStream.getTracks().some((track) => track.id === event.track.id)) {
        remoteStream.addTrack(event.track);
      }

      logWebRtc("viewer received remote track", {
        kind: event.track.kind,
        trackId: event.track.id,
        muted: event.track.muted,
        readyState: event.track.readyState,
        streamId: event.streams[0]?.id ?? remoteStream.id,
      });
      event.track.addEventListener("mute", () => {
        logWebRtc("viewer remote track muted", { trackId: event.track.id });
      });
      event.track.addEventListener("unmute", () => {
        logWebRtc("viewer remote track unmuted", { trackId: event.track.id });
      });
      event.track.addEventListener("ended", () => {
        logWebRtc("viewer remote track ended", { trackId: event.track.id });
      });

      callbacks.onTrack(new MediaStream(remoteStream.getTracks()));
    });

    const offer = await createOffer(subscriberPeerConnection, "viewer", signal);
    logWebRtc("viewer subscribe request started", { roomId });
    const answer = await runWebRtcStage("viewer", "subscribe-request", () =>
      subscribeRoomMedia(roomId, offer, {
        signal,
        onResponse(status) {
          logWebRtc("viewer subscribe HTTP status", { roomId, status });
        },
      }),
    );

    await runWebRtcStage("viewer", "set-remote-description", () =>
      subscriberPeerConnection.setRemoteDescription(answer),
    );
    logWebRtc("viewer remote description applied", { roomId });

    return {
      close() {
        subscriberPeerConnection.close();
      },
    };
  } catch (error) {
    peerConnection?.close();
    const signalingError = toWebRtcSignalingError("viewer", "subscriber-setup", error);
    logWebRtc("viewer subscriber signaling failed", {
      roomId,
      stage: signalingError.diagnostic.stage,
      reason: signalingError.diagnostic.reason,
    });
    throw signalingError;
  }
}