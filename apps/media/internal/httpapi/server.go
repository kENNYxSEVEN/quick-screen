package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/ingamers/screen-share/apps/media/internal/sfu"
	"github.com/pion/webrtc/v4"
)

const signalingTimeout = 10 * time.Second

type signalDescription struct {
	Type string `json:"type"`
	SDP  string `json:"sdp"`
}

type signalRequest struct {
	Offer signalDescription `json:"offer"`
}

type signalResponse struct {
	Answer signalDescription `json:"answer"`
}

type errorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

func NewHandler(manager *sfu.Manager) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", health)
	mux.HandleFunc("/rooms/", roomHandler(manager))

	return mux
}

func health(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
}

func roomHandler(manager *sfu.Manager) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		roomID, action, valid := parseRoomPath(request.URL.Path)
		if !valid {
			writeError(writer, http.StatusNotFound, "not_found", "The requested endpoint does not exist.")
			return
		}

		switch {
		case request.Method == http.MethodPost && action == "publish":
			handlePublish(writer, request, manager, roomID)
		case request.Method == http.MethodPost && action == "subscribe":
			handleSubscribe(writer, request, manager, roomID)
		case request.Method == http.MethodDelete && action == "":
			manager.CloseRoom(roomID)
			writer.WriteHeader(http.StatusNoContent)
		default:
			writeError(writer, http.StatusMethodNotAllowed, "method_not_allowed", "This method is not supported.")
		}
	}
}

func handlePublish(writer http.ResponseWriter, request *http.Request, manager *sfu.Manager, roomID string) {
	offer, ok := readOffer(writer, request)
	if !ok {
		return
	}

	contextWithTimeout, cancel := context.WithTimeout(request.Context(), signalingTimeout)
	defer cancel()
	answer, err := manager.Publish(contextWithTimeout, roomID, offer)
	if err != nil {
		writeError(writer, http.StatusBadRequest, "publish_failed", err.Error())
		return
	}

	writeJSON(writer, http.StatusOK, signalResponse{Answer: toSignalDescription(answer)})
}

func handleSubscribe(writer http.ResponseWriter, request *http.Request, manager *sfu.Manager, roomID string) {
	offer, ok := readOffer(writer, request)
	if !ok {
		return
	}

	contextWithTimeout, cancel := context.WithTimeout(request.Context(), signalingTimeout)
	defer cancel()
	answer, err := manager.Subscribe(contextWithTimeout, roomID, offer)
	if err != nil {
		statusCode := http.StatusBadRequest
		errorCode := "subscribe_failed"
		if errors.Is(err, sfu.ErrPublisherUnavailable) {
			statusCode = http.StatusConflict
			errorCode = "publisher_not_ready"
		}
		writeError(writer, statusCode, errorCode, err.Error())
		return
	}

	writeJSON(writer, http.StatusOK, signalResponse{Answer: toSignalDescription(answer)})
}

func readOffer(writer http.ResponseWriter, request *http.Request) (webrtc.SessionDescription, bool) {
	defer request.Body.Close()

	decoder := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 128*1024))
	decoder.DisallowUnknownFields()
	var payload signalRequest
	if err := decoder.Decode(&payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_sdp", "A valid SDP offer is required.")
		return webrtc.SessionDescription{}, false
	}

	if payload.Offer.Type != "offer" || strings.TrimSpace(payload.Offer.SDP) == "" {
		writeError(writer, http.StatusBadRequest, "invalid_sdp", "A valid SDP offer is required.")
		return webrtc.SessionDescription{}, false
	}

	return webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: payload.Offer.SDP}, true
}

func parseRoomPath(path string) (string, string, bool) {
	relativePath := strings.TrimPrefix(path, "/rooms/")
	if relativePath == path || relativePath == "" {
		return "", "", false
	}

	parts := strings.Split(relativePath, "/")
	if len(parts) == 1 && parts[0] != "" {
		return parts[0], "", true
	}
	if len(parts) == 2 && parts[0] != "" && (parts[1] == "publish" || parts[1] == "subscribe") {
		return parts[0], parts[1], true
	}

	return "", "", false
}

func toSignalDescription(description webrtc.SessionDescription) signalDescription {
	return signalDescription{Type: description.Type.String(), SDP: description.SDP}
}

func writeError(writer http.ResponseWriter, statusCode int, code string, message string) {
	writeJSON(writer, statusCode, errorResponse{Error: code, Message: message})
}

func writeJSON(writer http.ResponseWriter, statusCode int, payload any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(statusCode)
	_ = json.NewEncoder(writer).Encode(payload)
}
