import React, { useState, useEffect } from 'react';
import { Camera, Navigation, Power, Wifi, WifiOff, Download, Trash2, Zap, Activity, Signal } from 'lucide-react';
import { useMQTT } from '../hooks/useMQTT';

interface CapturedImage {
  id: string;
  base64: string;
  timestamp: string;
}

const RemoteVehicleControl = () => {
  const { isConnected, connectionStatus, publishMessage, lastMessage, error } = useMQTT();
  const [videoStream, setVideoStream] = useState<string>('');
  const [capturedImages, setCapturedImages] = useState<CapturedImage[]>([]);
  const [activeControls, setActiveControls] = useState<Set<string>>(new Set());
  const [frameCount, setFrameCount] = useState(0);

  // Handle incoming MQTT messages
  useEffect(() => {
    if (lastMessage) {
      const { topic, message } = lastMessage;
      
      if (topic === 'userxyz/device/cam/stream') {
        setVideoStream(`data:image/jpeg;base64,${message}`);
        setFrameCount(prev => prev + 1);
      } else if (topic === 'userxyz/device/cam/capture') {
        const newImage: CapturedImage = {
          id: Date.now().toString(),
          base64: `data:image/jpeg;base64,${message}`,
          timestamp: new Date().toISOString(),
        };
        setCapturedImages(prev => [newImage, ...prev]);
      }
    }
  }, [lastMessage]);

  const handleControlPress = (direction: string) => {
    const topic = `userxyz/device/control/${direction}`;
    if (publishMessage(topic, '1')) {
      setActiveControls(prev => new Set([...prev, direction]));
    }
  };

  const handleControlRelease = (direction: string) => {
    const topic = `userxyz/device/control/${direction}`;
    if (publishMessage(topic, '0')) {
      setActiveControls(prev => {
        const newSet = new Set(prev);
        newSet.delete(direction);
        return newSet;
      });
    }
  };

  const handleCapture = () => {
    publishMessage('userxyz/device/cam/capture', '1');
  };

  const downloadImage = (image: CapturedImage) => {
    const link = document.createElement('a');
    link.href = image.base64;
    link.download = `esp32cam_${new Date(image.timestamp).toISOString().replace(/[:.]/g, '-')}.jpg`;
    link.click();
  };

  const deleteImage = (imageId: string) => {
    setCapturedImages(prev => prev.filter(img => img.id !== imageId));
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'Connected': return 'text-emerald-400';
      case 'Connecting': return 'text-amber-400';
      case 'Reconnecting': return 'text-orange-400';
      default: return 'text-red-400';
    }
  };

  const getStatusIcon = () => {
    switch (connectionStatus) {
      case 'Connected': return <Signal className="w-5 h-5 text-emerald-400" />;
      case 'Connecting': return <Activity className="w-5 h-5 text-amber-400 animate-pulse" />;
      case 'Reconnecting': return <Activity className="w-5 h-5 text-orange-400 animate-spin" />;
      default: return <WifiOff className="w-5 h-5 text-red-400" />;
    }
  };

  const ControlButton = ({ direction, label, icon, className = '' }: { 
    direction: string; 
    label: string; 
    icon: string;
    className?: string 
  }) => {
    const isActive = activeControls.has(direction);
    
    return (
      <button
        className={`
          relative group px-6 py-6 rounded-2xl font-bold text-lg transition-all duration-200
          ${isActive 
            ? 'bg-gradient-to-br from-cyan-400 via-blue-500 to-purple-600 text-white scale-95 shadow-2xl shadow-cyan-500/50' 
            : 'bg-gradient-to-br from-slate-800/80 via-slate-700/80 to-slate-800/80 text-cyan-300 hover:from-slate-700/90 hover:to-slate-600/90 hover:text-white'
          }
          border-2 ${isActive ? 'border-cyan-300/50' : 'border-cyan-500/30 hover:border-cyan-400/60'}
          backdrop-blur-sm shadow-lg hover:shadow-xl hover:shadow-cyan-500/25
          active:scale-90 select-none transform hover:scale-105 ${className}
        `}
        onMouseDown={() => handleControlPress(direction)}
        onMouseUp={() => handleControlRelease(direction)}
        onMouseLeave={() => handleControlRelease(direction)}
        onTouchStart={() => handleControlPress(direction)}
        onTouchEnd={() => handleControlRelease(direction)}
        disabled={!isConnected}
      >
        <div className={`absolute inset-0 rounded-2xl bg-gradient-to-r from-cyan-500/0 via-cyan-400/30 to-purple-500/0 ${isActive ? 'opacity-100' : 'opacity-0'} transition-opacity`} />
        <div className="relative z-10 flex flex-col items-center space-y-2">
          <span className="text-3xl">{icon}</span>
          <span className="text-sm font-semibold">{label}</span>
        </div>
        {isActive && (
          <>
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-cyan-400/20 via-blue-500/20 to-purple-600/20 animate-pulse" />
            <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-600 opacity-30 blur animate-pulse" />
          </>
        )}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-purple-950 text-white overflow-hidden">
      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      {/* Header */}
      <div className="relative bg-black/30 backdrop-blur-xl border-b border-cyan-500/20 p-6 shadow-2xl">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="relative">
              <Navigation className="w-10 h-10 text-cyan-400" />
              <div className="absolute -inset-1 bg-cyan-400/20 rounded-full blur animate-pulse" />
            </div>
            <div>
              <h1 className="text-3xl font-black bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
                ESP32-CAM CONTROL HUB
              </h1>
              <p className="text-cyan-300/70 text-sm font-medium">Remote Vehicle Command Center</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-3 bg-black/40 backdrop-blur-sm rounded-xl px-4 py-2 border border-cyan-500/20">
              {getStatusIcon()}
              <div>
                <span className={`font-bold text-sm ${getStatusColor()}`}>
                  {connectionStatus}
                </span>
                {frameCount > 0 && (
                  <div className="text-xs text-cyan-300/70">
                    {frameCount} frames
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center space-x-3 bg-black/40 backdrop-blur-sm rounded-xl px-4 py-2 border border-emerald-500/20">
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              <div className="text-xs text-emerald-300">
                <div className="font-semibold">HiveMQ Cloud</div>
                <div className="opacity-80">Serverless Cluster</div>
              </div>
            </div>
            {error && (
              <div className="bg-red-500/20 border border-red-500/30 rounded-xl px-4 py-2 text-red-300 text-sm max-w-xs">
                <div className="font-semibold">Connection Error</div>
                <div className="text-xs opacity-80">{error}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="relative max-w-7xl mx-auto p-8">
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
          {/* Video Stream - Takes up more space */}
          <div className="xl:col-span-3">
            <div className="bg-gradient-to-br from-slate-900/80 via-slate-800/80 to-slate-900/80 backdrop-blur-xl rounded-3xl p-8 border border-cyan-500/20 shadow-2xl">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center space-x-3">
                  <div className="relative">
                    <Camera className="w-8 h-8 text-cyan-400" />
                    <div className="absolute -inset-1 bg-cyan-400/20 rounded-full blur animate-pulse" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white">Live Video Stream</h2>
                    <p className="text-cyan-300/70 text-sm">Real-time ESP32-CAM feed</p>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-2 bg-emerald-500/20 rounded-xl px-3 py-1 border border-emerald-500/30">
                    <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                    <span className="text-emerald-300 text-sm font-semibold">30 FPS</span>
                  </div>
                  <div className="flex items-center space-x-2 bg-blue-500/20 rounded-xl px-3 py-1 border border-blue-500/30">
                    <Zap className="w-4 h-4 text-blue-400" />
                    <span className="text-blue-300 text-sm font-semibold">HD Quality</span>
                  </div>
                </div>
              </div>
              
              <div className="relative bg-black/60 rounded-2xl overflow-hidden aspect-video border border-cyan-500/10 shadow-inner">
                {videoStream ? (
                  <img 
                    src={videoStream} 
                    alt="ESP32-CAM Live Stream" 
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <div className="relative mb-6">
                        <Camera className="w-24 h-24 text-cyan-400/50 mx-auto" />
                        <div className="absolute -inset-2 bg-cyan-400/10 rounded-full blur-xl animate-pulse" />
                      </div>
                      <h3 className="text-xl font-semibold text-white mb-2">
                        {isConnected ? 'Waiting for video stream...' : 'Connecting to ESP32-CAM...'}
                      </h3>
                      <p className="text-cyan-300/70">
                        {isConnected ? 'Make sure your ESP32-CAM is publishing to userxyz/device/cam/stream' : 'Establishing MQTT connection...'}
                      </p>
                    </div>
                  </div>
                )}
                
                {/* Stream overlay info */}
                {videoStream && (
                  <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-sm rounded-xl px-3 py-2 border border-cyan-500/20">
                    <div className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                      <span className="text-white text-sm font-semibold">LIVE</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Capture Button */}
              <div className="mt-8 text-center">
                <button
                  onClick={handleCapture}
                  disabled={!isConnected}
                  className="group relative px-10 py-4 bg-gradient-to-r from-emerald-500 via-green-500 to-teal-500 text-white font-bold text-lg rounded-2xl 
                           hover:from-emerald-600 hover:via-green-600 hover:to-teal-600 disabled:opacity-50 disabled:cursor-not-allowed
                           transform hover:scale-105 transition-all duration-300 shadow-2xl hover:shadow-emerald-500/50
                           border border-emerald-400/30"
                >
                  <div className="absolute -inset-1 bg-gradient-to-r from-emerald-400 via-green-400 to-teal-400 rounded-2xl blur opacity-30 group-hover:opacity-50 transition-opacity" />
                  <div className="relative flex items-center space-x-3">
                    <Camera className="w-6 h-6" />
                    <span>📸 CAPTURE HIGH-RES PHOTO</span>
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* Controls Sidebar */}
          <div className="space-y-8">
            {/* Movement Controls */}
            <div className="bg-gradient-to-br from-slate-900/80 via-slate-800/80 to-slate-900/80 backdrop-blur-xl rounded-3xl p-6 border border-cyan-500/20 shadow-2xl">
              <div className="flex items-center space-x-3 mb-6">
                <div className="relative">
                  <Power className="w-7 h-7 text-cyan-400" />
                  <div className="absolute -inset-1 bg-cyan-400/20 rounded-full blur animate-pulse" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Vehicle Controls</h2>
                  <p className="text-cyan-300/70 text-sm">Remote movement</p>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-3">
                <div></div>
                <ControlButton direction="front" label="FRONT" icon="⬆️" />
                <div></div>
                
                <ControlButton direction="left" label="LEFT" icon="⬅️" />
                <div className="flex flex-col gap-3">
                  <ControlButton direction="up" label="UP" icon="🔼" />
                  <ControlButton direction="down" label="DOWN" icon="🔽" />
                </div>
                <ControlButton direction="right" label="RIGHT" icon="➡️" />
                
                <div></div>
                <ControlButton direction="back" label="BACK" icon="⬇️" />
                <div></div>
              </div>
            </div>

            {/* System Status */}
            <div className="bg-gradient-to-br from-slate-900/80 via-slate-800/80 to-slate-900/80 backdrop-blur-xl rounded-3xl p-6 border border-cyan-500/20 shadow-2xl">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center">
                <Activity className="w-5 h-5 mr-2 text-cyan-400" />
                System Status
              </h3>
              <div className="space-y-4 text-sm">
                <div className="flex justify-between items-center p-3 bg-black/30 rounded-xl border border-cyan-500/10">
                  <span className="text-cyan-300/80">Connection:</span>
                  <span className={`font-bold ${getStatusColor()}`}>{connectionStatus}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-black/30 rounded-xl border border-cyan-500/10">
                  <span className="text-cyan-300/80">Cluster:</span>
                  <span className="text-white font-semibold text-xs">30e09...24e15</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-black/30 rounded-xl border border-cyan-500/10">
                  <span className="text-cyan-300/80">Transport:</span>
                  <span className="text-white font-semibold">WSS:8884</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-black/30 rounded-xl border border-cyan-500/10">
                  <span className="text-cyan-300/80">Frames:</span>
                  <span className="text-emerald-400 font-bold">{frameCount}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-black/30 rounded-xl border border-cyan-500/10">
                  <span className="text-cyan-300/80">QoS:</span>
                  <span className="text-white font-semibold">Level 1</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Captured Images Gallery */}
        {capturedImages.length > 0 && (
          <div className="mt-8 bg-gradient-to-br from-slate-900/80 via-slate-800/80 to-slate-900/80 backdrop-blur-xl rounded-3xl p-8 border border-cyan-500/20 shadow-2xl">
            <div className="flex items-center space-x-3 mb-8">
              <div className="relative">
                <Camera className="w-8 h-8 text-cyan-400" />
                <div className="absolute -inset-1 bg-cyan-400/20 rounded-full blur animate-pulse" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">📷 Captured Images</h2>
                <p className="text-cyan-300/70 text-sm">{capturedImages.length} high-resolution photos</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-6">
              {capturedImages.map((image) => (
                <div key={image.id} className="relative group">
                  <div className="relative overflow-hidden rounded-2xl border-2 border-cyan-500/20 hover:border-cyan-400/50 transition-all duration-300">
                    <img 
                      src={image.base64} 
                      alt="Captured" 
                      className="w-full aspect-video object-cover transition-transform duration-300 group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    <div className="absolute inset-0 flex items-center justify-center space-x-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <button
                        onClick={() => downloadImage(image)}
                        className="p-3 bg-emerald-500/90 hover:bg-emerald-600 rounded-xl transition-colors backdrop-blur-sm border border-emerald-400/30"
                      >
                        <Download className="w-5 h-5 text-white" />
                      </button>
                      <button
                        onClick={() => deleteImage(image.id)}
                        className="p-3 bg-red-500/90 hover:bg-red-600 rounded-xl transition-colors backdrop-blur-sm border border-red-400/30"
                      >
                        <Trash2 className="w-5 h-5 text-white" />
                      </button>
                    </div>
                  </div>
                  <div className="absolute bottom-2 left-2 bg-black/80 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-lg border border-cyan-500/20">
                    {new Date(image.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RemoteVehicleControl;