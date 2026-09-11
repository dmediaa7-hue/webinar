import { useRef, useCallback } from 'react';
import SimplePeer from 'simple-peer';
import { EVENTS } from '../utils/constants';
import { getIceConfig } from '../utils/iceConfig';
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
  const createPeer = useCallback(async (socketId, initiator = false) => {
    const localStream = useStore.getState().localStream;
    if (!localStream) {
      console.warn('[WebRTC] No local stream available');
      return undefined;
    }

    const existingPeer = peersRef.current.get(socketId);
    if (existingPeer && !existingPeer.destroyed) {
      // Peer already exists
      return existingPeer;
    }

    console.log(`[WebRTC] Creating peer with ${socketId} (initiator: ${initiator})`);

    // ICE config (STUN + short-lived TURN creds) is fixed at construction
    // time by SimplePeer, so resolve it before creating the peer.
    const iceServers = await getIceConfig();

    // Re-check after the await: a concurrent createPeer for the same socketId
    // may have won the race and already stored a peer while this one waited.
    const racedPeer = peersRef.current.get(socketId);
    if (racedPeer && !racedPeer.destroyed) return racedPeer;

    const peer = new SimplePeer({
      initiator,
      trickle: true,
      config: { iceServers },
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
      // "User-Initiated Abort" fires whenever a peer is intentionally destroyed
      // (leaving the meeting, participant disconnects, page closed) - normal.
      if (err.message && err.message.startsWith('User-Initiated Abort')) {
        console.log('[WebRTC] Peer closed for', socketId);
      } else {
        console.error('[WebRTC] Peer error:', err.message, 'for', socketId);
      }
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
  const handleOffer = useCallback(async (fromSocketId, fromName, sdp) => {
    console.log('[WebRTC] Received offer from', fromName || fromSocketId);

    let peer = peersRef.current.get(fromSocketId);
    if (!peer || peer.destroyed) {
      peer = await createPeer(fromSocketId, false);
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
      try { peer.destroy(); } catch (e) { console.warn('[webrtc] peer destroy failed', e); }
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
   * Clean up all peers
   */
  const cleanupAllPeers = useCallback(() => {
    peersRef.current.forEach((peer, socketId) => {
      try { peer.destroy(); } catch (e) { console.warn('[webrtc] peer destroy failed', e); }
      peersRef.current.delete(socketId);
    });
  }, []);

  /**
   * Swap the local video/audio track sent to all peers (screen share, flip).
   * Uses peer.replaceTrack (same RTCRtpSender, no renegotiation) instead of
   * removeStream/addStream: a removed sender can never be re-added in
   * simple-peer ('Track has been removed'), which crashed screen-share stop.
   * Tracks of kinds absent from the new stream (e.g. mic during screen
   * share) keep flowing untouched.
   */
  const replaceLocalStream = useCallback((stream) => {
    const previous = useStore.getState().localStream;
    useStore.getState().setLocalStream(stream);

    const prevTracks = previous ? previous.getTracks() : [];
    const nextTracks = stream.getTracks();

    peersRef.current.forEach((peer, socketId) => {
      if (!peer || peer.destroyed) return;
      try {
        nextTracks.forEach((nextTrack) => {
          const oldTrack = prevTracks.find((t) => t.kind === nextTrack.kind);
          if (!oldTrack || oldTrack === nextTrack) return;

          // replaceTrack's sender lookup is keyed by the stream the old track
          // was originally attached to (or the submap it inherited via an
          // earlier swap), so try the new stream, then the previous one.
          try {
            peer.replaceTrack(oldTrack, nextTrack, stream);
          } catch (err) {
            peer.replaceTrack(oldTrack, nextTrack, previous);
          }
        });
      } catch (e) {
        console.error('[WebRTC] Failed to replace stream for peer', socketId, e);
      }
    });
  }, []);

  /**
   * Replace one local track across all peers (camera flip swaps in place on
   * the SAME stream, so replaceLocalStream can't see a kind change).
   */
  const replaceLocalTrack = useCallback((oldTrack, newTrack, stream) => {
    peersRef.current.forEach((peer, socketId) => {
      if (!peer || peer.destroyed) return;
      try {
        peer.replaceTrack(oldTrack, newTrack, stream);
      } catch (e) {
        console.error('[WebRTC] Failed to replace local track for peer', socketId, e);
      }
    });
  }, []);

  return {
    createPeer,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    cleanupPeer,
    cleanupAllPeers,
    replaceLocalStream,
    replaceLocalTrack
  };
}
