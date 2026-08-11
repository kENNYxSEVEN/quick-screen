package sfu

import (
	"context"
	"sync"

	"github.com/pion/webrtc/v4"
)

type Manager struct {
	mu                    sync.Mutex
	peerConnectionFactory *peerConnectionFactory
	rooms                 map[string]*Room
}

func NewManager() *Manager {
	manager, err := NewManagerWithConfig(ICEConfig{})
	if err != nil {
		panic(err)
	}

	return manager
}

func NewManagerWithConfig(iceConfig ICEConfig) (*Manager, error) {
	peerConnectionFactory, err := newPeerConnectionFactory(iceConfig)
	if err != nil {
		return nil, err
	}

	return &Manager{
		peerConnectionFactory: peerConnectionFactory,
		rooms:                 make(map[string]*Room),
	}, nil
}

func (m *Manager) Publish(ctx context.Context, roomID string, offer webrtc.SessionDescription) (webrtc.SessionDescription, error) {
	room := m.getOrCreateRoom(roomID)
	answer, err := room.Publish(ctx, offer)
	if err != nil && !room.HasPublisher() {
		m.removeRoom(roomID, room)
	}

	return answer, err
}

func (m *Manager) Subscribe(ctx context.Context, roomID string, offer webrtc.SessionDescription) (webrtc.SessionDescription, error) {
	m.mu.Lock()
	room := m.rooms[roomID]
	m.mu.Unlock()

	if room == nil {
		return webrtc.SessionDescription{}, ErrPublisherUnavailable
	}

	return room.Subscribe(ctx, offer)
}

func (m *Manager) CloseRoom(roomID string) {
	m.mu.Lock()
	room := m.rooms[roomID]
	delete(m.rooms, roomID)
	m.mu.Unlock()

	if room != nil {
		room.Close()
	}
}

func (m *Manager) CloseAll() {
	m.mu.Lock()
	rooms := make([]*Room, 0, len(m.rooms))
	for _, room := range m.rooms {
		rooms = append(rooms, room)
	}
	m.rooms = make(map[string]*Room)
	m.mu.Unlock()

	for _, room := range rooms {
		room.Close()
	}
}

func (m *Manager) getOrCreateRoom(roomID string) *Room {
	m.mu.Lock()
	defer m.mu.Unlock()

	if room := m.rooms[roomID]; room != nil {
		return room
	}

	var room *Room
	room = newRoom(m.peerConnectionFactory, func() {
		m.removeRoom(roomID, room)
	})
	m.rooms[roomID] = room

	return room
}

func (m *Manager) removeRoom(roomID string, expectedRoom *Room) {
	m.mu.Lock()
	if m.rooms[roomID] == expectedRoom {
		delete(m.rooms, roomID)
	}
	m.mu.Unlock()
}
