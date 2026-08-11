package sfu

import (
	"log"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"
)

const viewerNACKDiagnosticInterval = 5 * time.Second

type rtcpWriter interface {
	WriteRTCP([]rtcp.Packet) error
}

type viewerRTCPFeedback struct {
	pictureLossIndications int
	fullIntraRequests      int
	nackPackets            int
	nackSequenceRequests   int
}

func (feedback viewerRTCPFeedback) requestsKeyframe() bool {
	return feedback.pictureLossIndications > 0 || feedback.fullIntraRequests > 0
}

type viewerRTCPDiagnostics struct {
	lastNACKLog          time.Time
	pendingNACKPackets   int
	pendingNACKSequences int
}

func (r *Room) readViewerRTCP(
	sender *webrtc.RTPSender,
	publisher *webrtc.PeerConnection,
	publisherTrack *forwardTrack,
) {
	diagnosticsEnabled := r.peerConnectionFactory != nil && r.peerConnectionFactory.diagnostics
	diagnostics := viewerRTCPDiagnostics{}

	for {
		packets, _, err := sender.ReadRTCP()
		if err != nil {
			if diagnosticsEnabled {
				diagnostics.flushNACK(publisherTrack)
				log.Printf("media viewer RTCP read loop exited: kind=%s publisher_ssrc=%d error=%v", publisherTrack.kind, publisherTrack.publisherSSRC, err)
			}
			return
		}

		feedback, keyframeRequested, routeErr := routeViewerRTCPFeedback(publisher, publisherTrack, packets)
		if diagnosticsEnabled {
			diagnostics.logFeedback(publisherTrack, feedback)
		}
		if routeErr != nil {
			log.Printf(
				"media upstream PLI request failed: publisher_ssrc=%d error=%v",
				publisherTrack.publisherSSRC,
				routeErr,
			)
			continue
		}
		if keyframeRequested && diagnosticsEnabled {
			log.Printf("media upstream PLI keyframe request sent: publisher_ssrc=%d", publisherTrack.publisherSSRC)
		}
	}
}

func (r *Room) requestKeyframes(publisher *webrtc.PeerConnection, forwardTracks []*forwardTrack) {
	for _, publisherTrack := range forwardTracks {
		if publisherTrack.kind != webrtc.RTPCodecTypeVideo {
			continue
		}

		keyframeRequested, err := requestPublisherKeyframe(publisher, publisherTrack)
		if err != nil {
			log.Printf(
				"media initial upstream PLI request failed: publisher_ssrc=%d error=%v",
				publisherTrack.publisherSSRC,
				err,
			)
			continue
		}
		if keyframeRequested && r.peerConnectionFactory.diagnostics {
			log.Printf("media initial upstream PLI keyframe request sent: publisher_ssrc=%d", publisherTrack.publisherSSRC)
		}
	}
}

func routeViewerRTCPFeedback(
	publisher rtcpWriter,
	publisherTrack *forwardTrack,
	packets []rtcp.Packet,
) (viewerRTCPFeedback, bool, error) {
	feedback := collectViewerRTCPFeedback(packets)
	if !feedback.requestsKeyframe() || publisherTrack == nil || publisherTrack.kind != webrtc.RTPCodecTypeVideo {
		return feedback, false, nil
	}

	keyframeRequested, err := requestPublisherKeyframe(publisher, publisherTrack)
	return feedback, keyframeRequested, err
}

func requestPublisherKeyframe(publisher rtcpWriter, publisherTrack *forwardTrack) (bool, error) {
	if publisher == nil || publisherTrack == nil || publisherTrack.publisherSSRC == 0 {
		return false, nil
	}

	if err := publisher.WriteRTCP([]rtcp.Packet{
		&rtcp.PictureLossIndication{MediaSSRC: uint32(publisherTrack.publisherSSRC)},
	}); err != nil {
		return false, err
	}

	return true, nil
}

func collectViewerRTCPFeedback(packets []rtcp.Packet) viewerRTCPFeedback {
	feedback := viewerRTCPFeedback{}
	for _, packet := range packets {
		switch typedPacket := packet.(type) {
		case *rtcp.PictureLossIndication:
			feedback.pictureLossIndications++
		case *rtcp.FullIntraRequest:
			feedback.fullIntraRequests++
		case *rtcp.TransportLayerNack:
			feedback.nackPackets++
			for index := range typedPacket.Nacks {
				typedPacket.Nacks[index].Range(func(uint16) bool {
					feedback.nackSequenceRequests++
					return true
				})
			}
		}
	}

	return feedback
}

func (diagnostics *viewerRTCPDiagnostics) logFeedback(
	publisherTrack *forwardTrack,
	feedback viewerRTCPFeedback,
) {
	if feedback.pictureLossIndications > 0 {
		log.Printf(
			"media viewer RTCP PLI received: kind=%s publisher_ssrc=%d count=%d",
			publisherTrack.kind,
			publisherTrack.publisherSSRC,
			feedback.pictureLossIndications,
		)
	}
	if feedback.fullIntraRequests > 0 {
		log.Printf(
			"media viewer RTCP FIR received: kind=%s publisher_ssrc=%d count=%d",
			publisherTrack.kind,
			publisherTrack.publisherSSRC,
			feedback.fullIntraRequests,
		)
	}
	if feedback.nackPackets == 0 {
		return
	}

	diagnostics.pendingNACKPackets += feedback.nackPackets
	diagnostics.pendingNACKSequences += feedback.nackSequenceRequests
	if diagnostics.lastNACKLog.IsZero() || time.Since(diagnostics.lastNACKLog) >= viewerNACKDiagnosticInterval {
		diagnostics.flushNACK(publisherTrack)
	}
}

func (diagnostics *viewerRTCPDiagnostics) flushNACK(publisherTrack *forwardTrack) {
	if diagnostics.pendingNACKPackets == 0 {
		return
	}

	log.Printf(
		"media viewer RTCP NACK received: kind=%s publisher_ssrc=%d packets=%d sequence_requests=%d",
		publisherTrack.kind,
		publisherTrack.publisherSSRC,
		diagnostics.pendingNACKPackets,
		diagnostics.pendingNACKSequences,
	)
	diagnostics.lastNACKLog = time.Now()
	diagnostics.pendingNACKPackets = 0
	diagnostics.pendingNACKSequences = 0
}
