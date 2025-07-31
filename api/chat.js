import { OpenAI } from 'openai';
import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// In-memory conversation store: { conversationId: [ {role, content}, ... ] }
const conversations = {};

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Fetch all conversations
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select('conversation_id, create_at, messages')
        .order('create_at', { ascending: false });

      if (error) {
        console.error('Supabase fetch error:', error);
        return res.status(500).json({ error: 'Failed to fetch conversations' });
      }

      res.status(200).json(data);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  } else if (req.method === 'POST') {
    // Handle chat messages
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
  } else if (req.method === 'DELETE') {
    // Delete conversation
    const { conversationId } = req.body;
    if (!conversationId) {
      return res.status(400).json({ error: 'Missing conversationId' });
    }

    try {
      const { error } = await supabase
        .from('conversations')
        .delete()
        .eq('conversation_id', conversationId);

      if (error) {
        console.error('Supabase delete error:', error);
        return res.status(500).json({ error: 'Failed to delete conversation' });
      }

      // Remove from in-memory store
      delete conversations[conversationId];

      res.status(200).json({ message: 'Conversation deleted successfully' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
} 