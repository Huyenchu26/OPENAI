const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();
const port = 3001;

app.use(cors());
app.use(bodyParser.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// In-memory conversation store: { conversationId: [ {role, content}, ... ] }
const conversations = {};

app.post('/chat', async (req, res) => {
  const { message, conversationId } = req.body;
  if (!message || !conversationId) {
    return res.status(400).json({ error: 'Missing message or conversationId' });
  }

  // Initialize conversation if new
  if (!conversations[conversationId]) {
    conversations[conversationId] = [
      { role: 'system', content: 'You are a helpful assistant.' }
    ];
  }
  // Add user message
  conversations[conversationId].push({ role: 'user', content: message });

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', //gpt-3.5-turbo
      messages: conversations[conversationId],
      temperature: 0.7,
      max_tokens: 256,
    });
    const botReply = completion.choices[0].message.content;
    // Add assistant reply to conversation
    conversations[conversationId].push({ role: 'assistant', content: botReply });
    res.json({ reply: botReply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get response from OpenAI' });
  }
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
}); 