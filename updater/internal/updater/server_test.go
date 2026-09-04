package updater

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const testSecret = "0123456789abcdef0123456789abcdef"

type fakeAPIManager struct {
	status  StatusResponse
	trigger TriggerResponse
}

func (manager *fakeAPIManager) Status(context.Context) StatusResponse { return manager.status }
func (manager *fakeAPIManager) Trigger() TriggerResponse              { return manager.trigger }

func TestServerStatusRequiresExactAuthenticationAndChannel(t *testing.T) {
	now := time.Now().UTC()
	manager := &fakeAPIManager{status: StatusResponse{Channel: Channel, State: StatusIdle, UpdatedAt: &now}}
	handler := NewServer(testSecret, manager).Handler()

	tests := []struct {
		name       string
		secret     []string
		url        string
		wantStatus int
	}{
		{name: "valid", secret: []string{testSecret}, url: "/v1/status?channel=xboard-dev", wantStatus: http.StatusOK},
		{name: "missing secret", url: "/v1/status?channel=xboard-dev", wantStatus: http.StatusUnauthorized},
		{name: "wrong secret", secret: []string{"0123456789abcdef0123456789abcdeg"}, url: "/v1/status?channel=xboard-dev", wantStatus: http.StatusUnauthorized},
		{name: "duplicate secret", secret: []string{testSecret, testSecret}, url: "/v1/status?channel=xboard-dev", wantStatus: http.StatusUnauthorized},
		{name: "wrong channel", secret: []string{testSecret}, url: "/v1/status?channel=main", wantStatus: http.StatusBadRequest},
		{name: "extra query", secret: []string{testSecret}, url: "/v1/status?channel=xboard-dev&other=1", wantStatus: http.StatusBadRequest},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, test.url, nil)
			for _, value := range test.secret {
				request.Header.Add("X-Xboard-Updater-Secret", value)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", response.Code, test.wantStatus, response.Body.String())
			}
			if response.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("missing no-store response header")
			}
		})
	}
}

func TestServerUpdateStrictBodyAndResponseStatus(t *testing.T) {
	operationID := strings.Repeat("a", 32)
	acceptedManager := &fakeAPIManager{trigger: TriggerResponse{Accepted: true, OperationID: &operationID, State: TriggerQueued}}
	busyMessage := "An update is already in progress"
	busyManager := &fakeAPIManager{trigger: TriggerResponse{Accepted: false, OperationID: &operationID, State: TriggerUpdating, Message: &busyMessage}}

	tests := []struct {
		name        string
		manager     *fakeAPIManager
		contentType string
		body        string
		wantStatus  int
	}{
		{name: "accepted", manager: acceptedManager, contentType: "application/json", body: `{"channel":"xboard-dev"}`, wantStatus: http.StatusAccepted},
		{name: "busy", manager: busyManager, contentType: "application/json; charset=utf-8", body: `{"channel":"xboard-dev"}`, wantStatus: http.StatusConflict},
		{name: "wrong media type", manager: acceptedManager, contentType: "text/plain", body: `{"channel":"xboard-dev"}`, wantStatus: http.StatusUnsupportedMediaType},
		{name: "wrong channel", manager: acceptedManager, contentType: "application/json", body: `{"channel":"main"}`, wantStatus: http.StatusBadRequest},
		{name: "extra field", manager: acceptedManager, contentType: "application/json", body: `{"channel":"xboard-dev","image":"evil"}`, wantStatus: http.StatusBadRequest},
		{name: "duplicate field", manager: acceptedManager, contentType: "application/json", body: `{"channel":"xboard-dev","channel":"xboard-dev"}`, wantStatus: http.StatusBadRequest},
		{name: "trailing object", manager: acceptedManager, contentType: "application/json", body: `{"channel":"xboard-dev"}{}`, wantStatus: http.StatusBadRequest},
		{name: "oversized", manager: acceptedManager, contentType: "application/json", body: `{"channel":"xboard-dev","padding":"` + strings.Repeat("x", maxRequestBody) + `"}`, wantStatus: http.StatusBadRequest},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			handler := NewServer(testSecret, test.manager).Handler()
			request := httptest.NewRequest(http.MethodPost, "/v1/update", strings.NewReader(test.body))
			request.Header.Set("X-Xboard-Updater-Secret", testSecret)
			request.Header.Set("Content-Type", test.contentType)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", response.Code, test.wantStatus, response.Body.String())
			}
			if test.wantStatus == http.StatusAccepted {
				var payload TriggerResponse
				if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
					t.Fatal(err)
				}
				if !payload.Accepted || payload.OperationID == nil || *payload.OperationID != operationID {
					t.Fatalf("unexpected trigger response: %+v", payload)
				}
			}
		})
	}
}

func TestHealthDoesNotExposeUpdaterState(t *testing.T) {
	handler := NewServer(testSecret, &fakeAPIManager{}).Handler()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if response.Code != http.StatusOK || response.Body.String() != "ok\n" {
		t.Fatalf("unexpected health response: %d %q", response.Code, response.Body.String())
	}
}
