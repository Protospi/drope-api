import mongoose from 'mongoose';

const roomSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true
  },
  taskName: {
    type: String
  },
  taskDescription: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  votes: [{
    participant: String,
    tag: String,
    value: Number,
    explanation: String
  }],
  average: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['active', 'completed'],
    default: 'active'
  }
});

const Room = mongoose.model('Room', roomSchema);

export default Room; 