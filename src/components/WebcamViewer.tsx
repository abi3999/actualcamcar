import React, { useState, useRef, useEffect } from 'react';
import { 
  Play, 
  Square, 
  Wifi, 
  WifiOff, 
  AlertCircle, 
  Video, 
  Users, 
  Signal,
  Eye,
  Monitor,
  Loader2
} from 'lucide-react';

interface WebcamViewerProps {}

const WebcamViewer: React.FC<WebcamViewerProps> = () => {
  const [broadcastId, setBroadcastId] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [streamQuality, setStreamQuality] = useState<'HD' | 'SD' | 'LOW'>('HD');
  const [connectionType, setConnectionType] = useState<'WebRTC' | 'WebSocket' | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const signalingWsRef = useRef<WebSocket | null>(null);

  // WebRTC configuration with STUN servers
  const rtcConfiguration: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ],
    iceCandidatePoolSize: 10
  };

  // Helper function to construct WebSocket URLs for webcontainer environment
  const getWebSocketUrl = (port: number, path: string): string => {
    const hostname = window.location.hostname;
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
    setConnectionType(null);

    try {
      // First try WebRTC connection
      console.log('Attempting WebRTC connection...');
      await connectWebRTC();
      setConnectionType('WebRTC');
    } catch (webrtcError) {
      console.warn('WebRTC failed, trying WebSocket fallback:', webrtcError);
      try {
        await connectWebSocket();
        setConnectionType('WebSocket');
      } catch (wsError) {
        console.error('Both WebRTC and WebSocket failed:', wsError);
        setError('Unable to connect to stream. Please check the Broadcast ID and ensure the broadcaster is active.');
        setIsConnecting(false);
      }
    }
  };

  const connectWebRTC = async (): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      try {
        // Create WebSocket signaling connection
        const signalingUrl = getWebSocketUrl(8080, `/signaling/viewer/${broadcastId}`);
        console.log('Connecting to signaling server:', signalingUrl);
        
        const signalingWs = new WebSocket(signalingUrl);
        signalingWsRef.current = signalingWs;
        
        let connectionTimeout = setTimeout(() => {
          reject(new Error('Signaling connection timeout'));
        }, 10000);

        signalingWs.onopen = () => {
          console.log('Signaling WebSocket connected');
          clearTimeout(connectionTimeout);
          
          // Send join request
          signalingWs.send(JSON.stringify({
            type: 'join-stream',
            broadcastId: broadcastId.trim()
          }));
        };

        signalingWs.onerror = (event) => {
          console.error('Signaling WebSocket error:', event);
          clearTimeout(connectionTimeout);
          reject(new Error('Signaling server connection failed'));
        };

        // Create peer connection
        const peerConnection = new RTCPeerConnection(rtcConfiguration);
        peerConnectionRef.current = peerConnection;

        // Handle incoming stream
        peerConnection.ontrack = (event) => {
          console.log('Received remote stream tracks:', event.streams.length);
          if (videoRef.current && event.streams[0]) {
            videoRef.current.srcObject = event.streams[0];
            setIsConnected(true);
            setIsConnecting(false);
            setViewerCount(prev => prev + 1);
            resolve();
          }
        };

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
          if (event.candidate && signalingWs.readyState === WebSocket.OPEN) {
            signalingWs.send(JSON.stringify({
              type: 'ice-candidate',
              candidate: event.candidate,
              broadcastId: broadcastId.trim()
            }));
          }
        };

        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
          console.log('WebRTC connection state:', peerConnection.connectionState);
          
          switch (peerConnection.connectionState) {
            case 'connected':
              setIsConnected(true);
              setIsConnecting(false);
              break;
            case 'disconnected':
            case 'failed':
              setError('Connection lost or failed');
              setIsConnected(false);
              break;
            case 'closed':
              setIsConnected(false);
              break;
          }
        };

        // Handle signaling messages
        signalingWs.onmessage = async (event) => {
          try {
            const message = JSON.parse(event.data);
            console.log('Received signaling message:', message.type);
            
            switch (message.type) {
              case 'offer':
                await peerConnection.setRemoteDescription(new RTCSessionDescription(message.offer));
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                
                signalingWs.send(JSON.stringify({
                  type: 'answer',
                  answer: answer,
                  broadcastId: broadcastId.trim()
                }));
                break;
                
              case 'ice-candidate':
                if (message.candidate) {
                  await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
                }
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
                
              case 'stream-not-found':
                reject(new Error('Broadcast ID not found. Please check the ID and try again.'));
                break;
            }
          } catch (parseError) {
            console.error('Error parsing signaling message:', parseError);
          }
        };

        signalingWs.onclose = () => {
          console.log('Signaling WebSocket closed');
          if (isConnected) {
            setError('Signaling connection lost');
          }
        };

      } catch (error) {
        console.error('WebRTC setup error:', error);
        reject(error);
      }
    });
  };

  const connectWebSocket = async (): Promise<void> => {
    return new Promise((resolve, reject) => {
      try {
        const streamUrl = getWebSocketUrl(8081, `/stream/${broadcastId.trim()}`);
        console.log('Connecting to WebSocket stream:', streamUrl);
        
        const ws = new WebSocket(streamUrl);
        websocketRef.current = ws;

        let connectionTimeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
        }, 10000);

        ws.onopen = () => {
          console.log('WebSocket stream connected');
          clearTimeout(connectionTimeout);
          setIsConnected(true);
          setIsConnecting(false);
          resolve();
        };

        ws.onmessage = (event) => {
          if (event.data instanceof Blob) {
            // Handle binary video data (JPEG frames)
            const url = URL.createObjectURL(event.data);
            if (videoRef.current) {
              videoRef.current.src = url;
              // Clean up previous object URL to prevent memory leaks
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
          } else {
            // Handle JSON messages
            try {
              const message = JSON.parse(event.data);
              switch (message.type) {
                case 'stream-info':
                  setViewerCount(message.viewerCount || 0);
                  setStreamQuality(message.quality || 'HD');
                  break;
                case 'error':
                  setError(message.message);
                  reject(new Error(message.message));
                  break;
                case 'stream-ended':
                  setError('Stream has ended');
                  disconnect();
                  break;
              }
            } catch (parseError) {
              console.warn('Received non-JSON WebSocket message');
            }
          }
        };

        ws.onerror = (event) => {
          console.error('WebSocket error:', event);
          clearTimeout(connectionTimeout);
          reject(new Error('WebSocket connection failed'));
        };

        ws.onclose = (event) => {
          console.log('WebSocket closed:', event.code, event.reason);
          setIsConnected(false);
          if (event.code !== 1000) { // Not a normal closure
            setError('Connection lost');
          }
        };

      } catch (error) {
        console.error('WebSocket setup error:', error);
        reject(error);
      }
    });
  };

  const disconnect = () => {
    console.log('Disconnecting from stream...');
    
    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    // Close signaling WebSocket
    if (signalingWsRef.current) {
      signalingWsRef.current.close();
      signalingWsRef.current = null;
    }
    
    // Close streaming WebSocket
    if (websocketRef.current) {
      websocketRef.current.close();
      websocketRef.current = null;
    }
    
    // Clear video
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.src = '';
    }
    
    setIsConnected(false);
    setIsConnecting(false);
    setError(null);
    setViewerCount(0);
    setConnectionType(null);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  // Handle Enter key in input
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isConnecting && broadcastId.trim()) {
      connectToStream();
    }
  };

  const getStatusColor = () => {
    if (error) return 'text-red-400';
    if (isConnected) return 'text-emerald-400';
    if (isConnecting) return 'text-amber-400';
    return 'text-slate-400';
  };

  const getStatusIcon = () => {
    if (error) return <WifiOff className="w-5 h-5 text-red-400" />;
    if (isConnected) return <Signal className="w-5 h-5 text-emerald-400" />;
    if (isConnecting) return <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />;
    return <Video className="w-5 h-5 text-slate-400" />;
  };

  const getStatusText = () => {
    if (error) return 'Error';
    if (isConnected) return 'Connected';
    if (isConnecting) return 'Connecting';
    return 'Disconnected';
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
              <Eye className="w-10 h-10 text-cyan-400" />
              <div className="absolute -inset-1 bg-cyan-400/20 rounded-full blur animate-pulse" />
            </div>
            <div>
              <h1 className="text-3xl font-black bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
                WEBCAM VIEWER
              </h1>
              <p className="text-cyan-300/70 text-sm font-medium">Watch live webcam broadcasts</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-6">
            {/* Connection Status */}
            <div className="flex items-center space-x-3 bg-black/40 backdrop-blur-sm rounded-xl px-4 py-2 border border-cyan-500/20">
              {getStatusIcon()}
              <div>
                <span className={`font-bold text-sm ${getStatusColor()}`}>
                  {getStatusText()}
                </span>
                {connectionType && (
                  <div className="text-xs text-cyan-300/70">
                    via {connectionType}
                  </div>
                )}
              </div>
            </div>
            
            {/* Viewer Count */}
            {isConnected && viewerCount > 0 && (
              <div className="flex items-center space-x-3 bg-black/40 backdrop-blur-sm rounded-xl px-4 py-2 border border-emerald-500/20">
                <Users className="w-4 h-4 text-emerald-400" />
                <div className="text-emerald-300 text-sm font-semibold">
                  {viewerCount} viewer{viewerCount !== 1 ? 's' : ''}
                </div>
              </div>
            )}

            {/* Stream Quality */}
            {isConnected && (
              <div className="flex items-center space-x-3 bg-black/40 backdrop-blur-sm rounded-xl px-4 py-2 border border-blue-500/20">
                <Monitor className="w-4 h-4 text-blue-400" />
                <div className="text-blue-300 text-sm font-semibold">
                  {streamQuality}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="relative max-w-6xl mx-auto p-8">
        {/* Connection Form */}
        <div className="mb-8 bg-gradient-to-br from-slate-900/80 via-slate-800/80 to-slate-900/80 backdrop-blur-xl rounded-3xl p-8 border border-cyan-500/20 shadow-2xl">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-white mb-2">Enter Broadcast ID</h2>
            <p className="text-cyan-300/70">Connect to a live webcam stream using the broadcaster's unique ID</p>
          </div>
          
          <div className="max-w-md mx-auto space-y-6">
            <div className="relative">
              <input
                type="text"
                value={broadcastId}
                onChange={(e) => setBroadcastId(e.target.value.toUpperCase())}
                onKeyPress={handleKeyPress}
                placeholder="e.g., ABC123XYZ"
                className="w-full px-6 py-4 bg-black/40 border border-cyan-500/30 rounded-2xl text-white placeholder-cyan-300/50 
                         focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/20 transition-all
                         text-center text-lg font-mono tracking-wider uppercase"
                disabled={isConnecting}
                maxLength={20}
              />
              {broadcastId && (
                <div className="absolute right-4 top-1/2 transform -translate-y-1/2">
                  <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
                </div>
              )}
            </div>
            
            <div className="flex space-x-4">
              {!isConnected ? (
                <button
                  onClick={connectToStream}
                  disabled={isConnecting || !broadcastId.trim()}
                  className="flex-1 group relative px-8 py-4 bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 text-white font-bold text-lg rounded-2xl 
                           hover:from-cyan-600 hover:via-blue-600 hover:to-purple-600 disabled:opacity-50 disabled:cursor-not-allowed
                           transform hover:scale-105 transition-all duration-300 shadow-2xl hover:shadow-cyan-500/50
                           border border-cyan-400/30"
                >
                  <div className="absolute -inset-1 bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 rounded-2xl blur opacity-30 group-hover:opacity-50 transition-opacity" />
                  <div className="relative flex items-center justify-center space-x-3">
                    {isConnecting ? (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin" />
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
              ) : (
                <button
                  onClick={disconnect}
                  className="flex-1 group relative px-8 py-4 bg-gradient-to-r from-red-500 to-red-600 text-white font-bold text-lg rounded-2xl 
                           hover:from-red-600 hover:to-red-700 transition-all duration-300 shadow-2xl hover:shadow-red-500/50
                           border border-red-400/30"
                >
                  <div className="absolute -inset-1 bg-gradient-to-r from-red-400 to-red-500 rounded-2xl blur opacity-30 group-hover:opacity-50 transition-opacity" />
                  <div className="relative flex items-center justify-center space-x-3">
                    <Square className="w-6 h-6" />
                    <span>DISCONNECT</span>
                  </div>
                </button>
              )}
            </div>

            {/* Current Broadcast ID Display */}
            {isConnected && broadcastId && (
              <div className="text-center p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                <div className="text-emerald-300 text-sm font-semibold mb-1">Currently Viewing</div>
                <div className="text-white font-mono text-lg tracking-wider">{broadcastId}</div>
              </div>
            )}
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-8 bg-gradient-to-r from-red-900/80 to-red-800/80 backdrop-blur-xl rounded-2xl p-6 border border-red-500/30 shadow-2xl">
            <div className="flex items-start space-x-3">
              <AlertCircle className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-bold text-red-300 mb-2">Connection Error</h3>
                <p className="text-red-200/80 text-sm leading-relaxed mb-4">{error}</p>
                
                <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-600/30">
                  <h4 className="text-cyan-300 font-semibold mb-2">Troubleshooting Tips:</h4>
                  <ul className="text-slate-300 text-sm space-y-1">
                    <li>• Verify the Broadcast ID is correct and active</li>
                    <li>• Ensure the broadcaster is currently streaming</li>
                    <li>• Check your internet connection</li>
                    <li>• Try refreshing the page and reconnecting</li>
                  </ul>
                </div>
                
                <button
                  onClick={() => {
                    setError(null);
                    if (broadcastId.trim()) {
                      connectToStream();
                    }
                  }}
                  className="mt-4 px-6 py-2 bg-red-600/80 hover:bg-red-600 rounded-xl text-white font-semibold transition-colors"
                >
                  Try Again
                </button>
              </div>
            </div>
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
                <h2 className="text-2xl font-bold text-white">Live Webcam Stream</h2>
                <p className="text-cyan-300/70 text-sm">Real-time video from broadcaster</p>
              </div>
            </div>
            
            {isConnected && (
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2 bg-red-500/20 rounded-xl px-3 py-1 border border-red-500/30">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-red-300 text-sm font-semibold">LIVE</span>
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
                console.error('Video playback error:', e);
                setError('Video playback error occurred');
              }}
            />
            
            {/* Placeholder when not connected */}
            {!isConnected && !isConnecting && !error && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="relative mb-6">
                    <Eye className="w-24 h-24 text-cyan-400/50 mx-auto" />
                    <div className="absolute -inset-2 bg-cyan-400/10 rounded-full blur-xl animate-pulse" />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2">Ready to Watch</h3>
                  <p className="text-cyan-300/70">Enter a Broadcast ID above to start viewing</p>
                </div>
              </div>
            )}
            
            {/* Connecting state */}
            {isConnecting && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <div className="text-center">
                  <Loader2 className="w-16 h-16 text-cyan-400 animate-spin mx-auto mb-4" />
                  <h3 className="text-xl font-semibold text-white mb-2">Connecting to Stream</h3>
                  <p className="text-cyan-300/70">Establishing connection with broadcaster...</p>
                  <div className="mt-4 text-sm text-cyan-400/80">
                    Broadcast ID: <span className="font-mono">{broadcastId}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Stream overlay info */}
            {isConnected && (
              <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-sm rounded-xl px-3 py-2 border border-cyan-500/20">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-white text-sm font-semibold">LIVE</span>
                  {connectionType && (
                    <span className="text-cyan-300 text-xs">• {connectionType}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WebcamViewer;