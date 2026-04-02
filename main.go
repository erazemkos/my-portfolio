package main

import (
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
)

func main() {
	// Create a new instance of Echo
	e := echo.New()

	// Middleware
	e.Use(middleware.Logger())
	e.Use(middleware.Recover())

	// Serve static files
	e.Static("/static", "static")

	// Route => handler
	e.GET("/", func(c echo.Context) error {
		return c.File("index.html") // Ensure you have an index.html in your root directory
	})

	// Start server
	e.Logger.Fatal(e.Start("0.0.0.0:8080"))
}
