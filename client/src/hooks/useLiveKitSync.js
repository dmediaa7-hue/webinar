import { useEffect, useRef } from 'react';
import { RoomEvent, Track } from 'livekit-client';
import useStore from '../store/useStore';

/**
 * Bridges a connected LiveKit Room into the Zustand store so the existing
 * stream-based VideoGrid keeps working unchanged.
 *
 * - TrackSubscribed  -> add track to that participant's MediaStream, mark screen share
 * - TrackUnsubscribed-> remove track (and participant when no tracks remain)
 * - TrackMuted/Unmuted-> update isMuted / isVideoOff
 * - ParticipantDisconnected -> remove from store
 * - Local mute/camera changes are read from the local participant and written to store
 */
export function useLiveKitSync(room) {
  const streamMapRef = useRef(new Map());

  useEffect(() => {
    if (!room) return;

    const getStream = (identity) => {
      let ms = streamMapRef.current.get(identity);
      if (!ms) {
        ms = new MediaStream();
        streamMapRef.current.set(identity, ms);
      }
      return ms;
    };

    const hasActiveScreen = (participant) =>
      Array.from(participant.trackPublications.values()).some(
        (p) => p.source === Track.Source.ScreenShare && p.isSubscribed && p.track
      );

    const addParticipantIfMissing = (participant) => {
      const store = useStore.getState();
      if (!store.participants.has(participant.identity)) {
        store.addParticipant({
          socketId: participant.identity,
          userId: participant.identity,
          displayName: participant.name || participant.identity,
          isHost: Boolean(participant.metadata && participant.metadata.includes('host')),
          isMuted: !participant.isMicrophoneEnabled,
          isVideoOff: !participant.isCameraEnabled,
          isScreenSharing: hasActiveScreen(participant),
          stream: null
        });
      }
    };

    const onTrackSubscribed = (track, publication, participant) => {
      if (participant.identity === room.localParticipant.identity) return;
      addParticipantIfMissing(participant);

      const ms = getStream(participant.identity);
      if (track?.mediaStreamTrack && !ms.getTracks().includes(track.mediaStreamTrack)) {
        ms.addTrack(track.mediaStreamTrack);
      }

      useStore.getState().updateParticipant(participant.identity, {
        stream: ms,
        isMuted: !participant.isMicrophoneEnabled,
        isVideoOff: !participant.isCameraEnabled,
        isScreenSharing: hasActiveScreen(participant)
      });
    };

    const onTrackUnsubscribed = (track, publication, participant) => {
      const ms = streamMapRef.current.get(participant.identity);
      if (ms && track?.mediaStreamTrack) ms.removeTrack(track.mediaStreamTrack);

      const remaining = ms?.getTracks?.().length || 0;
      useStore.getState().updateParticipant(participant.identity, {
        isScreenSharing: hasActiveScreen(participant),
        isMuted: !participant.isMicrophoneEnabled,
        isVideoOff: !participant.isCameraEnabled,
        stream: remaining > 0 ? ms : null
      });

      if (remaining === 0) {
        streamMapRef.current.delete(participant.identity);
      }
    };

    const onTrackMuted = (publication, participant) => {
      const updates =
        publication.kind === 'audio' ? { isMuted: true } : { isVideoOff: true };
      useStore.getState().updateParticipant(participant.identity, updates);
    };

    const onTrackUnmuted = (publication, participant) => {
      const updates =
        publication.kind === 'audio' ? { isMuted: false } : { isVideoOff: false };
      useStore.getState().updateParticipant(participant.identity, updates);
    };

    const onParticipantDisconnected = (participant) => {
      streamMapRef.current.delete(participant.identity);
      useStore.getState().removeParticipant(participant.identity);
      useStore.getState().removeTypingUser(participant.identity);
    };

    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    room.on(RoomEvent.TrackMuted, onTrackMuted);
    room.on(RoomEvent.TrackUnmuted, onTrackUnmuted);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);

    // Ingest tracks that were already subscribed before this effect attached
    // (e.g. joining a meeting that is already in progress).
    room.remoteParticipants.forEach((participant) => {
      addParticipantIfMissing(participant);
      const ms = getStream(participant.identity);
      participant.trackPublications.forEach((publication) => {
        const track = publication.track;
        if (publication.isSubscribed && track?.mediaStreamTrack && !ms.getTracks().includes(track.mediaStreamTrack)) {
          ms.addTrack(track.mediaStreamTrack);
        }
      });
      useStore.getState().updateParticipant(participant.identity, {
        stream: ms,
        isMuted: !participant.isMicrophoneEnabled,
        isVideoOff: !participant.isCameraEnabled,
        isScreenSharing: hasActiveScreen(participant)
      });
    });

    return () => {
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
      room.off(RoomEvent.TrackMuted, onTrackMuted);
      room.off(RoomEvent.TrackUnmuted, onTrackUnmuted);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
      streamMapRef.current.forEach((ms) => {
        ms.getTracks().forEach((t) => t.stop());
      });
      streamMapRef.current.clear();
    };
  }, [room]);

  return null;
}