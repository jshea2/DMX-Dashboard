import React, { createContext, useContext, useEffect } from 'react';
import useWebSocket from '../hooks/useWebSocket';

const WebSocketContext = createContext(null);

export const WebSocketProvider = ({ children }) => {
  const websocket = useWebSocket();

  useEffect(() => {
    console.log('[WebSocketProvider] Mounted');
    return () => {
      console.log('[WebSocketProvider] Unmounting');
    };
  }, []);

  return (
    <WebSocketContext.Provider value={websocket}>
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocketContext = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocketContext must be used within a WebSocketProvider');
  }
  return context;
};
