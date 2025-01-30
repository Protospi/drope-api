import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import Schedule from '../models/Schedule.js';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const conversationalAgent = async (req, res) => {
  console.log('Endpoint hit: /api/schedule/conversational-agent');
  try {
    const { messages } = req.body;
    // Set headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = await openai.chat.completions.create({
      messages: messages,
      model: "gpt-4o-mini",
      stream: true,
    });

    // Stream the response
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        // Send the chunk as a Server-Sent Event
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }
    
    // End the response
    res.end();

  } catch (error) {
    console.error('Error in chat API:', error);
    // Send more detailed error information
    return res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined 
    });
  }
};

// New schedule management functions
const getAllSchedules = async (req, res) => {
  try {
    const schedules = await Schedule.find({}).sort({ date: 1 });
    res.json(schedules);
  } catch (error) {
    console.error('Error fetching schedules:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
};

const getScheduleByDate = async (req, res) => {
  try {
    const { date } = req.params;
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    
    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    const schedule = await Schedule.findOne({
      date: {
        $gte: startDate,
        $lte: endDate
      }
    });

    if (!schedule) {
      return res.status(404).json({ message: 'Não há agendamento disponível para esta data' });
    }

    return schedule;

  } catch (error) {
    console.error('Error fetching schedule by date:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
};

const bookSlot = async (req, res) => {
  try {
    const { date, time, clientName } = req.body;

    const schedule = await Schedule.findOne({
      date: new Date(date)
    });

    if (!schedule) {
      return res.status(404).json({ message: 'Schedule not found for this date' });
    }

    const slot = schedule.slots.find(slot => slot.time === time);
    if (!slot) {
      return res.status(404).json({ message: 'Time slot not found' });
    }

    if (slot.status === 'booked') {
      return res.status(400).json({ message: 'This slot is already booked' });
    }

    slot.clientName = clientName;
    slot.status = 'booked';

    await schedule.save();
    res.json({ message: 'Slot booked successfully', schedule });
  } catch (error) {
    console.error('Error booking slot:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
};

const cancelBooking = async (req, res) => {
  try {
    const { date, time } = req.body;

    const schedule = await Schedule.findOne({
      date: new Date(date)
    });

    if (!schedule) {
      return res.status(404).json({ message: 'Schedule not found for this date' });
    }

    const slot = schedule.slots.find(slot => slot.time === time);
    if (!slot) {
      return res.status(404).json({ message: 'Time slot not found' });
    }

    slot.clientName = '';
    slot.status = 'available';

    await schedule.save();
    res.json({ message: 'Booking cancelled successfully', schedule });
  } catch (error) {
    console.error('Error cancelling booking:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
};

const tools = [{
  "type": "function",
  "function": {
    "name": "bookSlot",
    "description": "Book a time slot in the schedule after user confirmation",
    "parameters": {
      "type": "object",
      "properties": {
        "date": {
          "type": "string",
          "description": "Date in YYYY-MM-DD format"
        },
        "time": {
          "type": "string",
          "description": "Time slot in HH:mm format (24h)"
        },
        "clientName": {
          "type": "string",
          "description": "Name of the client booking the slot"
        },
        "subject": {
          "type": "string",
          "description": "Subject or purpose of the meeting"
        }
      },
      "required": ["date", "time", "clientName", "subject"],
      "additionalProperties": false
    },
    "strict": true
  }
}, {
  "type": "function",
  "function": {
    "name": "getScheduleByDate",
    "description": "Check if a specific time slot is available on a given date",
    "parameters": {
      "type": "object",
      "properties": {
        "date": {
          "type": "string",
          "description": "Date in YYYY-MM-DD format"
        }
      },
      "required": ["date"],
      "additionalProperties": false
    },
    "strict": true
  }
}, {
  "type": "function",
  "function": {
    "name": "cancelBooking",
    "description": "Cancel an existing appointment",
    "parameters": {
      "type": "object",
      "properties": {
        "date": {
          "type": "string",
          "description": "Date in YYYY-MM-DD format"
        },
        "time": {
          "type": "string",
          "description": "Time slot in HH:mm format (24h)"
        }
      },
      "required": ["date", "time"],
      "additionalProperties": false
    },
    "strict": true
  }
}];

const scheduleAgent = async (req, res) => {
  console.log('Endpoint hit: /api/schedule/schedule-agent');
  let response = { functionResult: { type: "", message: "", data: null}};
  try {

    const { messages } = req.body;

    const completion = await openai.chat.completions.create({
      messages: messages,
      model: "gpt-4o-mini",
      tools,
      stream: false,
    });

    let toolCalls = [];

    if (completion.choices[0].message.tool_calls) {
      toolCalls = completion.choices[0].message.tool_calls;
    }
    console.log(toolCalls)

    // Check if there are any tool calls
    if (toolCalls.length > 0) {
      for (const toolCall of toolCalls) {
        try {
          const args = JSON.parse(toolCall.function.arguments);
          
          switch(toolCall.function.name) {
            case 'bookSlot':
              const bookingResult = await bookSlot({
                body: {
                  date: args.date,
                  time: args.time,
                  clientName: args.clientName
                }
              }, {
                json: (data) => data,
                status: (code) => ({ json: (data) => data })
              });
              
              response.functionResult = {
                type: 'booking',
                message: `Reunião agendada para ${args.clientName} em ${args.date} às ${args.time} para ${args.subject} foi confirmada com sucesso.`,
                data: bookingResult
              };
              break;

            case 'getScheduleByDate':
              const scheduleResult = await getScheduleByDate({
                params: { date: args.date }
              }, {
                json: (data) => data,
                status: (code) => ({ json: (data) => data })
              });
              
              if (!scheduleResult) {
                response.functionResult = {
                  type: 'schedule',
                  message: `Não há agenda disponível para ${args.date}.`,
                  data: null
                };
                break;
              }

              const availableSlots = scheduleResult.slots
                .filter(slot => slot.status === 'available')
                .map(slot => slot.time);

              response.functionResult = {
                type: 'schedule',
                message: `Agenda disponível para ${args.date}: ${availableSlots.join(', ')}`,
                data: scheduleResult
              };
              break;

            case 'cancelBooking':
              const cancelResult = await cancelBooking({
                body: {
                  date: args.date,
                  time: args.time
                }
              }, {
                json: (data) => data,
                status: (code) => ({ json: (data) => data })
              });
              
              response.functionResult = {
                type: 'cancellation',
                message: `Reunião agendada para ${args.date} às ${args.time} foi cancelada com sucesso.`,
                data: cancelResult
              };
              break;
          }
        } catch (error) {
          response.error = {
            message: `Error processing request: ${error.message}`,
            details: error
          };
        }
      }
    }
    console.log(response)
    return res.json(response);

  } catch (error) {
    console.error('Error in schedule agent:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined 
    });
  }
};

export { 
  conversationalAgent, 
  getAllSchedules, 
  getScheduleByDate, 
  bookSlot, 
  cancelBooking,
  scheduleAgent 
}; 