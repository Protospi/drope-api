import express from 'express'
import dotenv from 'dotenv'
import connectDB from './src/config/database.js'
import userRoutes from './src/routes/userRoutes.js'
import scheduleRoutes from './src/routes/scheduleRoutes.js'
import cors from 'cors'

// Load environment variables
dotenv.config()

const app = express()
const PORT = process.env.PORT || 8000

// Middleware
app.use(cors())
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

// Start server and connect to database
app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`)
  await connectDB()
})