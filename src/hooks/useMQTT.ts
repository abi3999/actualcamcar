import { useEffect, useState, useRef } from 'react';
import mqtt, { MqttClient } from 'mqtt';

interface MQTTState {
  client: MqttClient | null;
  isConnected: boolean;
  connectionStatus: 'Connecting' | 'Connected' | 'Disconnected' | 'Reconnecting' | 'Error';
  error: string | null;
  lastMessage: any;
}

export const useMQTT = () => {
  const [state, setState] = useState<MQTTState>({
    client: null,
    isConnected: false,
    connectionStatus: 'Disconnected',
    error: null,
    lastMessage: null,
  });

  const clientRef = useRef<MqttClient | null>(null);

  useEffect(() => {
    const connectToMQTT = () => {
      try {
        console.log('🔗 Connecting to HiveMQ Cloud Serverless Cluster...');
        
        // HiveMQ Cloud Serverless cluster configuration
        const clusterUrl = '30e09063e22843d6a82f8faef3e24e15.s1.eu.hivemq.cloud';
        const port = 8884; // Secure MQTT over WebSockets/TLS
        const brokerUrl = `wss://${clusterUrl}:${port}/mqtt`;
        
        const options = {
          clientId: 'esp32cam_web_' + Math.random().toString(16).substr(2, 8),
          username: 'hivemq.webclient.1758451391269',
          password: 'CfYZ7PnkKIw5?3,;:co0',
          reconnectPeriod: 5000,
          connectTimeout: 30000,
          clean: true,
          keepalive: 60,
          protocol: 'wss' as const,
          rejectUnauthorized: true, // Ensure TLS certificate validation
        };

        console.log('📡 HiveMQ Cloud Cluster URL:', clusterUrl);
        console.log('🔒 WebSocket URL:', brokerUrl);
        console.log('👤 Username:', options.username);
        console.log('🔑 Client ID:', options.clientId);
        console.log('🚪 Port:', port);

        const client = mqtt.connect(brokerUrl, options);
        clientRef.current = client;

        client.on('connect', () => {
          console.log('✅ Successfully connected to HiveMQ Cloud Serverless!');
          console.log('🌐 Cluster:', clusterUrl);
          setState(prev => ({
            ...prev,
            client,
            isConnected: true,
            connectionStatus: 'Connected',
            error: null,
          }));

          // Subscribe to all required topics after successful connection
          const subscriptionTopics = [
            'userxyz/device/cam/stream',    // Live video stream
            'userxyz/device/cam/capture'    // Capture image
          ];

          subscriptionTopics.forEach(topic => {
            client.subscribe(topic, { qos: 1 }, (err) => {
              if (err) {
                console.error(`❌ Failed to subscribe to ${topic}:`, err);
              } else {
                console.log(`📺 Successfully subscribed to ${topic}`);
              }
            });
          });
        });

        client.on('message', (topic, message) => {
          console.log(`📨 Received message on ${topic} (${message.length} bytes)`);
          
          if (topic === 'userxyz/device/cam/stream' || topic === 'userxyz/device/cam/capture') {
            try {
              // Convert buffer to base64 for image display
              const base64Image = message.toString('base64');
              setState(prev => ({
                ...prev,
                lastMessage: {
                  topic,
                  message: base64Image,
                  timestamp: new Date().toISOString(),
                },
              }));
              console.log(`🖼️ Processed ${topic} image (${base64Image.length} chars)`);
            } catch (error) {
              console.error('❌ Error processing image message:', error);
            }
          }
        });

        client.on('error', (error) => {
          console.error('🚨 MQTT Connection Error:', error);
          console.error('🔍 Error details:', {
            message: error.message,
            code: (error as any).code,
            errno: (error as any).errno
          });
          setState(prev => ({
            ...prev,
            connectionStatus: 'Error',
            error: `Connection failed: ${error.message}`,
            isConnected: false,
          }));
        });

        client.on('disconnect', () => {
          console.log('🔌 Disconnected from HiveMQ Cloud');
          setState(prev => ({
            ...prev,
            connectionStatus: 'Disconnected',
            isConnected: false,
          }));
        });

        client.on('reconnect', () => {
          console.log('🔄 Reconnecting to HiveMQ Cloud...');
          setState(prev => ({
            ...prev,
            connectionStatus: 'Reconnecting',
          }));
        });

        client.on('close', () => {
          console.log('🚪 Connection to HiveMQ Cloud closed');
        });

        client.on('offline', () => {
          console.log('📴 Client went offline');
          setState(prev => ({
            ...prev,
            connectionStatus: 'Disconnected',
            isConnected: false,
          }));
        });

        setState(prev => ({
          ...prev,
          client,
          connectionStatus: 'Connecting',
        }));

      } catch (error) {
        console.error('🚨 Failed to initialize MQTT connection:', error);
        setState(prev => ({
          ...prev,
          connectionStatus: 'Error',
          error: error instanceof Error ? error.message : 'Connection initialization failed',
        }));
      }
    };

    connectToMQTT();

    return () => {
      if (clientRef.current) {
        console.log('🧹 Cleaning up MQTT connection');
        clientRef.current.end(true);
      }
    };
  }, []);

  const publishMessage = (topic: string, message: string) => {
    if (state.client && state.isConnected) {
      console.log(`📤 Publishing to ${topic}: ${message}`);
      state.client.publish(topic, message, { qos: 1 }, (err) => {
        if (err) {
          console.error(`❌ Failed to publish to ${topic}:`, err);
        } else {
          console.log(`✅ Successfully published to ${topic}`);
        }
      });
      return true;
    } else {
      console.warn('⚠️ Cannot publish: MQTT not connected');
      console.warn('📊 Current status:', {
        hasClient: !!state.client,
        isConnected: state.isConnected,
        status: state.connectionStatus
      });
      return false;
    }
  };

  return {
    ...state,
    publishMessage,
  };
};