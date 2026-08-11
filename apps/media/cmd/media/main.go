package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/ingamers/screen-share/apps/media/internal/httpapi"
	"github.com/ingamers/screen-share/apps/media/internal/sfu"
)

func main() {
	iceConfig, err := sfu.LoadICEConfig(os.Getenv)
	if err != nil {
		log.Fatal(err)
	}
	manager, err := sfu.NewManagerWithConfig(iceConfig)
	if err != nil {
		log.Fatal(err)
	}
	udpPortRange := "default"
	if iceConfig.HasUDPPortRange() {
		udpPortRange = fmt.Sprintf("%d-%d", iceConfig.UDPPortMin, iceConfig.UDPPortMax)
	}
	log.Printf(
		"media ICE configured: stun_servers=%d public_address_rewrite=%t udp_port_range=%s diagnostics=%t",
		len(iceConfig.STUNURLs),
		iceConfig.PublicIP != "",
		udpPortRange,
		iceConfig.Diagnostics,
	)
	server := &http.Server{
		Addr:              ":" + mediaPort(),
		Handler:           httpapi.NewHandler(manager),
		ReadHeaderTimeout: 5 * time.Second,
	}

	serverErrors := make(chan error, 1)
	go func() {
		serverErrors <- server.ListenAndServe()
	}()

	shutdownContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	select {
	case <-shutdownContext.Done():
	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
		return
	}

	manager.CloseAll()
	contextWithTimeout, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Shutdown(contextWithTimeout); err != nil {
		log.Printf("media server shutdown failed: %v", err)
	}
}

func mediaPort() string {
	value := os.Getenv("MEDIA_PORT")
	if value == "" {
		return "3002"
	}

	port, err := strconv.Atoi(value)
	if err != nil || port < 1 || port > 65535 {
		log.Fatal("MEDIA_PORT must be an integer between 1 and 65535")
	}

	return value
}
