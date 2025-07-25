import { OpenAI } from 'openai';
import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// In-memory conversation store: { conversationId: [ {role, content}, ... ] }
const conversations = {};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
      model: 'gpt-4o-mini', // or 'gpt-3.5-turbo'
      messages: conversations[conversationId],
      temperature: 0.7,
      max_tokens: 256,
    });
    const botReply = completion.choices[0].message.content;
    // Add assistant reply to conversation
    conversations[conversationId].push({ role: 'assistant', content: botReply });

    // Upsert conversation to Supabase
    const { error: supabaseError } = await supabase
      .from('conversations')
      .upsert([
        {
          conversation_id: conversationId,
          messages: conversations[conversationId],
        }
      ], { onConflict: ['conversation_id'] });
    if (supabaseError) {
      console.error('Supabase upsert error:', supabaseError);
    }

    res.status(200).json({ reply: botReply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get response from OpenAI' });
  }
} 