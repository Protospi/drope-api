import express from 'express'
import dotenv from 'dotenv'
import connectDB from './src/config/database.js'
import userRoutes from './src/routes/userRoutes.js'
import scheduleRoutes from './src/routes/scheduleRoutes.js'
import scrumPokerRoutes from './src/routes/scrumPokerRoutes.js'
import cors from 'cors'
import https from 'https'
import fs from 'fs'
import http from 'http'

// Load environment variables based on manual setting
const isDev = false  // Just change this to false for production
const PORT = isDev ? 8000 : 443

const app = express()

// Middleware
app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = [
      'https://planning-poker-xi-amber.vercel.app', 
      'http://localhost:3000',
      'https://api.loes.pro'
    ];
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api/users', userRoutes)
app.use('/api/schedule', scheduleRoutes)
app.use('/api/scrumpoker', scrumPokerRoutes)

// Base route
app.get('/', (req, res) => {
  res.send('Node API is running')
})

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: `Cannot ${req.method} ${req.path}` });
});

// Server startup based on environment
if (isDev) {
  // Development: Use HTTPS with self-signed certificates
  try {
    const credentials = {
      key: fs.readFileSync('./certs/localhost.key'),
      cert: fs.readFileSync('./certs/localhost.crt')
    };

    const httpsServer = https.createServer(credentials, app);
    httpsServer.listen(PORT, async () => {
      console.log(`Development HTTPS Server running on port ${PORT}`);
      await connectDB();
    });
  } catch (error) {
    console.error('Error loading certificates:', error);
    console.log('Falling back to HTTP for development');
    app.listen(PORT, async () => {
      console.log(`Development HTTP Server running on port ${PORT}`);
      await connectDB();
    });
  }
} else {
  // Production: Use Let's Encrypt certificates
  try {
    const credentials = {
      key: fs.readFileSync('/etc/letsencrypt/live/api.loes.pro/privkey.pem', 'utf8'),
      cert: fs.readFileSync('/etc/letsencrypt/live/api.loes.pro/cert.pem', 'utf8'),
      ca: fs.readFileSync('/etc/letsencrypt/live/api.loes.pro/chain.pem', 'utf8')
    };

    const httpsServer = https.createServer(credentials, app);
    httpsServer.listen(443, async () => {
      console.log('Production HTTPS Server running on port 443');
      await connectDB();
    });

    // HTTP redirect in production
    http.createServer((req, res) => {
      res.writeHead(301, { "Location": "https://" + req.headers['host'] + req.url });
      res.end();
    }).listen(80);
  } catch (error) {
    console.error('Error starting production server:', error);
    process.exit(1);
  }
}