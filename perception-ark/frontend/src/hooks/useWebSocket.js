import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * WebSocket Hook - 实时接收Agent事件
 * 自动重连 · 事件订阅 · 防止StrictMode双挂载导致重复连接
 */
export function useWebSocket(onEvent) {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState([]);
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const manualCloseRef = useRef(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
    manualCloseRef.current = false;

    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    // 生产环境: 通过 VITE_API_BASE 指向后端域名
    // 开发环境: 走Vite代理当前host
    const apiBase = import.meta.env.VITE_API_BASE;
    const wsHost = apiBase ? apiBase.replace(/^https?:\/\//, '') : location.host;
    const wsUrl = `${protocol}://${wsHost}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
      };

      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          setEvents(prev => [...prev.slice(-99), event]);
          if (onEventRef.current) onEventRef.current(event);
        } catch (err) {
          // 静默忽略非JSON消息
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (!manualCloseRef.current) {
          reconnectTimer.current = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        // onclose会随后触发,不在此重复处理
        try { ws.close(); } catch (e) {}
      };
    } catch (err) {
      if (!manualCloseRef.current) {
        reconnectTimer.current = setTimeout(connect, 3000);
      }
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      manualCloseRef.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch (e) {}
        wsRef.current = null;
      }
    };
  }, [connect]);

  const send = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { connected, events, send };
}
