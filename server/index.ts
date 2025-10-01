import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { registerRoutes } from './routes';
import { testConnection, initializeDatabase } from './database/connection';
import { WebSocketManager } from './websocket/websocket-manager';

// Load environment variables
config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const dbHealth = await testConnection();
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: dbHealth ? 'connected' : 'disconnected',
      services: {
        database: dbHealth,
        websocket: true,
        blockchain: true
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Initialize database and start server
async function startServer() {
  try {
    console.log('🚀 Starting LiquidAssassin Server...');
    
    // Test database connection
    console.log('📊 Testing database connection...');
    const dbConnected = await testConnection();
    
    if (!dbConnected) {
      console.error('❌ Database connection failed. Please check your environment variables.');
      process.exit(1);
    }
    
    console.log('✅ Database connected successfully');
    
    // Initialize database schema
    console.log('🗄️ Initializing database schema...');
    const schemaInitialized = await initializeDatabase();
    
    if (!schemaInitialized) {
      console.error('❌ Database schema initialization failed.');
      process.exit(1);
    }
    
    console.log('✅ Database schema initialized');
    
    // Register routes
    console.log('🛣️ Registering API routes...');
    const server = await registerRoutes(app);
    
    // Start server
    server.listen(PORT, () => {
      console.log(`🎯 LiquidAssassin Server running on port ${PORT}`);
      console.log(`📡 WebSocket server available at ws://localhost:${PORT}/ws`);
      console.log(`🌐 API endpoints available at http://localhost:${PORT}/api`);
      console.log(`💚 Health check available at http://localhost:${PORT}/health`);
    });
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down server gracefully...');
      
      // Cleanup WebSocket connections
      const webSocketManager = new WebSocketManager();
      await webSocketManager.cleanup();
      
      server.close(() => {
        console.log('✅ Server shut down successfully');
        process.exit(0);
      });
    });
    
    process.on('SIGTERM', async () => {
      console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
      
      const webSocketManager = new WebSocketManager();
      await webSocketManager.cleanup();
      
      server.close(() => {
        console.log('✅ Server shut down successfully');
        process.exit(0);
      });
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();