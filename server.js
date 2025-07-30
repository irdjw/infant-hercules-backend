### backend/server.js

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const NodeCache = require('node-cache');
const BODSService = require('./services/bodsService');

const app = express();
const PORT = process.env.PORT || 3001;

// Configuration with your BODS API key
const config = {
  BODS_API_KEY: '043fa2ba6945e602dd111fae2bf602125c9e028a',
  CACHE_TTL: 300, // 5 minutes cache for timetables
  VEHICLE_CACHE_TTL: 30, // 30 seconds cache for vehicle positions
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*'
};

// Initialize cache
const cache = new NodeCache({ 
  stdTTL: config.CACHE_TTL,
  checkperiod: 60,
  useClones: false 
});

const vehicleCache = new NodeCache({ 
  stdTTL: config.VEHICLE_CACHE_TTL,
  checkperiod: 10,
  useClones: false 
});

// Initialize BODS service
const bodsService = new BODSService(config.BODS_API_KEY, cache, vehicleCache);

// Middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(cors({
  origin: config.CORS_ORIGIN,
  credentials: true
}));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    cache: {
      timetables: cache.keys().length,
      vehicles: vehicleCache.keys().length
    },
    bodsApiKey: config.BODS_API_KEY.substring(0, 8) + '...'
  });
});

// Get bus times for all Cleveland Centre stops
app.get('/api/bus-times', async (req, res) => {
  try {
    console.log('🚌 Fetching bus times for all Cleveland Centre stops');
    const allStopData = await bodsService.getAllClevelandCentreData();
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: allStopData,
      cached: bodsService.isCacheHit(),
      source: 'BODS'
    });
  } catch (error) {
    console.error('❌ Error fetching bus times:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      fallback: await bodsService.getFallbackData()
    });
  }
});

// Get bus times for specific stop
app.get('/api/bus-times/:stopId', async (req, res) => {
  try {
    const { stopId } = req.params;
    console.log(`🚌 Fetching bus times for stop ${stopId}`);
    
    const stopData = await bodsService.getBusTimesForStop(stopId);
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      stopId,
      data: stopData,
      cached: bodsService.isCacheHit(),
      source: 'BODS'
    });
  } catch (error) {
    console.error(`❌ Error fetching bus times for stop ${req.params.stopId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      stopId: req.params.stopId
    });
  }
});

// Get next bus across all stops (for Phil's notifications)
app.get('/api/next-bus', async (req, res) => {
  try {
    console.log('🚌 Finding next bus across all stops');
    const nextBus = await bodsService.getNextBusGlobally();
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      nextBus,
      isPhilBus: ['17A', '17B'].includes(nextBus?.routeNumber),
      source: 'BODS'
    });
  } catch (error) {
    console.error('❌ Error finding next bus:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get real-time vehicle positions
app.get('/api/vehicles', async (req, res) => {
  try {
    console.log('🚌 Fetching real-time vehicle positions');
    const vehicles = await bodsService.getVehiclePositions();
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      vehicles,
      count: vehicles.length,
      source: 'BODS_SIRI'
    });
  } catch (error) {
    console.error('❌ Error fetching vehicles:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      vehicles: []
    });
  }
});

// Cache management endpoints
app.get('/api/cache/status', (req, res) => {
  res.json({
    timetables: {
      keys: cache.keys().length,
      stats: cache.getStats()
    },
    vehicles: {
      keys: vehicleCache.keys().length,
      stats: vehicleCache.getStats()
    }
  });
});

app.post('/api/cache/clear', (req, res) => {
  cache.flushAll();
  vehicleCache.flushAll();
  res.json({ message: 'Cache cleared successfully' });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('💥 Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    availableEndpoints: [
      'GET /api/bus-times',
      'GET /api/bus-times/:stopId',
      'GET /api/next-bus',
      'GET /api/vehicles',
      'GET /health'
    ]
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down gracefully');
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚌 Infant Hercules Bus Backend running on port ${PORT}`);
  console.log(`🔑 Using BODS API key: ${config.BODS_API_KEY.substring(0, 8)}...`);
  console.log(`🌐 CORS origin: ${config.CORS_ORIGIN}`);
});

module.exports = app;