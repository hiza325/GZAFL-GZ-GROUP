'use strict';

/**
 * Gọi API AI theo chuẩn OpenAI (`POST /chat/completions`).
 *
 * Chuẩn này dùng được cho nhiều nhà cung cấp, kể cả các gói miễn phí:
 *   - Google Gemini : AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
 *                     AI_MODEL=gemini-2.5-flash        (khoá có dạng AIza...)
 *   - Groq          : AI_BASE_URL=https://api.groq.com/openai/v1
 *                     AI_MODEL=llama-3.3-70b-versatile (khoá có dạng gsk_...)
 *   - OpenRouter    : AI_BASE_URL=https://openrouter.ai/api/v1
 *                     AI_MODEL=meta-llama/llama-3.3-70b-instruct:free
 *   - OpenAI        : AI_BASE_URL=https://api.openai.com/v1, AI_MODEL=gpt-4o-mini
 *
 * Nếu bạn chỉ điền AI_API_KEY mà bỏ trống AI_BASE_URL / AI_MODEL thì module này
 * tự đoán nhà cung cấp theo tiền tố của khoá (xem PROVIDER_HINTS). Đoán xong sẽ in ra
 * lúc khởi động để bạn kiểm tra lại.
 *
 * QUAN TRỌNG: khoá API chỉ nằm ở server, không bao giờ gửi xuống trình duyệt.
 * Chưa cấu hình khoá -> trợ lý tự trả lời theo kịch bản trong lib/supportKnowledge.js.
 */

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

// Đoán nhà cung cấp theo tiền tố khoá API (chỉ dùng khi .env không ghi rõ base URL/model)
const PROVIDER_HINTS = [
  {
    name: 'Google Gemini',
    match: /^AIza/,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash'
  },
  {
    name: 'Groq',
    match: /^gsk_/,
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile'
  },
  {
    name: 'OpenRouter',
    match: /^sk-or-/,
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct:free'
  }
];

/** AI_ENABLED = off/false/0 -> tạm tắt AI dù đã có khoá. */
function aiMode() {
  const raw = String(process.env.AI_ENABLED || 'auto').trim().toLowerCase();
  return raw === 'off' || raw === 'false' || raw === '0' || raw === 'no' ? 'off' : 'auto';
}

/** Đọc cấu hình tại thời điểm gọi (đổi .env xong khởi động lại là có hiệu lực). */
function config() {
  const apiKey = String(process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '').trim();

  const hint = apiKey ? PROVIDER_HINTS.find((item) => item.match.test(apiKey)) : null;

  const baseUrl = (String(process.env.AI_BASE_URL || '').trim() || (hint ? hint.baseUrl : DEFAULT_BASE_URL))
    .replace(/\/+$/, '');
  const model = String(process.env.AI_MODEL || '').trim() || (hint ? hint.model : DEFAULT_MODEL);

  return {
    apiKey,
    baseUrl,
    model,
    provider: hint ? hint.name : 'OpenAI',
    enabled: aiMode() !== 'off',
    timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 25000,
    maxTokens: Number(process.env.AI_MAX_TOKENS) || 600,
    temperature: Number(process.env.AI_TEMPERATURE) || 0.4
  };
}

/** Trợ lý AI có sẵn sàng không? (có khoá + không bị tắt) */
function isConfigured() {
  const cfg = config();
  return Boolean(cfg.apiKey) && cfg.enabled;
}

/** Thông tin ngắn gọn để in lúc khởi động server. */
function describe() {
  const cfg = config();
  return {
    configured: Boolean(cfg.apiKey) && cfg.enabled,
    hasKey: Boolean(cfg.apiKey),
    enabled: cfg.enabled,
    provider: cfg.provider,
    model: cfg.model,
    baseUrl: cfg.baseUrl
  };
}

/** Gọi API, trả về nội dung trả lời (chuỗi). Ném lỗi nếu thất bại. */
async function chat(messages) {
  const cfg = config();
  if (!cfg.apiKey) throw new Error('Chưa cấu hình AI_API_KEY.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: cfg.temperature,
        max_tokens: cfg.maxTokens
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Khoá API không hợp lệ hoặc không đủ quyền (${res.status}). ${detail}`);
      }
      if (res.status === 404) {
        throw new Error(`Không tìm thấy model/đường dẫn API (404). Kiểm tra AI_BASE_URL và AI_MODEL. ${detail}`);
      }
      if (res.status === 429) {
        throw new Error(`Đã hết hạn mức gọi API (429). ${detail}`);
      }
      throw new Error(`API trả về lỗi ${res.status}: ${detail}`);
    }

    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : null;

    if (!content) throw new Error('API không trả về nội dung trả lời.');

    // Một số model của Gemini bọc câu trả lời trong mảng parts
    const text = Array.isArray(content)
      ? content.map((part) => (part && part.text) || '').join('').trim()
      : String(content).trim();

    if (!text) throw new Error('API trả về nội dung rỗng.');
    return text;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`Quá thời gian chờ AI (${cfg.timeoutMs}ms).`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Hỏi trợ lý: tự thêm "system prompt" chứa kiến thức của web rồi gọi API.
 * `history` là mảng [{ role: 'user'|'assistant', content }] đã được lọc ở route.
 */
async function ask(history) {
  const { buildSystemPrompt } = require('./supportKnowledge');
  const messages = [{ role: 'system', content: buildSystemPrompt() }, ...history];
  return chat(messages);
}

module.exports = {
  isConfigured,
  describe,
  chat,
  ask,
  config
};
