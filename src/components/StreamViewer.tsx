import React, { useState, useRef, useEffect } from 'react';
import { Play, Wifi, WifiOff, AlertCircle, Video, Users, Signal } from 'lucide-react';

interface StreamViewerProps {}

const StreamViewer: React.FC<StreamViewerProps> = () => {
  const [broadcastId, setBroadcastId] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [streamQuality, setStreamQuality] = useState<'HD' | 'SD' | 'LOW'>('HD');
  const [isDemoMode, setIsDemoMode] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);

  // WebRTC configuration
  const rtcConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // Helper function to construct WebSocket URLs for webcontainer environment
  const getWebSocketUrl = (port: number, path: string): string => {
    const hostname = window.location.hostname;
    // In webcontainer, replace the current port with the service port
    const wsHostname = hostname.replace(/--\d+--/, `--${port}--`);
    return `ws://${wsHostname}${path}`;
  };

  const connectToStream = async () => {
    if (!broadcastId.trim()) {
      setError('Please enter a valid Broadcast ID');
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      // First try WebRTC connection
      await connectWebRTC();
    } catch (webrtcError) {
      console.warn('WebRTC failed, falling back to WebSocket:', webrtcError);
      try {
        await connectWebSocket();
      } catch (wsError) {
        console.error('Both WebRTC and WebSocket failed:', wsError);
        setError('Failed to connect to stream. Please check the Broadcast ID and try again.');
        setIsConnecting(false);
      }
    }
  };

  const connectWebRTC = async (): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      try {
        // Create WebSocket signaling connection
        const signalingWs = new WebSocket(getWebSocketUrl(8080, `/signaling/viewer/${broadcastId}`));
        
        signalingWs.onopen = () => {
          console.log('Signaling WebSocket connected');
        };

        signalingWs.onerror = () => {
          reject(new Error('Signaling connection failed'));
        };

        // Create peer connection
        const peerConnection = new RTCPeerConnection(rtcConfiguration);
        peerConnectionRef.current = peerConnection;

        // Handle incoming stream
        peerConnection.ontrack = (event) => {
          console.log('Received remote stream');
          if (videoRef.current && event.streams[0]) {
            videoRef.current.srcObject = event.streams[0];
            setIsConnected(true);
            setIsConnecting(false);
            resolve();
          }
        };

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
          if (event.candidate) {
            signalingWs.send(JSON.stringify({
              type: 'ice-candidate',
              candidate: event.candidate,
              broadcastId
            }));
          }
        };

        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
          console.log('Connection state:', peerConnection.connectionState);
          if (peerConnection.connectionState === 'failed') {
            reject(new Error('WebRTC connection failed'));
          }
        };

        // Handle signaling messages
        signalingWs.onmessage = async (event) => {
          const message = JSON.parse(event.data);
          
          switch (message.type) {
            case 'offer':
              await peerConnection.setRemoteDescription(message.offer);
              const answer = await peerConnection.createAnswer();
              await peerConnection.setLocalDescription(answer);
              signalingWs.send(JSON.stringify({
                type: 'answer',
                answer,
                broadcastId
              }));
              break;
              
            case 'ice-candidate':
              await peerConnection.addIceCandidate(message.candidate);
              break;
              
            case 'stream-info':
              setViewerCount(message.viewerCount || 0);
              setStreamQuality(message.quality || 'HD');
              break;
              
            case 'error':
              reject(new Error(message.message || 'Stream connection failed'));
              break;
              
            case 'stream-ended':
              setError('Stream has ended');
              disconnect();
              break;
          }
        };

        // Request to join stream
        signalingWs.onopen = () => {
          signalingWs.send(JSON.stringify({
            type: 'join-stream',
            broadcastId
          }));
        };

      } catch (error) {
        reject(error);
      }
    });
  };

  const connectWebSocket = async (): Promise<void> => {
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(getWebSocketUrl(8081, `/stream/${broadcastId}`));
        websocketRef.current = ws;

        ws.onopen = () => {
          console.log('WebSocket stream connected');
          setIsConnected(true);
          setIsConnecting(false);
          resolve();
        };

        ws.onmessage = (event) => {
          // Handle binary video data
          if (event.data instanceof Blob) {
            const url = URL.createObjectURL(event.data);
            if (videoRef.current) {
              videoRef.current.src = url;
            }
          } else {
            // Handle JSON messages
            try {
              const message = JSON.parse(event.data);
              if (message.type === 'stream-info') {
                setViewerCount(message.viewerCount || 0);
                setStreamQuality(message.quality || 'HD');
              } else if (message.type === 'error') {
                setError(message.message);
                reject(new Error(message.message));
              }
            } catch (e) {
              console.warn('Received non-JSON message:', event.data);
            }
          }
        };

        ws.onerror = () => {
          reject(new Error('WebSocket connection failed'));
        };

        ws.onclose = () => {
          setIsConnected(false);
          setError('Connection lost');
        };

      } catch (error) {
        reject(error);
      }
    });
  };

  const disconnect = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    if (websocketRef.current) {
      websocketRef.current.close();
      websocketRef.current = null;
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.src = '';
    }
    
    setIsConnected(false);
    setIsConnecting(false);
    setError(null);
    setViewerCount(0);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  const getStatusColor = () => {
    if (error) return 'text-red-400';
    if (isConnected) return 'text-emerald-400';
    if (isConnecting) return 'text-amber-400';
    return 'text-slate-400';
  };

  const getStatusIcon = () => {
    if (error) return <WifiOff className="w-5 h-5 text-red-400" />;
    if (isConnected) return <Signal className="w-5 h-5 text-emerald-400" />;
    if (isConnecting) return <Wifi className="w-5 h-5 text-amber-400 animate-pulse" />;
    return <Video className="w-5 h-5 text-slate-400" />;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-purple-950 text-white">
      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      {/* Header */}
      <div className="relative bg-black/30 backdrop-blur-xl border-b border-cyan-500/20 p-6 shadow-2xl">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="relative">
              <Video className="w-10 h-10 text-cyan-400" />
              <div className="absolute -inset-1 bg-cyan-400/20 rounded-full blur animate-pulse" />
            </div>
            <div>
              <h1 className="text-3xl font-black bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
                LIVE STREAM VIEWER
              </h1>
              <p className="text-cyan-300/70 text-sm font-medium">Watch live broadcasts in real-time</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-3 bg-black/40 backdrop-blur-sm rounded-xl px-4 py-2 border border-cyan-500/20">
              {getStatusIcon()}
              <div>
                <span className={`font-bold text-sm ${getStatusColor()}`}>
                  {error ? 'Error' : isConnected ? 'Connected' : isConnecting ? 'Connecting' : 'Disconnected'}
                </span>
                {isConnected && (
                  <div className="text-xs text-cyan-300/70">
                    {streamQuality} Quality
                  </div>
                )}
              </div>
            </div>
            
            {isConnected && viewerCount > 0 && (
              <div className="flex items-center space-x-3 bg-black/40 backdrop-blur-sm rounded-xl px-4 py-2 border border-emerald-500/20">
                <Users className="w-4 h-4 text-emerald-400" />
                <div className="text-emerald-300 text-sm font-semibold">
                  {viewerCount} viewer{viewerCount !== 1 ? 's' : ''}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="relative max-w-6xl mx-auto p-8">
        {/* Connection Form */}
        {!isConnected && (
          <div className="mb-8 bg-gradient-to-br from-slate-900/80 via-slate-800/80 to-slate-900/80 backdrop-blur-xl rounded-3xl p-8 border border-cyan-500/20 shadow-2xl">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-white mb-2">Enter Broadcast ID</h2>
              <p className="text-cyan-300/70">Connect to a live stream using the broadcaster's unique ID</p>
            </div>
            
            <div className="max-w-md mx-auto space-y-6">
              <div>
                <input
                  type="text"
                  value={broadcastId}
                  onChange={(e) => setBroadcastId(e.target.value)}
                  placeholder="e.g., ABC123XYZ"
                  className="w-full px-6 py-4 bg-black/40 border border-cyan-500/30 rounded-2xl text-white placeholder-cyan-300/50 
                           focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/20 transition-all
                           text-center text-lg font-mono tracking-wider"
                  disabled={isConnecting}
                />
              </div>
              
              <button
                onClick={connectToStream}
                disabled={isConnecting || !broadcastId.trim()}
                className="w-full group relative px-8 py-4 bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 text-white font-bold text-lg rounded-2xl 
                         hover:from-cyan-600 hover:via-blue-600 hover:to-purple-600 disabled:opacity-50 disabled:cursor-not-allowed
                         transform hover:scale-105 transition-all duration-300 shadow-2xl hover:shadow-cyan-500/50
                         border border-cyan-400/30"
              >
                <div className="absolute -inset-1 bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 rounded-2xl blur opacity-30 group-hover:opacity-50 transition-opacity" />
                <div className="relative flex items-center justify-center space-x-3">
                  {isConnecting ? (
                    <>
                      <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>CONNECTING...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-6 h-6" />
                      <span>🔴 CONNECT TO STREAM</span>
                    </>
                  )}
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="mb-8 bg-gradient-to-r from-red-900/80 to-red-800/80 backdrop-blur-xl rounded-2xl p-6 border border-red-500/30 shadow-2xl">
            <div className="flex items-center space-x-3">
              <AlertCircle className="w-6 h-6 text-red-400 flex-shrink-0" />
              <div>
                <h3 className="font-bold text-red-300 mb-1">Connection Error</h3>
                <p className="text-red-200/80">{error}</p>
              </div>
            </div>
            <button
              onClick={() => {
                setError(null);
                disconnect();
              }}
              className="mt-4 px-4 py-2 bg-red-600/80 hover:bg-red-600 rounded-xl text-white font-semibold transition-colors"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Video Player */}
        <div className="bg-gradient-to-br from-slate-900/80 via-slate-800/80 to-slate-900/80 backdrop-blur-xl rounded-3xl p-8 border border-cyan-500/20 shadow-2xl">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-3">
              <div className="relative">
                <Video className="w-8 h-8 text-cyan-400" />
                <div className="absolute -inset-1 bg-cyan-400/20 rounded-full blur animate-pulse" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">Live Video Stream</h2>
                {broadcastId && (
                  <p className="text-cyan-300/70 text-sm">Broadcast ID: <span className="font-mono">{broadcastId}</span></p>
                )}
              </div>
            </div>
            
            {isConnected && (
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2 bg-red-500/20 rounded-xl px-3 py-1 border border-red-500/30">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-red-300 text-sm font-semibold">LIVE</span>
                </div>
                <div className="flex items-center space-x-2 bg-blue-500/20 rounded-xl px-3 py-1 border border-blue-500/30">
                  <Signal className="w-4 h-4 text-blue-400" />
                  <span className="text-blue-300 text-sm font-semibold">{streamQuality}</span>
                </div>
              </div>
            )}
          </div>
          
          <div className="relative bg-black/60 rounded-2xl overflow-hidden aspect-video border border-cyan-500/10 shadow-inner">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
              onLoadStart={() => console.log('Video loading started')}
              onCanPlay={() => console.log('Video can play')}
              onError={(e) => {
                console.error('Video error:', e);
                setError('Video playback error');
              }}
            />
            
            {!isConnected && !isConnecting && !error && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="relative mb-6">
                    <Video className="w-24 h-24 text-cyan-400/50 mx-auto" />
                    <div className="absolute -inset-2 bg-cyan-400/10 rounded-full blur-xl animate-pulse" />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2">Ready to Connect</h3>
                  <p className="text-cyan-300/70">Enter a Broadcast ID above to start watching</p>
                </div>
              </div>
            )}
            
            {isConnecting && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <div className="text-center">
                  <div className="w-16 h-16 border-4 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin mx-auto mb-4" />
                  <h3 className="text-xl font-semibold text-white mb-2">Connecting to Stream</h3>
                  <p className="text-cyan-300/70">Establishing connection with broadcaster...</p>
                </div>
              </div>
            )}
          </div>
          
          {isConnected && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={disconnect}
                className="px-6 py-3 bg-gradient-to-r from-red-500 to-red-600 text-white font-semibold rounded-xl 
                         hover:from-red-600 hover:to-red-700 transition-all duration-300 shadow-lg hover:shadow-red-500/25"
              >
                Disconnect
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StreamViewer;