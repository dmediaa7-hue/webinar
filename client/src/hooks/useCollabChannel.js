import { useEffect, useRef } from 'react';
import socket from './useSocket';
import { EVENTS } from '../utils/constants';

export default function useCollabChannel(channel, onMessage) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    const handler = ({ channel: c, payload, from, fromName }) => {
      if (c === channel) onMessageRef.current(payload, { from, fromName });
    };
    socket.on(EVENTS.COLLAB_MESSAGE, handler);
    return () => { socket.off(EVENTS.COLLAB_MESSAGE, handler); };
  }, [channel]);

  const send = (payload) => {
    socket.emit(EVENTS.COLLAB_RELAY, { channel, payload });
  };

  return { send };
}
