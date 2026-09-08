import { useRef, useCallback } from 'react';
import SimplePeer from 'simple-peer';
import { ICE_SERVERS, EVENTS } from '../utils/constants';
import useStore from '../store/useStore';

/**
 * WebRTC hook - manages peer connections for video/audio
 * Uses SimplePeer library for P2P connections
 */
export function useWebRTC(socket) {
  const peersRef = useRef(new Map());

  /**
   * Create a new peer connection
   * @param {string} socketId - Remote peer's socket ID
   * @param {boolean} initiator - Whether this peer initiates the connection
   */
  const createPeer = useCallback((socketId, initiator = false) => {
    const localStream = useStore.getState().localStream;
    if (!localStream) {
      console.warn('[WebRTC] No local stream available');
      return;
    }

    const existingPeer = peersRef.current.get(socketId);
    if (existingPeer && !existingPeer.destroyed) {
      // Peer already exists
      return;
    }

    console.log(`[WebRTC] Creating peer with ${socketId} (initiator: ${initiator})`);

    const peer = new SimplePeer({
      initiator,
      trickle: true,
      config: ICE_SERVERS,
      stream: localStream
    });

    peersRef.current.set(socketId, peer);
    useStore.getState().addPeer(socketId, peer);

    // Handle signaling data
    peer.on('signal', (data) => {
      if (data.type === 'offer') {
        socket.emit(EVENTS.OFFER, { targetId: socketId, sdp: data, type: 'video' });
      } else if (data.type === 'answer') {
        socket.emit(EVENTS.ANSWER, { targetId: socketId, sdp: data });
      } else if (data.candidate) {
        socket.emit(EVENTS.ICE_CANDIDATE, { targetId: socketId, candidate: data.candidate });
      }
    });

    // Remote stream received
    peer.on('stream', (remoteStream) => {
      console.log('[WebRTC] Received remote stream from', socketId);
      useStore.getState().setParticipantStream(socketId, remoteStream);
    });

    // Connection established
    peer.on('connect', () => {
      console.log('[WebRTC] Connected to', socketId);
    });

    // Handle errors
    peer.on('error', (err) => {
      console.error('[WebRTC] Peer error:', err.message, 'for', socketId);
      cleanupPeer(socketId);
    });

    // Cleanup when closed
    peer.on('close', () => {
      console.log('[WebRTC] Peer closed for', socketId);
      cleanupPeer(socketId);
    });

    return peer;
  }, [socket]);

  /**
   * Handle incoming offer
   */
  const handleOffer = useCallback((fromSocketId, fromName, sdp) => {
    console.log('[WebRTC] Received offer from', fromName || fromSocketId);

    let peer = peersRef.current.get(fromSocketId);
    if (!peer || peer.destroyed) {
      // Create peer as non-initiator
      peer = createPeer(fromSocketId, false);
    }

    if (peer && !peer.destroyed) {
      peer.signal(sdp);
    }
  }, [createPeer]);

  /**
   * Handle incoming answer
   */
  const handleAnswer = useCallback((fromSocketId, sdp) => {
    console.log('[WebRTC] Received answer from', fromSocketId);
    const peer = peersRef.current.get(fromSocketId);
    if (peer && !peer.destroyed) {
      peer.signal(sdp);
    }
  }, []);

  /**
   * Handle incoming ICE candidate
   */
  const handleIceCandidate = useCallback((fromSocketId, candidate) => {
    const peer = peersRef.current.get(fromSocketId);
    if (peer && !peer.destroyed) {
      peer.signal({ candidate });
    }
  }, []);

  /**
   * Remove a peer connection
   */
  const cleanupPeer = useCallback((socketId) => {
    const peer = peersRef.current.get(socketId);
    if (peer && !peer.destroyed) {
      try { peer.destroy(); } catch (e) {}
    }
    peersRef.current.delete(socketId);
    useStore.getState().removePeer(socketId);
    // Clear their stream from participants
    const participants = useStore.getState().participants;
    const p = participants.get(socketId);
    if (p) {
      useStore.getState().updateParticipant(socketId, { stream: null });
    }
  }, []);

  /**
   * Remove screen share peers (separate handling)
   */
  const removePeer = useCallback((socketId) => {
    cleanupPeer(socketId);
  }, [cleanupPeer]);

  /**
   * Clean up all peers
   */
  const cleanupAllPeers = useCallback(() => {
    peersRef.current.forEach((peer, socketId) => {
      try { peer.destroy(); } catch (e) {}
      peersRef.current.delete(socketId);
    });
  }, []);

  /**
   * Replace local stream (for screen share toggling)
   * This adds the screen share stream to all existing peers
   */
  const replaceLocalStream = useCallback((stream) => {
    useStore.getState().setLocalStream(stream);
    
    peersRef.current.forEach((peer, socketId) => {
      if (peer && !peer.destroyed) {
        try {
          peer.addStream(stream);
        } catch (e) {
          console.error('[WebRTC] Failed to replace stream for peer', socketId, e);
        }
      }
    });
  }, []);

  return {
    createPeer,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    cleanupPeer,
    removePeer,
    cleanupAllPeers,
    replaceLocalStream
  };
}
