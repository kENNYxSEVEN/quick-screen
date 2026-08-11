package sfu

import (
	"log"

	"github.com/pion/webrtc/v4"
)

func attachICEDiagnostics(role string, peerConnection *webrtc.PeerConnection, enabled bool) {
	if !enabled {
		return
	}

	peerConnection.OnICEGatheringStateChange(func(state webrtc.ICEGatheringState) {
		log.Printf("media %s ICE gathering state: %s", role, state)
	})
	peerConnection.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			log.Printf("media %s ICE candidate gathering completed", role)
			return
		}

		log.Printf("media %s ICE candidate gathered: type=%s", role, candidate.Typ)
	})
}

func logSelectedCandidatePair(role string, peerConnection *webrtc.PeerConnection, enabled bool) {
	if !enabled {
		return
	}

	peerConnectionSCTP := peerConnection.SCTP()
	if peerConnectionSCTP == nil {
		return
	}

	candidatePair, err := peerConnectionSCTP.Transport().ICETransport().GetSelectedCandidatePair()
	if err != nil {
		log.Printf("media %s selected ICE candidate pair unavailable: %v", role, err)
		return
	}
	if candidatePair == nil || candidatePair.Local == nil || candidatePair.Remote == nil {
		return
	}

	log.Printf(
		"media %s selected ICE candidate pair: local_type=%s remote_type=%s",
		role,
		candidatePair.Local.Typ,
		candidatePair.Remote.Typ,
	)
}
