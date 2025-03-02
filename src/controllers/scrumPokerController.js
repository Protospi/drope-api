import Room from '../models/Rooms.js';

import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  dangerouslyAllowBrowser: true
});


export const createScrumPokerRoom = async (req, res) => {
  try {
    const { roomId, taskName, taskDescription } = req.body;
    
    // Validate input
    if (!taskName || !taskDescription) {
      return res.status(400).json({ 
        error: 'taskName and taskDescription are required' 
      });
    }

    // Create new room
    const room = new Room({
      roomId,
      taskName,
      taskDescription
    });

    // Save to database
    const savedRoom = await room.save();

    // Return success response
    res.status(201).json({
      message: 'Room created successfully',
      room: savedRoom
    });

  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({ 
      error: 'Failed to create room',
      details: error.message 
    });
  }
}; 

export const addParticipant = async (req, res) => {
  try {
    const { roomId, participant } = req.body;
    
    // Add participant to room votes array with null vote
    const room = await Room.findOneAndUpdate(
      { roomId },
      { 
        $push: { 
          votes: {
            participant: participant.name,
            tag: participant.role,
            value: null,
            explanation: null
          }
        }
      },
      { new: true }
    );

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    res.json(room);
  } catch (error) {
    console.error('Error adding participant:', error);
    res.status(500).json({ error: 'Failed to add participant' });
  }
};

export const getRoom = async (req, res) => {
  const { roomId } = req.body;
  const room = await Room.findOne({ roomId });
  res.json(room);
};

export const updateVote = async (req, res) => {
  try {
    const { roomId, participant, vote } = req.body;
    
    // Update vote for participant
    const room = await Room.findOneAndUpdate(
      { 
        roomId, 
        'votes.participant': participant 
      },
      { 
        $set: { 
          'votes.$.value': vote 
        }
      },
      { new: true }
    );

    if (!room) {
      return res.status(404).json({ 
        error: 'Room or participant not found' 
      });
    }

    res.json(room);
  } catch (error) {
    console.error('Error updating vote:', error);
    res.status(500).json({ 
      error: 'Failed to update vote',
      details: error.message 
    });
  }
};

export const updateTaksDescription = async (req, res) => {
  const { roomId, taskDescription } = req.body;
  const room = await Room.findOne({ roomId });
  room.taskDescription = taskDescription;
  await room.save();
  res.json(room);
};

export const cleanVotes = async (req, res) => {
  const { roomId } = req.body;
  const room = await Room.findOne({ roomId });
  room.votes = room.votes
    .filter(vote => vote.tag !== 'IA' && vote.participant !== 'Izi')
    .map(vote => ({
      ...vote,
      value: null,
      explanation: null
    }));
  await room.save();
  res.json(room);
};

export const aiVote = async (req, res) => {

    // Define room id
    const { roomId } = req.body;

    // get task name and description from mongo
    const room = await Room.findOne({ roomId });
    const taskName = room.taskName;
    const taskDescription = room.taskDescription;

    // Define the response format
    const VoteResponse = z.object({
        points: z.number(),
        explanation: z.string()
    });

    // Define prompt
    const prompt = `Atue como um Gerente de Projetos especialista em estimativas de esforço.
      
            Analise a tarefa abaixo e vote em quanto esforço será necessário para completá-la.
            Você deve escolher um valor dentre as opções: [1, 2, 3, 5, 8]
            Onde 1 representa pouco esforço e 8 representa muito esforço.
            O usuário vai fornecer o nome da tarefa e a descrição.
            Forneça sua estimativa e uma breve explicação em português de 2-3 frases 
            sobre o porquê dessa pontuação.
        `;

        const task = `
            Nome da Tarefa: ${taskName}
            Descrição: ${taskDescription}
        `

    // Try to call openai api
    try {
        
  
      const completion = await openai.beta.chat.completions.parse({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: task }
        ],
        response_format: zodResponseFormat(VoteResponse, "vote"),
      });
  
      const response = completion.choices[0].message.parsed;
      room.votes.push({
        participant: "Izi",
        tag: "IA",
        value: response.points,
        explanation: response.explanation
      });
      await room.save();
      return response;
    } catch (error) {
      console.error("Error getting AI vote:", error);
      return { points: 3, explanation: "Erro ao gerar estimativa." };
    }
  }; 

export const calculateAverage = async (req, res) => {
  const { roomId } = req.body;
  const room = await Room.findOne({ roomId });
  const totalVotes = room.votes.reduce((sum, vote) => sum + vote.value, 0);
  const average = totalVotes / room.votes.length;
  return average;
};