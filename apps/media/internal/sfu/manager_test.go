package sfu

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/pion/webrtc/v4"
)

func TestManagerCloseRoomRemovesState(t *testing.T) {
	manager := NewManager()
	room := manager.getOrCreateRoom("kenny")

	manager.CloseRoom("kenny")

	manager.mu.Lock()
	_, exists := manager.rooms["kenny"]
	manager.mu.Unlock()
	if exists {
		t.Fatal("expected room to be removed")
	}

	room.mu.Lock()
	closed := room.closed
	room.mu.Unlock()
	if !closed {
		t.Fatal("expected room peer state to be closed")
	}
}

func TestSubscribeRequiresPublisher(t *testing.T) {
	manager := NewManager()

	_, err := manager.Subscribe(context.Background(), "kenny", webrtc.SessionDescription{})
	if !errors.Is(err, ErrPublisherUnavailable) {
		t.Fatalf("expected ErrPublisherUnavailable, got %v", err)
	}
}

func TestReadyTracksIncludesAudioWithVideo(t *testing.T) {
	room := NewRoom(nil)
	publisher := &webrtc.PeerConnection{}
	room.publisher = publisher
	room.forwardTracks[webrtc.RTPCodecTypeVideo] = []*forwardTrack{{
		kind: webrtc.RTPCodecTypeVideo,
	}}
	room.forwardTracks[webrtc.RTPCodecTypeAudio] = []*forwardTrack{{
		kind: webrtc.RTPCodecTypeAudio,
	}}

	tracks, actualPublisher, _, err := room.readyTracks()
	if err != nil {
		t.Fatalf("expected ready tracks, got %v", err)
	}
	if actualPublisher != publisher {
		t.Fatal("expected the current publisher")
	}
	if len(tracks) != 2 {
		t.Fatalf("expected video and audio tracks, got %d", len(tracks))
	}
	if tracks[0].kind != webrtc.RTPCodecTypeVideo || tracks[1].kind != webrtc.RTPCodecTypeAudio {
		t.Fatalf("expected video then audio tracks, got %s then %s", tracks[0].kind, tracks[1].kind)
	}
}

func TestVideoOnlyPublisherAcceptsAudioCapableViewerOffer(t *testing.T) {
	room := NewRoom(nil)
	publisher, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create publisher peer connection: %v", err)
	}
	defer closePeerConnection(publisher)

	videoTrack, err := webrtc.NewTrackLocalStaticRTP(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8},
		"screen-video",
		"screen-share",
	)
	if err != nil {
		t.Fatalf("create video track: %v", err)
	}

	room.publisher = publisher
	room.forwardTracks[webrtc.RTPCodecTypeVideo] = []*forwardTrack{{
		kind:  webrtc.RTPCodecTypeVideo,
		local: videoTrack,
	}}

	viewer, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create viewer peer connection: %v", err)
	}
	defer closePeerConnection(viewer)

	for _, kind := range []webrtc.RTPCodecType{
		webrtc.RTPCodecTypeVideo,
		webrtc.RTPCodecTypeAudio,
	} {
		if _, err := viewer.AddTransceiverFromKind(kind, webrtc.RTPTransceiverInit{
			Direction: webrtc.RTPTransceiverDirectionRecvonly,
		}); err != nil {
			t.Fatalf("add %s recvonly transceiver: %v", kind, err)
		}
	}

	offer, err := viewer.CreateOffer(nil)
	if err != nil {
		t.Fatalf("create viewer offer: %v", err)
	}

	answer, err := room.Subscribe(context.Background(), offer)
	if err != nil {
		t.Fatalf("subscribe video-only publisher to audio-capable viewer: %v", err)
	}
	if answer.Type != webrtc.SDPTypeAnswer || !strings.Contains(answer.SDP, "m=video") {
		t.Fatal("expected a video SDP answer")
	}
}

func TestVideoAndAudioPublisherAcceptsAudioCapableViewerOffer(t *testing.T) {
	room := NewRoom(nil)
	publisher, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create publisher peer connection: %v", err)
	}
	defer closePeerConnection(publisher)

	videoTrack, err := webrtc.NewTrackLocalStaticRTP(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8},
		"screen-video",
		"screen-share",
	)
	if err != nil {
		t.Fatalf("create video track: %v", err)
	}
	audioTrack, err := webrtc.NewTrackLocalStaticRTP(
		webrtc.RTPCodecCapability{
			MimeType:  webrtc.MimeTypeOpus,
			ClockRate: 48_000,
			Channels:  2,
		},
		"screen-audio",
		"screen-share",
	)
	if err != nil {
		t.Fatalf("create audio track: %v", err)
	}

	room.publisher = publisher
	room.forwardTracks[webrtc.RTPCodecTypeVideo] = []*forwardTrack{{
		kind:  webrtc.RTPCodecTypeVideo,
		local: videoTrack,
	}}
	room.forwardTracks[webrtc.RTPCodecTypeAudio] = []*forwardTrack{{
		kind:  webrtc.RTPCodecTypeAudio,
		local: audioTrack,
	}}

	viewer, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create viewer peer connection: %v", err)
	}
	defer closePeerConnection(viewer)

	for _, kind := range []webrtc.RTPCodecType{
		webrtc.RTPCodecTypeVideo,
		webrtc.RTPCodecTypeAudio,
	} {
		if _, err := viewer.AddTransceiverFromKind(kind, webrtc.RTPTransceiverInit{
			Direction: webrtc.RTPTransceiverDirectionRecvonly,
		}); err != nil {
			t.Fatalf("add %s recvonly transceiver: %v", kind, err)
		}
	}

	offer, err := viewer.CreateOffer(nil)
	if err != nil {
		t.Fatalf("create viewer offer: %v", err)
	}

	answer, err := room.Subscribe(context.Background(), offer)
	if err != nil {
		t.Fatalf("subscribe video-and-audio publisher to audio-capable viewer: %v", err)
	}
	if answer.Type != webrtc.SDPTypeAnswer ||
		!strings.Contains(answer.SDP, "m=video") ||
		!strings.Contains(answer.SDP, "m=audio") {
		t.Fatal("expected a video and audio SDP answer")
	}
}
