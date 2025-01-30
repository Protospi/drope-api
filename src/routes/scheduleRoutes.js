import express from 'express';
import { 
  conversationalAgent, 
  scheduleAgent,
  getAllSchedules,
  getScheduleByDate,
  bookSlot,
  cancelBooking
} from '../controllers/scheduleController.js';

const router = express.Router();

// Schedule routes
router.post('/conversational-agent', conversationalAgent);
router.post('/schedule-agent', scheduleAgent);

// New schedule management routes
router.get('/schedule-agent', getAllSchedules);
router.get('/schedule-agent/:date', getScheduleByDate);
router.post('/schedule-agent/book', bookSlot);
router.post('/schedule-agent/cancel', cancelBooking);

export default router; 