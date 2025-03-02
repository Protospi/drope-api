import express from 'express';
import { createScrumPokerRoom, addParticipant, updateVote, calculateAverage, aiVote, getRoom, cleanVotes, updateTaksDescription } from '../controllers/scrumPokerController.js';

const router = express.Router();

// Enhanced error logging
router.use((req, res, next) => {
  next();
});

router.post('/create', createScrumPokerRoom);

router.put('/participant', addParticipant);

router.post('/getRoom/', getRoom);

router.put('/vote', updateVote);

router.put('/aiVote/', aiVote);

router.put('/cleanVotes/', cleanVotes);

router.get('/average/', calculateAverage);

router.put('/updateTaskDescription/', updateTaksDescription);

export default router; 