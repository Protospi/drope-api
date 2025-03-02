import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import Schedule from '../models/Schedule.js';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import crypto from 'crypto';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

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
            "description": "Assistant provided a detailed summary checkout of the booking and ask if the user want to confirm the booking"
          },
          "confirmation": {
            "type": "boolean",
            "description": "The user explictly confirm the information of the meeting after the checkout provided by the assistant"
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
        "required": ["date", "time", "name", "email", "checkout", "confirmation", "subject", "company"],
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
            "description": "Assistant provided a detailed summary checkout of the booking cancellation and ask if the user want to confirm the cancellation"
          },
          "confirmation": {
            "type": "boolean",
            "description": "The user explictly confirm the information of the meeting cancellation after the cancellation checkout provided by the assistant"
          }
        },
        "required": ["date", "time", "name", "email", "checkout", "confirmation"],
        "additionalProperties": false
      },
      "strict": true
    }
  }];

// Add Gmail scope to existing calendar scope
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.send'
];

// Update oauth2Client initialization to include both scopes
const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Set credentials right after initialization
if (process.env.GOOGLE_REFRESH_TOKEN) {
  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });
} else {
  console.warn('Warning: GOOGLE_REFRESH_TOKEN not set in environment variables');
}

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

// Add this function after other helper functions
async function sendGmail(to, subject, message) {
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  
  // Create the email in RFC 822 format
  const emailLines = [
    `From: ${process.env.GOOGLE_EMAIL}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    '',
    message
  ];
  
  const email = emailLines.join('\r\n').trim();
  
  // Convert the email to base64 format
  const base64Email = Buffer.from(email).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  try {
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: base64Email
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
}

// Function to retrieve all events on a day by date and hour
async function listEvents(date) {
    return new Promise((resolve, reject) => {
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        
        // Specify the date you want to retrieve events for
        const timeZone = 'America/Sao_Paulo';
        
        // Define timeMin and timeMax for the specified date
        const timeMin = new Date(`${date}T00:00:00`).toISOString();
        const timeMax = new Date(`${date}T23:59:59`).toISOString();
        
        calendar.events.list(
            {
                calendarId: 'primary',
                timeMin: timeMin,
                timeMax: timeMax,
                timeZone: timeZone,
                singleEvents: true,
                orderBy: 'startTime',
            },
            (err, res) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                const events = res.data.items;
                const formattedEvents = events.map((event) => ({
                    start: event.start.dateTime || event.start.date,
                    summary: event.summary
                }));
                
                resolve(formattedEvents);
            }
        );
    });
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
                    subject: args.subject,
                    checkout: args.checkout,
                    confirmation: args.confirmation
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
                    time: args.time,
                    name: args.name,
                    email: args.email,
                    checkout: args.checkout,
                    confirmation: args.confirmation
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
    const startDate = new Date(date + 'T00:00:00.000Z');
    const endDate = new Date(date + 'T23:59:59.999Z');

    // Get MongoDB schedule
    const schedule = await Schedule.findOne({
      date: {
        $gte: startDate,
        $lte: endDate
      }
    });

    // Get Google Calendar events
    const googleEvents = await listEvents(date);

    // Define the standard time slots
    const standardSlots = [
      '8:00', '9:00', '10:00', '11:00',
      '14:00', '15:00', '16:00', '17:00'
    ];

    // Create formatted slots
    const formattedSlots = standardSlots.map(time => {
      // Check Google Calendar events
      const googleEvent = googleEvents.find(event => {
        const eventDate = new Date(event.start);
        const eventHour = eventDate.getHours().toString().padStart(2, '0');
        const eventMinute = eventDate.getMinutes().toString().padStart(2, '0');
        const eventTimeString = `${eventHour}:${eventMinute}`;
        return eventTimeString === time;
      });

      if (googleEvent) {
        return {
          time,
          name: googleEvent.summary || '',
          email: '',
          company: '',
          subject: googleEvent.summary || '',
          status: 'booked'
        };
      }

      // Check MongoDB schedule
      const scheduledSlot = schedule?.slots.find(slot => slot.time === time);
      if (scheduledSlot && scheduledSlot.status === 'booked') {
        return scheduledSlot;
      }

      // Return empty slot if no booking found
      return {
        time,
        name: '',
        email: '',
        company: '',
        subject: '',
        status: 'available'
      };
    });

    // Return the formatted structure
    return {
      date: startDate,
      slots: formattedSlots
    };
  } catch (error) {
    throw error;
  }
};

// Now getScheduleByDate can be simplified to:
const getScheduleByDate = async (req, res) => {
  try {
    const { date } = req.params;
    const schedule = await getScheduleByDateInternal(date);
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

  const { date, time, name, email, company, subject, checkout, confirmation } = req.body;

  if(checkout && confirmation) {
    try {
    
    
        // Add 3 hour to the new date
        const newDate = new Date(date);
        newDate.setHours(newDate.getHours() + 3);
    
        const schedule = await Schedule.findOne({
          date: newDate
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
    
        // Save to MongoDB
        slot.name = name;
        slot.email = email;
        slot.company = company;
        slot.subject = subject;
        slot.status = 'booked';
    
        await schedule.save();
    
        // Add to Google Calendar
        try {
          // Set credentials from environment variables
          oauth2Client.setCredentials({
            refresh_token: process.env.GOOGLE_REFRESH_TOKEN
          });
    
          const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
          // Create DateTime strings for the event
          const startDateTime = new Date(`${date}T${time}`);
          const endDateTime = new Date(startDateTime.getTime() + 60 * 60000); // 1 hour duration
    
          const event = {
            summary: subject,
            description: `Meeting with ${name} from ${company}`,
            start: {
              dateTime: startDateTime.toISOString(),
              timeZone: 'America/Sao_Paulo',
            },
            end: {
              dateTime: endDateTime.toISOString(),
              timeZone: 'America/Sao_Paulo',
            },
            attendees: [
              { email: email }
            ],
          };
    
          const googleEvent = await calendar.events.insert({
            calendarId: 'primary',
            resource: event,
            sendUpdates: 'all', // Sends email notifications to attendees
          });

          console.log(googleEvent)
    
          // After successful booking, send confirmation email
          try {
            await sendGmail(
              email,
              'Meeting Confirmation',
              `Your meeting "${subject}" has been scheduled for ${date} at ${time}.\n\nBest regards,\nYour Scheduling System`
            );
          } catch (emailError) {
            console.error('Error sending confirmation email:', emailError);
          }
    
          // Return success with both MongoDB and Google Calendar data
          res.json({ 
            message: 'Slot booked successfully', 
            schedule,
            googleCalendarEvent: googleEvent.data 
          });
    
        } catch (googleError) {
          console.error('Error adding event to Google Calendar:', googleError);
          // Still return success since MongoDB save worked
          res.json({ 
            message: 'Slot booked successfully in database, but failed to add to Google Calendar', 
            schedule,
            googleCalendarError: googleError.message 
          });
        }
    
      } catch (error) {
        console.error('Error booking slot:', error);
        res.status(500).json({ 
          error: 'Internal server error', 
          message: error.message 
        });
      }
    } else {
      return res.status(400).json({ message: 'Checkout and confirmation are required' });
    }
};

const cancelBooking = async (req, res) => {
  try {
    const { date, time, name, email, checkout, confirmation } = req.body;

    // Add 3 hour to the new date
    const newDate = new Date(date);
    newDate.setHours(newDate.getHours() + 3);

    const schedule = await Schedule.findOne({
      date: newDate
    });

    if (!schedule) {
      return res.status(404).json({ message: 'Schedule not found for this date' });
    }

    const slot = schedule.slots.find(slot => slot.time === time);
    if (!slot) {
      return res.status(404).json({ message: 'Time slot not found' });
    }

    // Store the event details before clearing them
    const eventDetails = {
      subject: slot.subject,
      email: slot.email
    };

    // Clear the slot in MongoDB
    slot.name = '';
    slot.email = '';
    slot.company = '';
    slot.subject = '';
    slot.status = 'available';

    await schedule.save();

    // Cancel in Google Calendar
    try {
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      // Find the event by time and attendee
      const startDateTime = new Date(`${date}T${time}`);
      const endDateTime = new Date(startDateTime.getTime() + 60 * 60000); // 1 hour later

      const events = await calendar.events.list({
        calendarId: 'primary',
        timeMin: startDateTime.toISOString(),
        timeMax: endDateTime.toISOString(),
        q: eventDetails.subject, // Search by event subject
        singleEvents: true
      });

      const eventToCancel = events.data.items.find(event => 
        event.attendees?.some(attendee => attendee.email === eventDetails.email)
      );

      if (eventToCancel) {
        await calendar.events.delete({
          calendarId: 'primary',
          eventId: eventToCancel.id,
          sendUpdates: 'all' // Sends cancellation emails to attendees
        });

        // After successful cancellation, send notification email
        try {
          await sendGmail(
            eventDetails.email,
            'Meeting Cancellation',
            `Your meeting "${eventDetails.subject}" scheduled for ${date} at ${time} has been cancelled.\n\nBest regards,\nYour Scheduling System`
          );
        } catch (emailError) {
          console.error('Error sending cancellation email:', emailError);
        }

        res.json({ 
          message: 'Booking cancelled successfully in both database and Google Calendar', 
          schedule 
        });
      } else {
        res.json({ 
          message: 'Booking cancelled in database, but no matching Google Calendar event found', 
          schedule 
        });
      }

    } catch (googleError) {
      console.error('Error cancelling Google Calendar event:', googleError);
      res.json({ 
        message: 'Booking cancelled in database, but failed to cancel Google Calendar event', 
        schedule,
        googleCalendarError: googleError.message 
      });
    }

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