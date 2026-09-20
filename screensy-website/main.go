package main

import (
	"bytes"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/text/language"
)

var state = globalState{}

type globalState struct {
	fileCache [][]byte
	matcher   language.Matcher
}

const csp = "default-src 'self'; connect-src 'self' ws: wss:; media-src 'self' blob:; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

func main() {
	const port = 8080
	const timeout = 5 * time.Second

	state.fileCache, state.matcher = fetchTranslations()

	server := http.Server{
		Addr:              fmt.Sprintf(":%d", port),
		Handler:           http.HandlerFunc(serve),
		ReadTimeout:       timeout,
		WriteTimeout:      timeout,
		IdleTimeout:       timeout,
		ReadHeaderTimeout: timeout,
		MaxHeaderBytes:    16 << 10,
	}

	log.Printf("Server started on port %d", port)
	err := server.ListenAndServe()
	log.Fatal(err)
}

func fetchTranslations() ([][]byte, language.Matcher) {
	filePaths, err := filepath.Glob("./translations/*.html")
	if err != nil {
		panic("Invalid pattern during fetchTranslations")
	}

	log.Printf("Registering the following %d translation files:", len(filePaths))
	for idx, filePath := range filePaths {
		log.Printf("%3d. %s\n", idx+1, filePath)
	}

	filePaths = append([]string{"translations/en.html"}, filePaths...)

	numTranslations := len(filePaths)
	fileCache := make([][]byte, numTranslations)
	languageTags := make([]language.Tag, numTranslations)

	for idx, filePath := range filePaths {
		fileCache[idx], err = os.ReadFile(filePath)
		if err != nil {
			panic("Could not read localisation file " + filePath)
		}

		fileName := filepath.Base(filePath)
		baseName := strings.TrimSuffix(fileName, filepath.Ext(fileName))
		languageTags[idx] = language.MustParse(baseName)
	}

	return fileCache, language.NewMatcher(languageTags)
}

func writeSecurityHeaders(writer http.ResponseWriter) {
	header := writer.Header()
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("X-Frame-Options", "DENY")
	header.Set("Referrer-Policy", "no-referrer")
	header.Set("Content-Security-Policy", csp)
	header.Set("Permissions-Policy", "camera=(), microphone=(), display-capture=(self), geolocation=()")
	header.Set("Cache-Control", "no-store")
}

func serve(writer http.ResponseWriter, request *http.Request) {
	writeSecurityHeaders(writer)

	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	switch request.URL.Path {
	case "/healthz":
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte("ok"))
	case "/", "/index.html":
		acceptLanguageHeader := request.Header.Get("Accept-Language")
		tags, _, _ := language.ParseAcceptLanguage(acceptLanguageHeader)
		_, idx, _ := state.matcher.Match(tags...)
		http.ServeContent(writer, request, "index.html", time.Time{}, bytes.NewReader(state.fileCache[idx]))
	case "/screensy.js":
		http.ServeFile(writer, request, "screensy.js")
	case "/styles.css":
		http.ServeFile(writer, request, "styles.css")
	default:
		http.NotFound(writer, request)
	}
}
