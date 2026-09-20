package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"golang.org/x/text/language"
)

func TestServeAllowsOnlyPublicAssets(t *testing.T) {
	state.fileCache = [][]byte{[]byte("<html>en</html>")}
	state.matcher = language.NewMatcher([]language.Tag{language.English})

	for _, path := range []string{"/screensy.ts", "/screensy.js.map", "/screensy-website", "/translations/en.html"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		serve(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s: got %d, want 404", path, rec.Code)
		}
	}
}

func TestHealthzAndSecurityHeaders(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	serve(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("healthz: got %d", rec.Code)
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing nosniff")
	}
	if rec.Header().Get("Content-Security-Policy") == "" {
		t.Fatal("missing CSP")
	}
}

func TestIndexNegotiatesLanguage(t *testing.T) {
	state.fileCache = [][]byte{[]byte("en-doc"), []byte("nl-doc")}
	state.matcher = language.NewMatcher([]language.Tag{language.English, language.Dutch})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Accept-Language", "nl")
	rec := httptest.NewRecorder()
	serve(rec, req)
	if rec.Body.String() != "nl-doc" {
		t.Fatalf("body %q", rec.Body.String())
	}
}
