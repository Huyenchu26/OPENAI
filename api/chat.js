import { OpenAI } from 'openai';
import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// In-memory conversation store: { conversationId: [ {role, content}, ... ] }
const conversations = {};

const system_prompt = `Extract the following customer details from the transcript:
- Name
- Email address
- Phone number
- Industry
- Problems, needs, and goals summary
- Availability
- Whether they have booked a consultation (true/false)
- Any special notes
- Lead quality (categorize as 'good', 'ok', or 'spam')
Format the response using this JSON schema:
{
  "type": "object",
  "properties": {
    "customerName": { "type": "string" },
    "customerEmail": { "type": "string" },
    "customerPhone": { "type": "string" },
    "customerIndustry": { "type": "string" },
    "customerProblem": { "type": "string" },
    "customerAvailability": { "type": "string" },
    "customerConsultation": { "type": "boolean" },
    "specialNotes": { "type": "string" },
    "leadQuality": { "type": "string", "enum": ["good", "ok", "spam"] }
  },
  "required": ["customerName", "customerEmail", "customerProblem", "leadQuality"]
}
If the user provided contact details, set lead quality to "good"; otherwise, "spam".`;

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Fetch all conversations
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select('conversation_id, create_at, messages, customer_analysis')
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
  } else if (req.method === 'PUT') {
    // Analyze conversation for customer information
    const { conversationId } = req.body;
    if (!conversationId) {
      return res.status(400).json({ error: 'Missing conversationId' });
    }

    try {
      // Get conversation from database
      const { data: convData, error: fetchError } = await supabase
        .from('conversations')
        .select('messages')
        .eq('conversation_id', conversationId)
        .single();

      if (fetchError || !convData) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      // Create transcript from messages
      const transcript = convData.messages
        .filter(msg => msg.role !== 'system')
        .map(msg => `${msg.role}: ${msg.content}`)
        .join('\n');

      // Analyze with OpenAI
      const analysisCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system_prompt },
          { role: 'user', content: `Analyze this conversation transcript:\n\n${transcript}` }
        ],
        temperature: 0.3,
        max_tokens: 500,
      });

      const analysisText = analysisCompletion.choices[0].message.content;
      
      // Try to parse JSON from response
      let analysis;
      try {
        // Extract JSON from the response (it might be wrapped in markdown)
        const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysis = JSON.parse(jsonMatch[0]);
        } else {
          analysis = JSON.parse(analysisText);
        }
      } catch (parseError) {
        console.error('Failed to parse analysis JSON:', parseError);
        return res.status(500).json({ error: 'Failed to parse analysis response' });
      }

      // Update conversation with analysis
      const { error: updateError } = await supabase
        .from('conversations')
        .update({ customer_analysis: analysis })
        .eq('conversation_id', conversationId);

      if (updateError) {
        console.error('Supabase update error:', updateError);
        return res.status(500).json({ error: 'Failed to save analysis' });
      }

      res.status(200).json(analysis);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to analyze conversation' });
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