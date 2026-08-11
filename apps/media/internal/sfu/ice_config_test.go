package sfu

import "testing"

func TestLoadICEConfigParsesOptionalSettings(t *testing.T) {
	values := map[string]string{
		"MEDIA_STUN_URLS":       " stun:stun-one.example:3478,stuns:stun-two.example:5349,stun:stun-one.example:3478 ",
		"MEDIA_PUBLIC_IP":       "203.0.113.10",
		"MEDIA_UDP_PORT_MIN":    "50000",
		"MEDIA_UDP_PORT_MAX":    "50100",
		"MEDIA_ICE_DIAGNOSTICS": "false",
	}

	config, err := LoadICEConfig(func(key string) string {
		return values[key]
	})
	if err != nil {
		t.Fatalf("load ICE config: %v", err)
	}

	if len(config.STUNURLs) != 2 {
		t.Fatalf("expected two deduplicated STUN URLs, got %d", len(config.STUNURLs))
	}
	if config.PublicIP != "203.0.113.10" {
		t.Fatalf("expected public IP to be normalized, got %q", config.PublicIP)
	}
	if !config.HasUDPPortRange() || config.UDPPortMin != 50000 || config.UDPPortMax != 50100 {
		t.Fatalf("expected UDP port range 50000-50100, got %d-%d", config.UDPPortMin, config.UDPPortMax)
	}
	if config.Diagnostics {
		t.Fatal("expected diagnostics to be disabled")
	}
}

func TestLoadICEConfigDefaultsToLocalDevelopment(t *testing.T) {
	config, err := LoadICEConfig(func(string) string { return "" })
	if err != nil {
		t.Fatalf("load default ICE config: %v", err)
	}
	if len(config.STUNURLs) != 0 || config.PublicIP != "" || config.HasUDPPortRange() {
		t.Fatal("expected no STUN server, public IP, or UDP port range for local development")
	}
	if !config.Diagnostics {
		t.Fatal("expected ICE diagnostics to be enabled by default")
	}
}

func TestLoadICEConfigRejectsUnsupportedOrUnsafeValues(t *testing.T) {
	testCases := []struct {
		name   string
		values map[string]string
	}{
		{
			name: "turn URL",
			values: map[string]string{
				"MEDIA_STUN_URLS": "turn:turn.example:3478",
			},
		},
		{
			name: "private public IP",
			values: map[string]string{
				"MEDIA_PUBLIC_IP": "192.168.1.10",
			},
		},
		{
			name: "invalid diagnostics value",
			values: map[string]string{
				"MEDIA_ICE_DIAGNOSTICS": "enabled",
			},
		},
		{
			name: "incomplete UDP port range",
			values: map[string]string{
				"MEDIA_UDP_PORT_MIN": "50000",
			},
		},
		{
			name: "invalid UDP port",
			values: map[string]string{
				"MEDIA_UDP_PORT_MIN": "invalid",
				"MEDIA_UDP_PORT_MAX": "50100",
			},
		},
		{
			name: "reversed UDP port range",
			values: map[string]string{
				"MEDIA_UDP_PORT_MIN": "50100",
				"MEDIA_UDP_PORT_MAX": "50000",
			},
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := LoadICEConfig(func(key string) string {
				return testCase.values[key]
			})
			if err == nil {
				t.Fatal("expected invalid ICE configuration to fail")
			}
		})
	}
}

func TestNewManagerWithConfigSharesSTUNConfiguration(t *testing.T) {
	manager, err := NewManagerWithConfig(ICEConfig{
		STUNURLs:    []string{"stun:stun.example:3478"},
		PublicIP:    "203.0.113.10",
		UDPPortMin:  50000,
		UDPPortMax:  50100,
		Diagnostics: true,
	})
	if err != nil {
		t.Fatalf("create configured manager: %v", err)
	}
	defer manager.CloseAll()

	room := manager.getOrCreateRoom("kenny")
	if room.peerConnectionFactory != manager.peerConnectionFactory {
		t.Fatal("expected media room to use the manager peer connection factory")
	}
	if len(manager.peerConnectionFactory.config.ICEServers) != 1 {
		t.Fatal("expected configured STUN server on peer connections")
	}
	if !manager.peerConnectionFactory.diagnostics {
		t.Fatal("expected configured ICE diagnostics")
	}
}

func TestNewManagerWithConfigRejectsIncompleteUDPPortRange(t *testing.T) {
	_, err := NewManagerWithConfig(ICEConfig{UDPPortMin: 50000})
	if err == nil {
		t.Fatal("expected incomplete UDP port range to be rejected")
	}
}
