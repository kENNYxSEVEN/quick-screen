package sfu

import (
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"

	"github.com/pion/webrtc/v4"
)

// ICEConfig controls the shared Pion configuration for publisher and viewer
// peer connections. It intentionally accepts STUN only; TURN is not part of
// this MVP.
type ICEConfig struct {
	STUNURLs    []string
	PublicIP    string
	UDPPortMin  uint16
	UDPPortMax  uint16
	Diagnostics bool
}

// HasUDPPortRange reports whether Pion should restrict its ephemeral UDP ports.
// A zero range deliberately leaves Pion's default behavior intact for local development.
func (config ICEConfig) HasUDPPortRange() bool {
	return config.UDPPortMin != 0 && config.UDPPortMax != 0
}

type peerConnectionFactory struct {
	api         *webrtc.API
	config      webrtc.Configuration
	diagnostics bool
}

func LoadICEConfig(getenv func(string) string) (ICEConfig, error) {
	stunURLs, err := normalizeSTUNURLs(getenv("MEDIA_STUN_URLS"))
	if err != nil {
		return ICEConfig{}, err
	}

	publicIP, err := normalizePublicIP(getenv("MEDIA_PUBLIC_IP"))
	if err != nil {
		return ICEConfig{}, err
	}

	udpPortMin, udpPortMax, err := loadUDPPortRange(
		getenv("MEDIA_UDP_PORT_MIN"),
		getenv("MEDIA_UDP_PORT_MAX"),
	)
	if err != nil {
		return ICEConfig{}, err
	}

	diagnostics := true
	if value := strings.TrimSpace(getenv("MEDIA_ICE_DIAGNOSTICS")); value != "" {
		diagnostics, err = strconv.ParseBool(value)
		if err != nil {
			return ICEConfig{}, fmt.Errorf("MEDIA_ICE_DIAGNOSTICS must be true or false: %w", err)
		}
	}

	return ICEConfig{
		STUNURLs:    stunURLs,
		PublicIP:    publicIP,
		UDPPortMin:  udpPortMin,
		UDPPortMax:  udpPortMax,
		Diagnostics: diagnostics,
	}, nil
}

func newPeerConnectionFactory(iceConfig ICEConfig) (*peerConnectionFactory, error) {
	stunURLs, err := normalizeSTUNURLList(iceConfig.STUNURLs)
	if err != nil {
		return nil, err
	}

	publicIP, err := normalizePublicIP(iceConfig.PublicIP)
	if err != nil {
		return nil, err
	}

	if err := validateUDPPortRange(iceConfig.UDPPortMin, iceConfig.UDPPortMax); err != nil {
		return nil, err
	}

	configuration := webrtc.Configuration{}
	if len(stunURLs) > 0 {
		configuration.ICEServers = []webrtc.ICEServer{{URLs: stunURLs}}
	}

	settingEngine := webrtc.SettingEngine{}
	if publicIP != "" {
		if err := settingEngine.SetICEAddressRewriteRules(
			webrtc.ICEAddressRewriteRule{
				External:        []string{publicIP},
				AsCandidateType: webrtc.ICECandidateTypeHost,
				Mode:            webrtc.ICEAddressRewriteReplace,
			},
		); err != nil {
			return nil, fmt.Errorf("configure media public IP rewrite: %w", err)
		}
	}
	if iceConfig.HasUDPPortRange() {
		if err := settingEngine.SetEphemeralUDPPortRange(iceConfig.UDPPortMin, iceConfig.UDPPortMax); err != nil {
			return nil, fmt.Errorf("configure media UDP port range: %w", err)
		}
	}

	return &peerConnectionFactory{
		api:         webrtc.NewAPI(webrtc.WithSettingEngine(settingEngine)),
		config:      configuration,
		diagnostics: iceConfig.Diagnostics,
	}, nil
}

func (f *peerConnectionFactory) newPeerConnection() (*webrtc.PeerConnection, error) {
	return f.api.NewPeerConnection(f.config)
}

func normalizeSTUNURLs(value string) ([]string, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}

	return normalizeSTUNURLList(strings.Split(value, ","))
}

func normalizeSTUNURLList(values []string) ([]string, error) {
	urls := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))

	for _, value := range values {
		serverURL := strings.TrimSpace(value)
		if serverURL == "" {
			continue
		}

		parsedURL, err := url.ParseRequestURI(serverURL)
		if err != nil || (parsedURL.Scheme != "stun" && parsedURL.Scheme != "stuns") ||
			(parsedURL.Opaque == "" && parsedURL.Host == "") {
			return nil, fmt.Errorf("invalid STUN URL %q", serverURL)
		}

		if _, exists := seen[serverURL]; exists {
			continue
		}

		seen[serverURL] = struct{}{}
		urls = append(urls, serverURL)
	}

	return urls, nil
}

func normalizePublicIP(value string) (string, error) {
	trimmedValue := strings.TrimSpace(value)
	if trimmedValue == "" {
		return "", nil
	}

	parsedIP := net.ParseIP(trimmedValue)
	if parsedIP == nil || parsedIP.IsUnspecified() || parsedIP.IsLoopback() ||
		parsedIP.IsPrivate() || parsedIP.IsLinkLocalUnicast() || parsedIP.IsLinkLocalMulticast() {
		return "", fmt.Errorf("MEDIA_PUBLIC_IP must be a public IP address")
	}

	return parsedIP.String(), nil
}

func loadUDPPortRange(minValue, maxValue string) (uint16, uint16, error) {
	trimmedMinValue := strings.TrimSpace(minValue)
	trimmedMaxValue := strings.TrimSpace(maxValue)
	if trimmedMinValue == "" && trimmedMaxValue == "" {
		return 0, 0, nil
	}
	if trimmedMinValue == "" || trimmedMaxValue == "" {
		return 0, 0, fmt.Errorf("MEDIA_UDP_PORT_MIN and MEDIA_UDP_PORT_MAX must be set together")
	}

	min, err := parseUDPPort("MEDIA_UDP_PORT_MIN", trimmedMinValue)
	if err != nil {
		return 0, 0, err
	}
	max, err := parseUDPPort("MEDIA_UDP_PORT_MAX", trimmedMaxValue)
	if err != nil {
		return 0, 0, err
	}
	if err := validateUDPPortRange(min, max); err != nil {
		return 0, 0, err
	}

	return min, max, nil
}

func parseUDPPort(name, value string) (uint16, error) {
	port, err := strconv.Atoi(value)
	if err != nil || port < 1 || port > 65535 {
		return 0, fmt.Errorf("%s must be an integer between 1 and 65535", name)
	}

	return uint16(port), nil
}

func validateUDPPortRange(min, max uint16) error {
	if min == 0 && max == 0 {
		return nil
	}
	if min == 0 || max == 0 {
		return fmt.Errorf("MEDIA_UDP_PORT_MIN and MEDIA_UDP_PORT_MAX must be set together")
	}
	if min > max {
		return fmt.Errorf("MEDIA_UDP_PORT_MIN must be less than or equal to MEDIA_UDP_PORT_MAX")
	}

	return nil
}
