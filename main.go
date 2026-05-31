package main

import (
	"context"
	"encoding/json"
	"errors"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
)

const defaultProjectJSON = `{
  "name": "Načrt notranje opreme hiše",
  "currency": "EUR",
  "updatedAt": "2026-05-31T00:00:00.000Z",
  "floors": [
    {
      "id": "floor-ground",
      "name": "Pritličje",
      "width": 1200,
      "height": 800,
      "rooms": [
        { "id": "room-kitchen", "name": "Kuhinja", "type": "kitchen", "x": 80, "y": 80, "w": 320, "h": 230, "materialGroupIds": [] },
        { "id": "room-living", "name": "Dnevna soba", "type": "living", "x": 430, "y": 80, "w": 430, "h": 300, "materialGroupIds": [] },
        { "id": "room-bath", "name": "Kopalnica", "type": "bathroom", "x": 80, "y": 340, "w": 230, "h": 180, "materialGroupIds": [] }
      ]
    }
  ],
  "materialGroups": []
}`

type fetchURLRequest struct {
	URL string `json:"url"`
}

func main() {
	e := echo.New()
	e.Use(middleware.Logger())
	e.Use(middleware.Recover())

	dataFile := hisaDataFile()

	// Hisa interior planner, hosted under /hisa.
	e.GET("/hisa/api/project", getHisaProject(dataFile))
	e.PUT("/hisa/api/project", putHisaProject(dataFile))
	e.POST("/hisa/api/fetch-url", fetchHisaURL)
	e.Static("/hisa/assets", "hisa/public")
	e.GET("/hisa", func(c echo.Context) error { return c.File("hisa/public/index.html") })
	e.GET("/hisa/", func(c echo.Context) error { return c.File("hisa/public/index.html") })
	e.GET("/hisa/*", func(c echo.Context) error { return c.File("hisa/public/index.html") })

	// Existing portfolio routes.
	e.Static("/static", "static")
	e.Static("/credit/assets", "credit/assets")

	// Hidden credit calculator. It is intentionally not linked from the portfolio.
	e.GET("/credit", func(c echo.Context) error { return c.File("credit/index.html") })
	e.GET("/credit/", func(c echo.Context) error { return c.File("credit/index.html") })
	e.GET("/credit/*", func(c echo.Context) error { return c.File("credit/index.html") })

	e.GET("/", func(c echo.Context) error { return c.File("index.html") })

	e.Logger.Fatal(e.Start("0.0.0.0:8080"))
}

func hisaDataFile() string {
	dataDir := os.Getenv("HISA_DATA_DIR")
	if dataDir == "" {
		dataDir = "hisa/data"
	}
	return filepath.Join(dataDir, "project.json")
}

func ensureHisaDataFile(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if _, err := os.Stat(path); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return os.WriteFile(path, []byte(defaultProjectJSON), 0o644)
}

func getHisaProject(path string) echo.HandlerFunc {
	return func(c echo.Context) error {
		if err := ensureHisaDataFile(path); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		return c.File(path)
	}
}

func putHisaProject(path string) echo.HandlerFunc {
	return func(c echo.Context) error {
		var project map[string]any
		if err := json.NewDecoder(c.Request().Body).Decode(&project); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Neveljaven JSON projekta."})
		}
		if _, ok := project["floors"].([]any); !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Neveljaven JSON projekta: pričakovan je floors[]."})
		}
		if _, ok := project["materialGroups"].([]any); !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Neveljaven JSON projekta: pričakovan je materialGroups[]."})
		}
		project["updatedAt"] = time.Now().UTC().Format(time.RFC3339Nano)

		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		payload, err := json.MarshalIndent(project, "", "  ")
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		tmp := path + ".tmp"
		if err := os.WriteFile(tmp, payload, 0o644); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		if err := os.Rename(tmp, path); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		return c.JSON(http.StatusOK, map[string]any{"ok": true, "updatedAt": project["updatedAt"]})
	}
}

func fetchHisaURL(c echo.Context) error {
	var request fetchURLRequest
	if err := c.Bind(&request); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Vnesi veljaven URL."})
	}
	inputURL := strings.TrimSpace(request.URL)
	parsed, err := url.ParseRequestURI(inputURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Vnesi veljaven URL."})
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Podprti so samo http(s) URL-ji."})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Vnesi veljaven URL."})
	}
	req.Header.Set("User-Agent", "ProjektHisaInteriorPlanner/1.0 (+local app)")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return c.JSON(http.StatusGatewayTimeout, map[string]string{"error": "Pridobivanje URL-ja je trajalo predolgo."})
		}
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "URL-ja ni bilo mogoče prebrati."})
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 2*1024*1024))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "URL-ja ni bilo mogoče prebrati."})
	}
	htmlText := string(body)

	title := decodeHTML(firstNonEmpty(
		pickMeta(htmlText, "og:title"),
		pickTitle(htmlText),
	))
	description := decodeHTML(firstNonEmpty(
		pickMeta(htmlText, "description"),
		pickMeta(htmlText, "og:description"),
	))
	imageURL := decodeHTML(firstNonEmpty(
		pickMeta(htmlText, "og:image"),
		pickMeta(htmlText, "twitter:image"),
	))
	price := decodeHTML(firstNonEmpty(
		pickMeta(htmlText, "product:price:amount"),
		pickPrice(htmlText),
	))

	absoluteImage := ""
	if imageURL != "" {
		if img, err := url.Parse(imageURL); err == nil {
			absoluteImage = parsed.ResolveReference(img).String()
		}
	}

	priceValue := any("")
	if price != "" {
		if parsedPrice, err := strconv.ParseFloat(strings.ReplaceAll(price, ",", "."), 64); err == nil {
			priceValue = parsedPrice
		}
	}

	return c.JSON(http.StatusOK, map[string]any{
		"sourceUrl": parsed.String(),
		"vendor":    strings.TrimPrefix(parsed.Hostname(), "www."),
		"name":      title,
		"notes":     description,
		"imageUrl":  absoluteImage,
		"price":     priceValue,
	})
}

func pickMeta(htmlText, key string) string {
	metaRe := regexp.MustCompile(`(?is)<meta\b[^>]*>`)
	contentRe := regexp.MustCompile(`(?is)\bcontent=["']([^"']*)["']`)
	nameRe := regexp.MustCompile(`(?is)\b(?:name|property)=["']([^"']*)["']`)
	for _, tag := range metaRe.FindAllString(htmlText, -1) {
		nameMatch := nameRe.FindStringSubmatch(tag)
		if len(nameMatch) < 2 || !strings.EqualFold(strings.TrimSpace(nameMatch[1]), key) {
			continue
		}
		contentMatch := contentRe.FindStringSubmatch(tag)
		if len(contentMatch) >= 2 {
			return strings.TrimSpace(contentMatch[1])
		}
	}
	return ""
}

func pickTitle(htmlText string) string {
	titleRe := regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	match := titleRe.FindStringSubmatch(htmlText)
	if len(match) >= 2 {
		return strings.TrimSpace(match[1])
	}
	return ""
}

func pickPrice(htmlText string) string {
	priceRe := regexp.MustCompile(`(?is)(?:price|amount)["']?\s*[:=]\s*["']?(\d+(?:[\.,]\d{1,2})?)`)
	match := priceRe.FindStringSubmatch(htmlText)
	if len(match) >= 2 {
		return strings.TrimSpace(match[1])
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func decodeHTML(value string) string {
	return strings.TrimSpace(html.UnescapeString(value))
}
