import { OpenAI } from 'openai';
import dotenv from 'dotenv';

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

const dataAgent = async (req, res) => {
  // Placeholder for future implementation
  res.status(501).json({ message: 'Data agent endpoint not implemented yet' });
};

export { conversationalAgent, dataAgent }; 