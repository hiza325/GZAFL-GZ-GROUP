'use strict';

/**
 * API cho TRỢ LÝ HỖ TRỢ (chatbot ở góc phải-dưới mọi trang).
 *
 * - Hoạt động cả khi chưa đăng nhập (khách vãng lai vẫn hỏi được).
 * - Có AI_API_KEY  -> trả lời bằng AI (xem lib/ai.js), kèm kiến thức của web trong system prompt.
 * - Chưa có khoá   -> trả lời theo kịch bản có sẵn (lib/supportKnowledge.js).
 * - AI lỗi/hết hạn mức -> tự lùi về kịch bản, người dùng không bị "đứng" khung chat.
 *
 * Lịch sử hội thoại do TRÌNH DUYỆT giữ (localStorage) rồi gửi lên kèm, server không lưu gì.
 */

const express = require('express');
const { rateLimit } = require('../lib/rateLimit');
const ai = require('../lib/ai');
const knowledge = require('../lib/supportKnowledge');

const router = express.Router();

const MAX_MESSAGES = 12;   // chỉ gửi kèm 12 tin nhắn gần nhất để tiết kiệm token
const MAX_LENGTH = 1200;   // ký tự tối đa mỗi tin nhắn
const MAX_TOTAL = 8000;    // tổng ký tự tối đa cả đoạn hội thoại gửi lên

// 30 tin nhắn / 10 phút cho mỗi IP (đủ thoải mái cho người dùng thật, chặn spam khoá API)
const chatRateLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 30 });

/**
 * Lọc và chuẩn hoá lịch sử hội thoại do client gửi lên.
 * Trả về null nếu dữ liệu không dùng được.
 */
function normalizeHistory(input) {
  if (!Array.isArray(input)) return null;

  const cleaned = [];
  for (const item of input.slice(-MAX_MESSAGES)) {
    if (!item || typeof item !== 'object') continue;

    const role = item.role === 'user' ? 'user' : item.role === 'assistant' ? 'assistant' : null;
    if (!role) continue;

    const content = String(item.content == null ? '' : item.content).trim().slice(0, MAX_LENGTH);
    if (!content) continue;

    // Gộp các tin nhắn liền nhau cùng vai trò (một số nhà cung cấp yêu cầu vai trò xen kẽ nhau)
    const last = cleaned[cleaned.length - 1];
    if (last && last.role === role) last.content = `${last.content}\n${content}`.slice(0, MAX_LENGTH);
    else cleaned.push({ role, content });
  }

  // Bỏ các tin nhắn trợ lý ở đầu (lời chào) — đoạn hội thoại phải bắt đầu bằng câu hỏi của người dùng
  while (cleaned.length && cleaned[0].role === 'assistant') cleaned.shift();

  if (!cleaned.length || cleaned[cleaned.length - 1].role !== 'user') return null;

  const total = cleaned.reduce((sum, item) => sum + item.content.length, 0);
  if (total > MAX_TOTAL) return null;

  return cleaned;
}

/** Trạng thái trợ lý (dùng để kiểm tra nhanh khi cấu hình .env). */
router.get('/status', (req, res) => {
  const info = ai.describe();
  res.json({
    ai: info.configured,
    provider: info.configured ? info.provider : null,
    model: info.configured ? info.model : null,
    suggestions: knowledge.SUGGESTIONS.length
  });
});

/** Hỏi trợ lý. Body: { messages: [{ role: 'user'|'assistant', content }] } */
router.post('/chat', chatRateLimit, async (req, res) => {
  const history = normalizeHistory(req.body && req.body.messages);
  if (!history) return res.status(400).json({ error: 'Tin nhắn không hợp lệ.' });

  const question = history[history.length - 1].content;

  // Chưa cấu hình AI -> trả lời theo kịch bản có sẵn
  if (!ai.isConfigured()) {
    return res.json({ reply: knowledge.faqAnswer(question) || knowledge.fallbackAnswer(), source: 'faq' });
  }

  try {
    const reply = await ai.ask(history);
    return res.json({ reply, source: 'ai' });
  } catch (err) {
    // AI lỗi (sai khoá, hết hạn mức, mất mạng...) -> vẫn trả lời được bằng kịch bản có sẵn
    console.error('Lỗi trợ lý AI:', err.message);
    return res.json({
      reply: knowledge.faqAnswer(question) || knowledge.fallbackAnswer(),
      source: 'faq',
      notice: 'Trợ lý AI đang tạm bận nên mình trả lời bằng kiến thức có sẵn.'
    });
  }
});

module.exports = router;
