package sfu

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"

	"github.com/pion/webrtc/v4"
)

var ErrPublisherUnavailable = errors.New("publisher video track is unavailable")
var ErrRoomClosed = errors.New("media room is closed")

const rtpPacketLogInterval = 300

type forwardTrack struct {
	kind          webrtc.RTPCodecType
	local         *webrtc.TrackLocalStaticRTP
	remote        *webrtc.TrackRemote
	publisherSSRC webrtc.SSRC
}

type Room struct {
	mu                    sync.Mutex
	peerConnectionFactory *peerConnectionFactory
	publisher             *webrtc.PeerConnection
	forwardTracks         map[webrtc.RTPCodecType][]*forwardTrack
	trackVersion          uint64
	viewers               map[*webrtc.PeerConnection]struct{}
	closed                bool
	onPublisherClosed     func()
}

func NewRoom(onPublisherClosed func()) *Room {
	peerConnectionFactory, err := newPeerConnectionFactory(ICEConfig{})
	if err != nil {
		panic(err)
	}

	return newRoom(peerConnectionFactory, onPublisherClosed)
}

func newRoom(peerConnectionFactory *peerConnectionFactory, onPublisherClosed func()) *Room {
	return &Room{
		peerConnectionFactory: peerConnectionFactory,
		forwardTracks:         make(map[webrtc.RTPCodecType][]*forwardTrack),
		viewers:               make(map[*webrtc.PeerConnection]struct{}),
		onPublisherClosed:     onPublisherClosed,
	}
}

func (r *Room) Publish(ctx context.Context, offer webrtc.SessionDescription) (webrtc.SessionDescription, error) {
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return webrtc.SessionDescription{}, ErrRoomClosed
	}

	previousPublisher := r.publisher
	previousViewers := r.takeViewersLocked()
	r.publisher = nil
	r.forwardTracks = make(map[webrtc.RTPCodecType][]*forwardTrack)
	r.trackVersion++
	r.mu.Unlock()

	closePeerConnection(previousPublisher)
	closePeerConnections(previousViewers)

	peerConnection, err := r.peerConnectionFactory.newPeerConnection()
	if err != nil {
		return webrtc.SessionDescription{}, err
	}

	peerConnection.OnTrack(func(track *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		if track.Kind() != webrtc.RTPCodecTypeVideo && track.Kind() != webrtc.RTPCodecTypeAudio {
			return
		}

		r.acceptPublisherTrack(peerConnection, track)
	})
	peerConnection.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		log.Printf("media publisher peer connection state: %s", state)
		if state == webrtc.PeerConnectionStateFailed || state == webrtc.PeerConnectionStateClosed {
			r.removePublisher(peerConnection)
		}
	})
	peerConnection.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		log.Printf("media publisher ICE state: %s", state)
		if state == webrtc.ICEConnectionStateConnected || state == webrtc.ICEConnectionStateCompleted {
			logSelectedCandidatePair("publisher", peerConnection, r.peerConnectionFactory.diagnostics)
		}
	})
	attachICEDiagnostics("publisher", peerConnection, r.peerConnectionFactory.diagnostics)

	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		closePeerConnection(peerConnection)
		return webrtc.SessionDescription{}, ErrRoomClosed
	}
	r.publisher = peerConnection
	r.mu.Unlock()

	answer, err := createAnswer(ctx, peerConnection, offer)
	if err != nil {
		r.removePublisher(peerConnection)
		closePeerConnection(peerConnection)
		return webrtc.SessionDescription{}, err
	}

	r.mu.Lock()
	if r.closed || r.publisher != peerConnection {
		r.mu.Unlock()
		closePeerConnection(peerConnection)
		return webrtc.SessionDescription{}, ErrRoomClosed
	}
	r.mu.Unlock()
	log.Printf("media publisher signaling completed")

	return answer, nil
}

func (r *Room) Subscribe(ctx context.Context, offer webrtc.SessionDescription) (webrtc.SessionDescription, error) {
	forwardTracks, publisher, trackVersion, err := r.readyTracks()
	if err != nil {
		return webrtc.SessionDescription{}, err
	}
	log.Printf("media viewer peer connection creating: tracks=%d", len(forwardTracks))

	peerConnection, err := r.peerConnectionFactory.newPeerConnection()
	if err != nil {
		return webrtc.SessionDescription{}, err
	}

	for _, forwardTrack := range forwardTracks {
		sender, addTrackErr := peerConnection.AddTrack(forwardTrack.local)
		if addTrackErr != nil {
			closePeerConnection(peerConnection)
			return webrtc.SessionDescription{}, addTrackErr
		}
		log.Printf(
			"media viewer track added: kind=%s codec=%s",
			forwardTrack.kind,
			forwardTrack.local.Codec().MimeType,
		)
		go r.readViewerRTCP(sender, publisher, forwardTrack)
	}
	peerConnection.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		log.Printf("media viewer peer connection state: %s", state)
		if state == webrtc.PeerConnectionStateConnected {
			r.requestKeyframes(publisher, forwardTracks)
		}
		if state == webrtc.PeerConnectionStateFailed || state == webrtc.PeerConnectionStateClosed {
			r.removeViewer(peerConnection)
		}
	})
	peerConnection.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		log.Printf("media viewer ICE state: %s", state)
		if state == webrtc.ICEConnectionStateConnected || state == webrtc.ICEConnectionStateCompleted {
			logSelectedCandidatePair("viewer", peerConnection, r.peerConnectionFactory.diagnostics)
		}
	})
	attachICEDiagnostics("viewer", peerConnection, r.peerConnectionFactory.diagnostics)

	answer, err := createAnswer(ctx, peerConnection, offer)
	if err != nil {
		closePeerConnection(peerConnection)
		return webrtc.SessionDescription{}, err
	}

	r.mu.Lock()
	if r.closed || r.publisher != publisher || r.trackVersion != trackVersion {
		r.mu.Unlock()
		closePeerConnection(peerConnection)
		return webrtc.SessionDescription{}, ErrPublisherUnavailable
	}
	r.viewers[peerConnection] = struct{}{}
	r.mu.Unlock()
	log.Printf("media viewer signaling completed")

	return answer, nil
}

func (r *Room) Close() {
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return
	}

	r.closed = true
	publisher := r.publisher
	viewers := r.takeViewersLocked()
	r.publisher = nil
	r.forwardTracks = make(map[webrtc.RTPCodecType][]*forwardTrack)
	r.trackVersion++
	r.mu.Unlock()

	closePeerConnection(publisher)
	closePeerConnections(viewers)
}

func (r *Room) HasPublisher() bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.publisher != nil
}

func (r *Room) acceptPublisherTrack(peerConnection *webrtc.PeerConnection, remoteTrack *webrtc.TrackRemote) {
	codec := remoteTrack.Codec()
	log.Printf(
		"media publisher track received: kind=%s codec=%s payload_type=%d ssrc=%d",
		remoteTrack.Kind(),
		codec.MimeType,
		codec.PayloadType,
		remoteTrack.SSRC(),
	)
	localTrack, err := webrtc.NewTrackLocalStaticRTP(
		codec.RTPCodecCapability,
		fmt.Sprintf("screen-%s-%d", remoteTrack.Kind(), remoteTrack.SSRC()),
		"screen-share",
	)
	if err != nil {
		log.Printf("media publisher track could not be forwarded: %v", err)
		return
	}
	publisherTrack := &forwardTrack{
		kind:          remoteTrack.Kind(),
		local:         localTrack,
		remote:        remoteTrack,
		publisherSSRC: remoteTrack.SSRC(),
	}

	r.mu.Lock()
	if r.closed || r.publisher != peerConnection || r.hasForwardTrackLocked(publisherTrack) {
		r.mu.Unlock()
		return
	}
	r.forwardTracks[publisherTrack.kind] = append(
		r.forwardTracks[publisherTrack.kind],
		publisherTrack,
	)
	r.trackVersion++
	viewers := r.takeViewersLocked()
	r.mu.Unlock()
	log.Printf(
		"media publisher track is ready for viewers: kind=%s codec=%s",
		publisherTrack.kind,
		codec.MimeType,
	)
	if len(viewers) > 0 {
		log.Printf("media reconnecting %d viewers for the updated track set", len(viewers))
		closePeerConnections(viewers)
	}

	go r.forwardRTP(peerConnection, publisherTrack)
}

func (r *Room) removePublisher(peerConnection *webrtc.PeerConnection) {
	r.mu.Lock()
	if r.publisher != peerConnection {
		r.mu.Unlock()
		return
	}

	r.publisher = nil
	r.forwardTracks = make(map[webrtc.RTPCodecType][]*forwardTrack)
	r.trackVersion++
	viewers := r.takeViewersLocked()
	r.mu.Unlock()

	closePeerConnections(viewers)
	if r.onPublisherClosed != nil {
		r.onPublisherClosed()
	}
}

func (r *Room) removeViewer(peerConnection *webrtc.PeerConnection) {
	r.mu.Lock()
	delete(r.viewers, peerConnection)
	r.mu.Unlock()
}

func (r *Room) readyTracks() ([]*forwardTrack, *webrtc.PeerConnection, uint64, error) {
	r.mu.Lock()
	publisher := r.publisher
	trackVersion := r.trackVersion
	closed := r.closed
	videoTracks := append([]*forwardTrack(nil), r.forwardTracks[webrtc.RTPCodecTypeVideo]...)
	audioTracks := append([]*forwardTrack(nil), r.forwardTracks[webrtc.RTPCodecTypeAudio]...)
	r.mu.Unlock()

	if closed {
		return nil, nil, 0, ErrRoomClosed
	}
	if publisher == nil || len(videoTracks) == 0 {
		return nil, nil, 0, ErrPublisherUnavailable
	}

	return append(videoTracks, audioTracks...), publisher, trackVersion, nil
}

func (r *Room) hasForwardTrackLocked(candidate *forwardTrack) bool {
	for _, existing := range r.forwardTracks[candidate.kind] {
		if existing.remote.SSRC() == candidate.remote.SSRC() {
			return true
		}
	}

	return false
}

func (r *Room) takeViewersLocked() []*webrtc.PeerConnection {
	viewers := make([]*webrtc.PeerConnection, 0, len(r.viewers))
	for viewer := range r.viewers {
		viewers = append(viewers, viewer)
	}
	r.viewers = make(map[*webrtc.PeerConnection]struct{})

	return viewers
}

func createAnswer(ctx context.Context, peerConnection *webrtc.PeerConnection, offer webrtc.SessionDescription) (webrtc.SessionDescription, error) {
	if err := peerConnection.SetRemoteDescription(offer); err != nil {
		return webrtc.SessionDescription{}, err
	}

	answer, err := peerConnection.CreateAnswer(nil)
	if err != nil {
		return webrtc.SessionDescription{}, err
	}

	gatheringComplete := webrtc.GatheringCompletePromise(peerConnection)
	if err := peerConnection.SetLocalDescription(answer); err != nil {
		return webrtc.SessionDescription{}, err
	}

	select {
	case <-gatheringComplete:
	case <-ctx.Done():
		return webrtc.SessionDescription{}, ctx.Err()
	}

	localDescription := peerConnection.LocalDescription()
	if localDescription == nil {
		return webrtc.SessionDescription{}, errors.New("media answer is unavailable")
	}

	return *localDescription, nil
}

func (r *Room) forwardRTP(
	publisher *webrtc.PeerConnection,
	publisherTrack *forwardTrack,
) {
	packetCount := 0
	for {
		packet, _, err := publisherTrack.remote.ReadRTP()
		if err != nil {
			log.Printf(
				"media publisher %s RTP read stopped after %d packets: %v",
				publisherTrack.kind,
				packetCount,
				err,
			)
			if !r.removeForwardTrack(publisher, publisherTrack) {
				r.removePublisher(publisher)
				closePeerConnection(publisher)
			}
			return
		}
		packetCount++
		viewerCount := r.viewerCount()
		if packetCount == 1 || packetCount%rtpPacketLogInterval == 0 {
			log.Printf(
				"media publisher %s RTP read: packets=%d viewers=%d",
				publisherTrack.kind,
				packetCount,
				viewerCount,
			)
		}

		if err := publisherTrack.local.WriteRTP(packet); err != nil {
			log.Printf(
				"media viewer %s RTP write failed after %d packets: %v",
				publisherTrack.kind,
				packetCount,
				err,
			)
			r.removeInactiveViewers()
			continue
		}
		if viewerCount > 0 && (packetCount == 1 || packetCount%rtpPacketLogInterval == 0) {
			log.Printf(
				"media viewer %s RTP write accepted: packets=%d viewers=%d",
				publisherTrack.kind,
				packetCount,
				viewerCount,
			)
		}
	}
}

func (r *Room) removeForwardTrack(
	publisher *webrtc.PeerConnection,
	target *forwardTrack,
) bool {
	r.mu.Lock()
	if r.publisher != publisher {
		hasVideo := len(r.forwardTracks[webrtc.RTPCodecTypeVideo]) > 0
		r.mu.Unlock()
		return hasVideo
	}

	tracks := r.forwardTracks[target.kind]
	for index, current := range tracks {
		if current != target {
			continue
		}

		r.forwardTracks[target.kind] = append(tracks[:index], tracks[index+1:]...)
		break
	}
	r.trackVersion++
	viewers := r.takeViewersLocked()
	hasVideo := len(r.forwardTracks[webrtc.RTPCodecTypeVideo]) > 0
	r.mu.Unlock()

	if len(viewers) > 0 {
		log.Printf("media reconnecting %d viewers after a publisher track ended", len(viewers))
		closePeerConnections(viewers)
	}

	return hasVideo
}

func (r *Room) viewerCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()

	return len(r.viewers)
}

func (r *Room) removeInactiveViewers() {
	r.mu.Lock()
	inactiveViewers := make([]*webrtc.PeerConnection, 0)
	for viewer := range r.viewers {
		state := viewer.ConnectionState()
		if state == webrtc.PeerConnectionStateFailed || state == webrtc.PeerConnectionStateClosed {
			delete(r.viewers, viewer)
			inactiveViewers = append(inactiveViewers, viewer)
		}
	}
	r.mu.Unlock()

	if len(inactiveViewers) > 0 {
		log.Printf("media removed %d inactive viewer peer connections", len(inactiveViewers))
		closePeerConnections(inactiveViewers)
	}
}

func closePeerConnection(peerConnection *webrtc.PeerConnection) {
	if peerConnection != nil {
		_ = peerConnection.Close()
	}
}

func closePeerConnections(peerConnections []*webrtc.PeerConnection) {
	for _, peerConnection := range peerConnections {
		closePeerConnection(peerConnection)
	}
}
