// Indus Agent - OpenRouter API Client & Streaming Handler

export const AVAILABLE_MODELS = [
  {
    id: 'meta-llama/llama-3.3-70b-instruct',
    name: 'Llama 3.3 70B Instruct',
    provider: 'Meta',
    badge: 'Popular',
    description: 'High intelligence, state-of-the-art open-source LLM rivaling top closed models.',
    context_length: 131072
  },
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3',
    provider: 'DeepSeek',
    badge: 'Smart & Fast',
    description: 'Extremely capable reasoning and coding model with exceptional value.',
    context_length: 64000
  },
  {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    provider: 'Anthropic',
    badge: 'Coding & Vision',
    description: 'Industry-leading benchmark performance for programming, nuance, and logic.',
    context_length: 200000
  },
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    provider: 'OpenAI',
    badge: 'Flagship',
    description: 'OpenAI flagship multimodal powerhouse for complex reasoning and tasks.',
    context_length: 128000
  },
  {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'OpenAI',
    badge: 'Speed',
    description: 'Fast, lightweight and cost-effective for daily queries.',
    context_length: 128000
  },
  {
    id: 'deepseek/deepseek-r1',
    name: 'DeepSeek R1',
    provider: 'DeepSeek',
    badge: 'Reasoning',
    description: 'Open-weights reasoning model with chain-of-thought verification.',
    context_length: 64000
  },
  {
    id: 'mistralai/mistral-large-2411',
    name: 'Mistral Large 2',
    provider: 'Mistral AI',
    badge: 'Multilingual',
    description: 'Top-tier reasoning, math, and code capabilities from Mistral.',
    context_length: 128000
  },
  {
    id: 'google/gemini-2.0-flash-exp:free',
    name: 'Gemini 2.0 Flash (Free)',
    provider: 'Google (OpenRouter)',
    badge: 'Free Tier',
    description: 'Next-gen speed and multimodal capabilities via OpenRouter free tier.',
    context_length: 1048576
  }
];

export async function callOpenRouterStream({
  apiKey,
  model = 'meta-llama/llama-3.3-70b-instruct',
  messages = [],
  temperature = 0.7,
  onComplete,
  onError
}) {
  if (!apiKey) {
    throw new Error('OpenRouter API key is missing. Please configure OPENROUTER_API_KEY in worker secrets or enter your own key in Settings.');
  }

  // Ensure system prompt is present
  const formattedMessages = [...messages];
  if (!formattedMessages.some((m) => m.role === 'system')) {
    formattedMessages.unshift({
      role: 'system',
      content: 'You are Indus Agent, an advanced, helpful, and concise AI assistant modeled after ChatGPT. Provide helpful, accurate, well-formatted markdown responses with code highlights where appropriate.'
    });
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://indus-agent.pages.dev',
      'X-Title': 'Indus Agent',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: formattedMessages,
      temperature,
      stream: true
    })
  });

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = await response.json();
      errorDetail = errJson.error?.message || JSON.stringify(errJson);
    } catch {
      errorDetail = await response.text();
    }
    const err = new Error(`OpenRouter API error (${response.status}): ${errorDetail}`);
    if (onError) onError(err);
    throw err;
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let accumulatedText = '';

  const transformStream = new TransformStream({
    async transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      const lines = text.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const dataStr = trimmed.slice(6);

        if (dataStr === '[DONE]') {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
          continue;
        }

        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta) {
            accumulatedText += delta;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ delta, model: parsed.model || model })}\n\n`)
            );
          }
        } catch {
          // Incomplete chunk line, continue
        }
      }
    },
    async flush(controller) {
      if (onComplete) {
        try {
          await onComplete(accumulatedText);
        } catch (e) {
          console.error('onComplete callback failed:', e);
        }
      }
    }
  });

  return response.body.pipeThrough(transformStream);
}
