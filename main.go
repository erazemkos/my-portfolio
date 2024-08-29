package main

import (
  "net/http"
  "net/smtp"
  "os"

  "github.com/joho/godotenv"
  "github.com/labstack/echo/v4"
  "github.com/labstack/echo/v4/middleware"
)

func main() {
  // Load environment variables
  if err := godotenv.Load(); err != nil {
      panic("Error loading .env file")
    }

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

  e.POST("/submit-form", handleFormSubmission)

  // Start server
  e.Logger.Fatal(e.Start("127.0.0.1:8080"))
}

func handleFormSubmission(c echo.Context) error {
  name := c.FormValue("name")
  email := c.FormValue("email")
  message := c.FormValue("message")

  // Send an email
  if err := sendEmail(name, email, message); err != nil {
      return c.JSON(http.StatusInternalServerError, map[string]string{
          "message": "Failed to send email",
        })
    }
  return c.JSON(http.StatusOK, map[string]string{
      "message": "Email sent successfully",
    })
}

func sendEmail(name, email, message string) error {
  sender := os.Getenv("SENDER_EMAIL")
  password := os.Getenv("EMAIL_PASSWORD")
  receiver := os.Getenv("RECEIVER_EMAIL")

  auth := smtp.PlainAuth("", sender, password, "smtp.gmail.com")

  subject := "Subject: New Inquiry\n"
  body := "Name: " + name + "\nEmail: " + email + "\nMessage: " + message
  msg := []byte(subject + "\n" + body)

  return smtp.SendMail("smtp.gmail.com:587", auth, sender, []string{receiver}, msg)
}

