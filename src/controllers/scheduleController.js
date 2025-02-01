import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import Schedule from '../models/Schedule.js';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import crypto from 'crypto';

dotenv.config();

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

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
          "name": {
            "type": "string",
            "description": "Name of the client booking the slot"
          },
          "email": {
            "type": "string",
            "description": "Email of the client booking the slot"
          },
          "checkout": {
            "type": "boolean",
            "description": "Assistant provided a summary of the booking and ask if the user wants to checkout should be true"
          },
          "confirmation": {
            "type": "boolean",
            "description": "The user cofirmation of the last checkout should be true"
          },
          "subject": {
            "type": "string",
            "description": "Subject or purpose of the meeting describe by the user"
          },
          "company": {
            "type": "string",
            "description": "Company name"
          }
        },
        "required": ["date", "time", "name", "email", "subject", "checkout", "confirmation", "company"],
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
          },
          "checkout": {
            "type": "boolean",
            "description": "Assistant provide a summary of the booking cancellation and ask if the user wants to confirm the cancellation"
          },
          "confirmation": {
            "type": "boolean",
            "description": "The user cofirmed the last checkout cancellation should be true"
          }
        },
        "required": ["date", "time", "checkout", "confirmation"],
        "additionalProperties": false
      },
      "strict": true
    }
  }];

// Helper function to get file from S3
async function getFileFromS3(url) {
  const matches = url.match(/s3\..*\.amazonaws\.com\/(.*)/);
  if (!matches) throw new Error('Invalid S3 URL');
  
  const key = matches[1];
  const bucket = process.env.AWS_BUCKET_NAME;

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const response = await s3Client.send(command);
  return response.Body;
}

// Add this helper function after the getFileFromS3 function
async function uploadFileToS3(buffer, contentType) {
  const fileName = `audio-${crypto.randomBytes(8).toString('hex')}.mp3`;
  
  const command = new PutObjectCommand({
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: fileName,
    Body: buffer,
    ContentType: contentType
  });

  await s3Client.send(command);
  return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
}

const conversationalAgent = async (req, res) => {
  try {
    const { messages, userMessage, input } = req.body;

    if (input.type === "text") {
      messages.push({ role: "user", content: input.content });
      
      // Set headers for streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const stream = await openai.chat.completions.create({
        messages: messages,
        model: "gpt-4",
        stream: true,
      });

      // Stream the response
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }
      
      res.end();

    } else if (input.type === "audio") {
      // Get the audio file from S3 and transcribe it
      const audioStream = await getFileFromS3(input.content);
      const buffer = await new Promise((resolve, reject) => {
        const chunks = [];
        audioStream.on('data', chunk => chunks.push(chunk));
        audioStream.on('end', () => resolve(Buffer.concat(chunks)));
        audioStream.on('error', reject);
      });

      const file = new File([buffer], 'audio.wav', { type: 'audio/wav' });
      const transcription = await openai.audio.transcriptions.create({
        file: file,
        model: "whisper-1",
        response_format: "text",
      });

      messages.push({ role: "user", content: transcription });

      // Get chat completion
      const completion = await openai.chat.completions.create({
        messages: messages,
        model: "gpt-4",
        stream: false,
      });

      const assistantResponse = completion.choices[0].message.content;

      // Generate speech from the assistant's response
      const mp3 = await openai.audio.speech.create({
        model: "tts-1",
        voice: "alloy",
        input: assistantResponse,
      });

      // Convert the audio to a buffer and upload to S3
      const audioBuffer = Buffer.from(await mp3.arrayBuffer());
      const audioUrl = await uploadFileToS3(audioBuffer, 'audio/mpeg');

      // Send both the text response and audio URL
      res.json({
        text: assistantResponse,
        audioUrl: audioUrl
      });
    }

  } catch (error) {
    console.error('Error in chat API:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined 
    });
  }
};

const scheduleAgent = async (req, res) => {
  
    let response = { functionResult: { type: "", message: "", data: null}};
    try {
  
        const { messages, userMessage, input } = req.body;

        if(input.type === "text") {
            messages.push({ role: "user", content: input.content });
        } else if(input.type === "audio") {
          // Get the audio file from S3
          const audioStream = await getFileFromS3(input.content);
          
          // Convert the stream to a format that OpenAI can accept
          const buffer = await new Promise((resolve, reject) => {
            const chunks = [];
            audioStream.on('data', chunk => chunks.push(chunk));
            audioStream.on('end', () => resolve(Buffer.concat(chunks)));
            audioStream.on('error', reject);
          });
    
          // Create a File object that OpenAI's API can accept
          const file = new File([buffer], 'audio.wav', { type: 'audio/wav' });
          
          const transcription = await openai.audio.transcriptions.create({
            file: file,
            model: "whisper-1",
            response_format: "text",
          });
    
          // console.log(transcription)
          messages.push({ role: "user", content: transcription });
        }
      
      // console.log(messages)
      const completion = await openai.chat.completions.create({
        messages: messages,
        model: "gpt-4o",
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
                    name: args.name,
                    email: args.email,
                    company: args.company,
                    subject: args.subject
                  }
                }, {
                  json: (data) => data,
                  status: (code) => ({ json: (data) => data })
                });
                
                response.functionResult = {
                  type: 'booking',
                  message: `Reunião agendada para ${args.name} em ${args.date} às ${args.time} para ${args.subject} foi confirmada com sucesso.`,
                  data: bookingResult,
                  args: args
                };
                break;
  
              case 'getScheduleByDate':
                try {
                  const scheduleResult = await getScheduleByDateInternal(args.date);
                  
                  if (!scheduleResult) {
                    response.functionResult = {
                      type: 'schedule',
                      message: `Não há agenda disponível para ${args.date}.`,
                      data: null,
                      args: `Os argumentos capturados foram: ${JSON.stringify(args)}`
                    };
                    break;
                  }
  
                  const availableSlots = scheduleResult.slots
                    .filter(slot => slot.status === 'available')
                    .map(slot => slot.time);
  
                  response.functionResult = {
                    type: 'schedule',
                    message: `Agenda disponível para ${args.date}: ${availableSlots.join(', ')}`,
                    data: scheduleResult,
                    date: args.date
                  };
                } catch (error) {
                  response.error = {
                    message: `Error processing request: ${error.message}`,
                    details: error
                  };
                }
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
      // console.log(response)
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

// Internal function for getting schedule by date
const getScheduleByDateInternal = async (date) => {
  try {
    //console.log("date", date)
    // Create date objects and force them to UTC
    const startDate = new Date(date + 'T00:00:00.000Z');
    const endDate = new Date(date + 'T23:59:59.999Z');

    //console.log("startDate", startDate)
    //console.log("endDate", endDate)
    const schedule = await Schedule.findOne({
      date: {
        $gte: startDate,
        $lte: endDate
      }
    });

    return schedule;
  } catch (error) {
    throw error;
  }
};

// Modified route handler that uses the internal function
const getScheduleByDate = async (req, res) => {
  try {
    const { date } = req.params;
    const schedule = await getScheduleByDateInternal(date);
    
    if (!schedule) {
      return res.status(404).json({ message: 'Não há agendamento disponível para esta data' });
    }

    res.json(schedule);

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
    const { date, time, name, email, company, subject } = req.body;
    
    // Add 3 hour to the nes date
    const newDate = new Date(date);
    newDate.setHours(newDate.getHours() + 3);

    const schedule = await Schedule.findOne({
      date: newDate
    });
    // console.log(schedule)

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
    
    slot.name = name;
    slot.email = email;
    slot.company = company;
    slot.subject = subject;
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

    // Add 3 hour to the nes date
    const newDate = new Date(date);
    newDate.setHours(newDate.getHours() + 3);

    const schedule = await Schedule.findOne({
      date: newDate
    });

    console.log(schedule)

    if (!schedule) {
      return res.status(404).json({ message: 'Schedule not found for this date' });
    }

    const slot = schedule.slots.find(slot => slot.time === time);
    if (!slot) {
      return res.status(404).json({ message: 'Time slot not found' });
    }

    slot.name = '';
    slot.email = '';
    slot.company = '';
    slot.subject = '';
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


export { 
  conversationalAgent, 
  getAllSchedules, 
  getScheduleByDate,
  getScheduleByDateInternal,
  bookSlot, 
  cancelBooking,
  scheduleAgent 
}; 