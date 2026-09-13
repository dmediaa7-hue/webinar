import { useRef, useCallback, useEffect } from 'react';
import SimplePeer from 'simple-peer';
import { EVENTS } from '../utils/constants';
import { getIceConfig } from '../utils/iceConfig';
import { bufferCandidate, drainCandidates, clearCandidates, clearAllCandidates } from '../utils/iceCandidateBuffer';
import { shouldInitiate } from '../utils/initiator';
import useStore from '../store/useStore';

const RETRY_BASE_MS = 1000;
const MAX_RETRIES = 5;

/**
 * WebRTC hook - manages peer connections for video/audio
 * Uses SimplePeer library for P2P connections
 */
export function useWebRTC(socket) {
  const peersRef = useRef(new Map());
  const remoteStreamsRef = useRef(new Map());
  const retryTimersRef = useRef(new Map());
  const retryAttemptsRef = useRef(new Map());
  // ICE candidates received before the matching peer exists are queued here,
  // then drained into the peer once created (simple-peer itself buffers
  // candidates only in order, after the peer object is constructed).
  const pendingCandidatesRef = useRef(new Map());
  // Offers that arrived before local media was ready: createPeer bails without
  // a stream, so without this the SDP would be dropped and the pair would
  // deadlock (answerer waits for an offer it already received). Applied once
  // the media-landed re-init effect creates the peer.
  const pendingOffersRef = useRef(new Map());
  // Role each peer was created with: 'initiator' | 'answerer'. Used to resolve
  // glare: if a peer we created as initiator receives an offer, the remote also
  // (wrongly) initiated, so tear ours down and answer instead.
  const peerRolesRef = useRef(new Map());

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
    peerRolesRef.current.set(socketId, initiator ? 'initiator' : 'answerer');
    useStore.getState().addPeer(socketId, peer);

    // Flush ICE candidates that arrived while this peer was being created
    // (e.g. during the getIceConfig await above). simple-peer handles
    // candidate signals before the offer/answer negotiation fine.
    drainCandidates(pendingCandidatesRef.current, socketId).forEach((cand) => {
      peer.signal({ candidate: cand });
    });

    // Apply an offer that arrived before local media was ready (handleOffer
    // buffered it because createPeer had to bail). The media-landed re-init
    // effect creates this peer as answerer, and signaling the buffered offer
    // completes the negotiation that would otherwise deadlock.
    const pendingOffer = drainCandidates(pendingOffersRef.current, socketId)[0];
    if (pendingOffer) {
      peer.signal(pendingOffer);
    }

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
      remoteStreamsRef.current.set(socketId, remoteStream);
      useStore.getState().setParticipantStream(socketId, remoteStream);
    });

    // Connection established
    peer.on('connect', () => {
      console.log('[WebRTC] Connected to', socketId);
      const timer = retryTimersRef.current.get(socketId);
      if (timer) {
        clearTimeout(timer);
        retryTimersRef.current.delete(socketId);
      }
      retryAttemptsRef.current.delete(socketId);
      useStore.getState().updateParticipant(socketId, { connecting: false });
    });

    // Handle errors
    peer.on('error', (err) => {
      // "User-Initiated Abort" fires whenever a peer is intentionally destroyed
      // (leaving the meeting, participant disconnects, page closed) - normal.
      // The 'close' handler below owns that teardown, so just return and let
      // it run; doing it here logs "Peer closed" twice for the same peer.
      if (err.message && err.message.startsWith('User-Initiated Abort')) {
        return;
      }
      // Real failures (e.g. ICE "Connection failed." when STUN cannot traverse
      // a symmetric NAT) tear the peer down and retry with backoff. A fresh
      // connection is cheaper than leaving the participant video-less forever.
      console.error('[WebRTC] Peer error:', err.message, 'for', socketId);
      const failedInitiator = initiator;
      const attempt = (retryAttemptsRef.current.get(socketId) || 0) + 1;
      cleanupPeer(socketId);
      useStore.getState().updateParticipant(socketId, { connecting: true });
      if (attempt > MAX_RETRIES || !useStore.getState().participants.has(socketId)) {
        retryAttemptsRef.current.delete(socketId);
        useStore.getState().updateParticipant(socketId, { connecting: false });
        return;
      }
      retryAttemptsRef.current.set(socketId, attempt);
      const timer = setTimeout(() => {
        retryTimersRef.current.delete(socketId);
        createPeer(socketId, failedInitiator);
      }, RETRY_BASE_MS * 2 ** (attempt - 1));
      retryTimersRef.current.set(socketId, timer);
    });

    // Cleanup when closed
    peer.on('close', () => {
      console.log('[WebRTC] Peer closed for', socketId);
      cleanupPeer(socketId);
    });

    return peer;
  }, [socket]);

  /**
   * Remove a peer connection
   */
  const cleanupPeer = useCallback((socketId) => {
    const peer = peersRef.current.get(socketId);
    if (peer && !peer.destroyed) {
      try { peer.destroy(); } catch (e) { console.warn('[webrtc] peer destroy failed', e); }
    }
    const timer = retryTimersRef.current.get(socketId);
    if (timer) {
      clearTimeout(timer);
      retryTimersRef.current.delete(socketId);
    }
    retryAttemptsRef.current.delete(socketId);
    // Stop the peer's tracks so the leaver's camera/mic release immediately
    // on this client - peer.destroy() only closes the connection, it does not
    // stop the tracks of the stream it delivered.
    const remoteStream = remoteStreamsRef.current.get(socketId);
    if (remoteStream) {
      remoteStream.getTracks().forEach((track) => track.stop());
      remoteStreamsRef.current.delete(socketId);
    }
    peersRef.current.delete(socketId);
    peerRolesRef.current.delete(socketId);
    clearCandidates(pendingCandidatesRef.current, socketId);
    clearCandidates(pendingOffersRef.current, socketId);
    useStore.getState().removePeer(socketId);
    // Clear their stream from participants
    const participants = useStore.getState().participants;
    const p = participants.get(socketId);
    if (p) {
      useStore.getState().updateParticipant(socketId, { stream: null });
    }
  }, []);

  /**
   * Handle incoming offer
   */
  const handleOffer = useCallback(async (fromSocketId, fromName, sdp) => {
    console.log('[WebRTC] Received offer from', fromName || fromSocketId);

    let peer = peersRef.current.get(fromSocketId);

    // Glare: a peer we created as initiator receiving an offer means BOTH sides
    // decided to initiate (e.g. simultaneous join). Only one offer can win -
    // answerer does - so tear our initiator peer down and answer instead.
    if (peer && !peer.destroyed && peerRolesRef.current.get(fromSocketId) === 'initiator') {
      console.warn('[WebRTC] Glare with', fromSocketId, '- switching to answerer');
      cleanupPeer(fromSocketId);
      peer = undefined;
    }

    if (!peer || peer.destroyed) {
      peer = await createPeer(fromSocketId, false);
      if (!peer) {
        // Local media not ready, so createPeer bailed. Buffer the offer so it
        // is applied when the media-landed re-init effect creates this peer
        // (see createPeer's pending-offer drain) - otherwise the initiator
        // waits forever for an answer to an offer we already received.
        bufferCandidate(pendingOffersRef.current, fromSocketId, sdp);
        return;
      }
    }

    if (peer && !peer.destroyed) {
      peer.signal(sdp);
    }
  }, [createPeer, cleanupPeer]);

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
    } else {
      // Peer not created yet (offer/answer still in flight, createPeer awaiting
      // ice config). Queue instead of dropping - simple-peer can only accept
      // candidates once its peer object exists.
      bufferCandidate(pendingCandidatesRef.current, fromSocketId, candidate);
    }
  }, []);

  /**
   * Clean up all peers
   */
  const cleanupAllPeers = useCallback(() => {
    retryTimersRef.current.forEach((timer) => clearTimeout(timer));
    retryTimersRef.current.clear();
    retryAttemptsRef.current.clear();
    peerRolesRef.current.clear();
    clearAllCandidates(pendingCandidatesRef.current);
    clearAllCandidates(pendingOffersRef.current);
    peersRef.current.forEach((peer, socketId) => {
      try { peer.destroy(); } catch (e) { console.warn('[webrtc] peer destroy failed', e); }
      peersRef.current.delete(socketId);
    });
    remoteStreamsRef.current.forEach((stream) => {
      stream.getTracks().forEach((track) => track.stop());
    });
    remoteStreamsRef.current.clear();
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
          if (oldTrack === nextTrack) return;

          if (!oldTrack) {
            // Kind absent from the previous stream (e.g. host mic publishing
            // mid screen-share): there is no RTCRtpSender to replace, so add
            // the track fresh. simple-peer's addTrack triggers renegotiation.
            try {
              peer.addTrack(nextTrack, stream);
            } catch (addErr) {
              console.error('[WebRTC] Failed to add track for peer', socketId, addErr);
            }
            return;
          }

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