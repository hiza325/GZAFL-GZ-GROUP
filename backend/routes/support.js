'use strict';

/**
 * API cho TRỢ LÝ HỖ TRỢ (chatbot ở góc phải-dưới mọi trang).
 *
 * - Hoạt động cả khi chưa đăng nhập (khách vãng lai vẫn hỏi được).
 * - Có AI_API_KEY  -> trả lời bằng AI (xem lib/ai.js), kèm kiến thức của web trong system prompt.
 * - Chưa có khoá   -> trả lời theo kịch bản có sẵn (lib/supportKnowledge.js).
 * - AI lỗi/hết hạn mức -> tự lùi về kịch bản, người dùng không bị "đứng" khung chat.
 * - Có trần TỔNG lượt gọi AI mỗi ngày (AI_DAILY_LIMIT) để chặn lạm dụng quota từ nhiều IP.
 *
 * Lịch sử hội thoại do TRÌNH DUYỆT giữ (localStorage) rồi gửi lên kèm, server không lưu gì.
 */

const express = require('express');
const db = require('../db');
const { rateLimit } = require('../lib/rateLimit');
const ai = require('../lib/ai');
const knowledge = require('../lib/supportKnowledge');

const router = express.Router();

const MAX_MESSAGES = 12;   // chỉ gửi kèm 12 tin nhắn gần nhất để tiết kiệm token
const MAX_LENGTH = 1200;   // ký tự tối đa mỗi tin nhắn
const MAX_TOTAL = 8000;    // tổng ký tự tối đa cả đoạn hội thoại gửi lên

// 30 tin nhắn / 10 phút cho mỗi IP (đủ thoải mái cho người dùng thật, chặn spam khoá API)
const chatRateLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, name: 'support-chat' });

/**
 * Hạn mức TỔNG số lượt gọi AI trong một ngày — lá chắn cuối cùng cho quota/chi phí.
 *
 * Vì trợ lý hoạt động cả khi chưa đăng nhập, kẻ xấu rải từ nhiều IP có thể lách
 * giới hạn theo-IP. Trần theo ngày sẽ khoá van lại: khi vượt, trợ lý vẫn trả lời
 * nhưng bằng kịch bản có sẵn (không gọi AI), người dùng không thấy lỗi.
 *
 * Trần đọc từ AI_DAILY_LIMIT trong .env; đặt 0 = không giới hạn.
 */
const AI_DAILY_LIMIT =
  process.env.AI_DAILY_LIMIT !== undefined && Number(process.env.AI_DAILY_LIMIT) >= 0
    ? Math.floor(Number(process.env.AI_DAILY_LIMIT))
    : 800;

// Bộ đếm nằm trong SQLite (bảng ai_usage) để nhiều tiến trình dùng chung.
// Trước đây để trong RAM: chạy 2-4 instance thì mỗi instance đều tưởng mình
// còn đủ hạn mức, tổng lượt gọi AI có thể vượt trần nhiều lần.
const AI_USAGE_KEEP_DAYS = 31;

function dayString(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function currentDay() {
  return dayString(0);
}

// Dọn bản ghi cũ một lần lúc nạp module (bảng chỉ có 1 dòng/ngày).
try {
  db.prepare('DELETE FROM ai_usage WHERE day < ?').run(dayString(-AI_USAGE_KEEP_DAYS));
} catch (err) {
  console.warn(`Không dọn được ai_usage cũ: ${err.message}`);
}

/** Số lượt AI còn lại hôm nay (Infinity nếu không giới hạn). */
function aiQuotaLeft() {
  if (AI_DAILY_LIMIT <= 0) return Infinity;
  try {
    const row = db.prepare('SELECT count FROM ai_usage WHERE day = ?').get(currentDay());
    return Math.max(0, AI_DAILY_LIMIT - (Number(row && row.count) || 0));
  } catch (err) {
    console.error('Không đọc được hạn mức AI:', err.message);
    return 0; // thận trọng: coi như đã hết, trả lời bằng kịch bản
  }
}

/**
 * Giữ chỗ MỘT lượt gọi AI (tăng bộ đếm trước khi gọi).
 * Dùng UPSERT ... RETURNING nên hai request đồng thời không cùng lọt qua trần.
 * Nếu vượt trần thì trả lại lượt vừa giữ và báo false.
 */
function reserveAiQuota() {
  if (AI_DAILY_LIMIT <= 0) return true;

  const day = currentDay();
  try {
    const row = db
      .prepare(
        `INSERT INTO ai_usage (day, count) VALUES (?, 1)
         ON CONFLICT(day) DO UPDATE SET count = count + 1
         RETURNING count`
      )
      .get(day);

    const used = Number(row && row.count) || 1;
    if (used > AI_DAILY_LIMIT) {
      try {
        db.prepare('UPDATE ai_usage SET count = count - 1 WHERE day = ?').run(day);
      } catch (err) {
        // Không trả lại được lượt cũng không sao: bộ đếm chỉ hơi cao hơn thực tế
      }
      return false;
    }
    return true;
  } catch (err) {
    console.error('Không ghi được hạn mức AI:', err.message);
    return false; // không gọi AI khi không kiểm soát được chi phí
  }
}

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
  const cfg = ai.config();
  const left = aiQuotaLeft();
  res.json({
    ai: info.configured,
    provider: info.configured ? info.provider : null,
    model: info.configured ? info.model : null,
    maxTokens: info.configured ? cfg.maxTokens : null,
    timeoutMs: info.configured ? cfg.timeoutMs : null,
    dailyLimit: AI_DAILY_LIMIT,
    usedToday: AI_DAILY_LIMIT > 0 ? AI_DAILY_LIMIT - left : 0,
    remainingToday: AI_DAILY_LIMIT > 0 ? left : null,
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

  // Hết hạn mức AI trong ngày -> vẫn trả lời, nhưng bằng kịch bản có sẵn
  if (!reserveAiQuota()) {
    console.warn(`Đã chạm hạn mức AI trong ngày (${AI_DAILY_LIMIT} lượt), tạm dùng kịch bản có sẵn.`);
    return res.json({
      reply: knowledge.faqAnswer(question) || knowledge.fallbackAnswer(),
      source: 'faq',
      notice: 'Trợ lý AI đã đạt giới hạn trong ngày nên mình trả lời bằng kiến thức có sẵn. Bạn thử lại sau hoặc liên hệ hỗ trợ nhé.'
    });
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
