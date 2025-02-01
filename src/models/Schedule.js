import mongoose from 'mongoose';

const slotSchema = new mongoose.Schema({
  time: {
    type: String,
    required: true
  },
  name: {
    type: String,
    default: ''
  },
  email: {
    type: String,
    default: ''
  },
  company: {
    type: String,
    default: ''
  },
  subject: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['available', 'booked', 'blocked'],
    default: 'available'
  }
}, { _id: false });

const scheduleSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
    unique: true
  },
  slots: [slotSchema]
},
{ collection: 'schedule' });

const Schedule = mongoose.model('Schedule', scheduleSchema);

export default Schedule; 