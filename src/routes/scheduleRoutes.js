import express from 'express';
import { conversationalAgent, dataAgent } from '../controllers/scheduleController.js';

const router = express.Router();

// Schedule routes
router.post('/conversational-agent', conversationalAgent);
router.post('/data-agent', dataAgent);

export default router; 