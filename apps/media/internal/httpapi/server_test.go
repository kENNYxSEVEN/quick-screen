package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ingamers/screen-share/apps/media/internal/sfu"
)

func TestHealth(t *testing.T) {
	handler := NewHandler(sfu.NewManager())
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, response.Code)
	}
}

func TestSubscribeWithoutPublisherReturnsConflict(t *testing.T) {
	handler := NewHandler(sfu.NewManager())
	request := httptest.NewRequest(
		http.MethodPost,
		"/rooms/kenny/subscribe",
		strings.NewReader(`{"offer":{"type":"offer","sdp":"v=0"}}`),
	)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusConflict {
		t.Fatalf("expected status %d, got %d", http.StatusConflict, response.Code)
	}

	var payload errorResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if payload.Error != "publisher_not_ready" {
		t.Fatalf("expected publisher_not_ready error, got %q", payload.Error)
	}
}
