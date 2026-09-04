package updater

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
)

const maxRequestBody = 1_024

type APIManager interface {
	Status(context.Context) StatusResponse
	Trigger() TriggerResponse
}

type Server struct {
	secretHash [sha256.Size]byte
	manager    APIManager
}

func NewServer(secret string, manager APIManager) *Server {
	return &Server{secretHash: sha256.Sum256([]byte(secret)), manager: manager}
}

func (server *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", server.health)
	mux.HandleFunc("GET /v1/status", server.authorize(server.status))
	mux.HandleFunc("POST /v1/update", server.authorize(server.update))
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Cache-Control", "no-store")
		response.Header().Set("X-Content-Type-Options", "nosniff")
		mux.ServeHTTP(response, request)
	})
}

func (server *Server) authorize(next http.HandlerFunc) http.HandlerFunc {
	return func(response http.ResponseWriter, request *http.Request) {
		values := request.Header.Values("X-Xboard-Updater-Secret")
		if len(values) != 1 {
			writeError(response, http.StatusUnauthorized, "unauthorized")
			return
		}
		candidateHash := sha256.Sum256([]byte(values[0]))
		if subtle.ConstantTimeCompare(candidateHash[:], server.secretHash[:]) != 1 {
			writeError(response, http.StatusUnauthorized, "unauthorized")
			return
		}
		next(response, request)
	}
}

func (server *Server) health(response http.ResponseWriter, _ *http.Request) {
	response.Header().Set("Content-Type", "text/plain; charset=utf-8")
	response.WriteHeader(http.StatusOK)
	_, _ = response.Write([]byte("ok\n"))
}

func (server *Server) status(response http.ResponseWriter, request *http.Request) {
	query := request.URL.Query()
	channels, ok := query["channel"]
	if !ok || len(query) != 1 || len(channels) != 1 || channels[0] != Channel {
		writeError(response, http.StatusBadRequest, "invalid channel")
		return
	}
	if request.ContentLength != 0 {
		writeError(response, http.StatusBadRequest, "request body is not allowed")
		return
	}
	writeJSON(response, http.StatusOK, server.manager.Status(request.Context()))
}

func (server *Server) update(response http.ResponseWriter, request *http.Request) {
	if request.URL.RawQuery != "" {
		writeError(response, http.StatusBadRequest, "query parameters are not allowed")
		return
	}
	mediaType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeError(response, http.StatusUnsupportedMediaType, "application/json is required")
		return
	}
	request.Body = http.MaxBytesReader(response, request.Body, maxRequestBody)
	channel, err := decodeUpdateBody(request.Body)
	if err != nil || channel != Channel {
		writeError(response, http.StatusBadRequest, "invalid update request")
		return
	}
	result := server.manager.Trigger()
	statusCode := http.StatusOK
	if result.Accepted {
		statusCode = http.StatusAccepted
	} else if result.State == TriggerUpdating {
		statusCode = http.StatusConflict
	}
	writeJSON(response, statusCode, result)
}

func decodeUpdateBody(reader io.Reader) (string, error) {
	decoder := json.NewDecoder(reader)
	opening, err := decoder.Token()
	if err != nil || opening != json.Delim('{') {
		return "", errors.New("request body must be an object")
	}
	seenChannel := false
	channel := ""
	for decoder.More() {
		keyToken, err := decoder.Token()
		if err != nil {
			return "", err
		}
		key, ok := keyToken.(string)
		if !ok || key != "channel" || seenChannel {
			return "", errors.New("request body contains an unsupported or duplicate field")
		}
		if err := decoder.Decode(&channel); err != nil {
			return "", err
		}
		seenChannel = true
	}
	closing, err := decoder.Token()
	if err != nil || closing != json.Delim('}') || !seenChannel {
		return "", errors.New("request body is incomplete")
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return "", errors.New("request body contains trailing data")
	}
	return channel, nil
}

func writeJSON(response http.ResponseWriter, status int, payload any) {
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(payload)
}

func writeError(response http.ResponseWriter, status int, message string) {
	writeJSON(response, status, struct {
		Error string `json:"error"`
	}{Error: message})
}
