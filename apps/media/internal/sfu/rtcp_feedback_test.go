package sfu

import (
	"errors"
	"strings"
	"testing"

	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"
)

type recordingRTCPWriter struct {
	packets []rtcp.Packet
	err     error
}

func (writer *recordingRTCPWriter) WriteRTCP(packets []rtcp.Packet) error {
	if writer.err != nil {
		return writer.err
	}

	writer.packets = append(writer.packets, packets...)
	return nil
}

func TestRouteViewerRTCPFeedbackRequestsKeyframeForPublisherSSRC(t *testing.T) {
	testCases := []struct {
		name    string
		packets []rtcp.Packet
	}{
		{
			name: "PLI",
			packets: []rtcp.Packet{
				&rtcp.PictureLossIndication{MediaSSRC: 222},
			},
		},
		{
			name: "FIR",
			packets: []rtcp.Packet{
				&rtcp.FullIntraRequest{
					MediaSSRC: 222,
					FIR:       []rtcp.FIREntry{{SSRC: 222, SequenceNumber: 1}},
				},
			},
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			writer := &recordingRTCPWriter{}
			feedback, requested, err := routeViewerRTCPFeedback(
				writer,
				&forwardTrack{
					kind:          webrtc.RTPCodecTypeVideo,
					publisherSSRC: 777,
				},
				testCase.packets,
			)
			if err != nil {
				t.Fatalf("route viewer RTCP feedback: %v", err)
			}
			if !requested {
				t.Fatal("expected an upstream keyframe request")
			}
			if len(writer.packets) != 1 {
				t.Fatalf("expected one upstream RTCP packet, got %d", len(writer.packets))
			}

			pli, ok := writer.packets[0].(*rtcp.PictureLossIndication)
			if !ok {
				t.Fatalf("expected upstream PLI, got %T", writer.packets[0])
			}
			if pli.MediaSSRC != 777 {
				t.Fatalf("expected publisher SSRC 777, got %d", pli.MediaSSRC)
			}
			if !feedback.requestsKeyframe() {
				t.Fatal("expected feedback to request a keyframe")
			}
		})
	}
}

func TestRouteViewerRTCPFeedbackLeavesNACKForDownstreamResponder(t *testing.T) {
	writer := &recordingRTCPWriter{}
	feedback, requested, err := routeViewerRTCPFeedback(
		writer,
		&forwardTrack{kind: webrtc.RTPCodecTypeVideo, publisherSSRC: 777},
		[]rtcp.Packet{
			&rtcp.TransportLayerNack{
				MediaSSRC: 222,
				Nacks: []rtcp.NackPair{{
					PacketID:    10,
					LostPackets: 0b11,
				}},
			},
			&rtcp.ReceiverReport{},
		},
	)
	if err != nil {
		t.Fatalf("route viewer RTCP feedback: %v", err)
	}
	if requested || len(writer.packets) != 0 {
		t.Fatal("expected downstream NACK not to be forwarded upstream")
	}
	if feedback.nackPackets != 1 || feedback.nackSequenceRequests != 3 {
		t.Fatalf("expected one NACK with three requested sequences, got packets=%d sequences=%d", feedback.nackPackets, feedback.nackSequenceRequests)
	}
}

func TestRouteViewerRTCPFeedbackDoesNotRequestKeyframeForAudio(t *testing.T) {
	writer := &recordingRTCPWriter{}
	_, requested, err := routeViewerRTCPFeedback(
		writer,
		&forwardTrack{kind: webrtc.RTPCodecTypeAudio, publisherSSRC: 777},
		[]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: 222}},
	)
	if err != nil {
		t.Fatalf("route viewer RTCP feedback: %v", err)
	}
	if requested || len(writer.packets) != 0 {
		t.Fatal("expected audio feedback not to request a video keyframe")
	}
}

func TestRouteViewerRTCPFeedbackPropagatesUpstreamWriteErrors(t *testing.T) {
	writer := &recordingRTCPWriter{err: errors.New("publisher is closed")}
	_, requested, err := routeViewerRTCPFeedback(
		writer,
		&forwardTrack{kind: webrtc.RTPCodecTypeVideo, publisherSSRC: 777},
		[]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: 222}},
	)
	if requested {
		t.Fatal("expected no successful keyframe request")
	}
	if err == nil || !strings.Contains(err.Error(), "publisher is closed") {
		t.Fatalf("expected upstream write error, got %v", err)
	}
}

func TestDefaultPeerConnectionFactoryAdvertisesVP8NACKFeedback(t *testing.T) {
	factory, err := newPeerConnectionFactory(ICEConfig{})
	if err != nil {
		t.Fatalf("create peer connection factory: %v", err)
	}
	peerConnection, err := factory.newPeerConnection()
	if err != nil {
		t.Fatalf("create peer connection: %v", err)
	}
	defer closePeerConnection(peerConnection)

	track, err := webrtc.NewTrackLocalStaticRTP(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8},
		"screen-video",
		"screen-share",
	)
	if err != nil {
		t.Fatalf("create video track: %v", err)
	}
	sender, err := peerConnection.AddTrack(track)
	if err != nil {
		t.Fatalf("add video track: %v", err)
	}

	for _, codec := range sender.GetParameters().Codecs {
		if !strings.EqualFold(codec.MimeType, webrtc.MimeTypeVP8) {
			continue
		}
		if hasRTCPFeedback(codec.RTCPFeedback, "nack", "") && hasRTCPFeedback(codec.RTCPFeedback, "nack", "pli") {
			return
		}
	}

	t.Fatal("expected the default Pion factory to advertise VP8 nack and nack pli feedback")
}

func hasRTCPFeedback(feedback []webrtc.RTCPFeedback, feedbackType, parameter string) bool {
	for _, value := range feedback {
		if value.Type == feedbackType && value.Parameter == parameter {
			return true
		}
	}

	return false
}
