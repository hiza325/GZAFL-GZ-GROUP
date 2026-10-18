'use strict';

/**
 * Chuyển link sản phẩm của người dùng thành link mua hàng CÓ GHI NHẬN HOA HỒNG.
 *
 * Nguyên tắc: KHÔNG thể tạo hoa hồng bằng cách tự thêm tham số vào link.
 * Muốn có ghi nhận thật, bắt buộc phải có tài khoản affiliate đã được duyệt
 * (Shopee Affiliate Open API, hoặc một mạng trung gian như AccessTrade / Adpia
 * / Ecomobi) rồi gọi API do họ cấp.
 *
 * Thiết kế đầy đủ + lộ trình: docs/affiliate-integration.md
 *
 * Chọn nhà cung cấp bằng biến môi trường AFFILIATE_PROVIDER:
 *   mock         (mặc định) — chạy thử được toàn bộ luồng, KHÔNG tạo hoa hồng thật
 *   accesstrade             — cần ACCESSTRADE_API_KEY + ACCESSTRADE_CAMPAIGN_ID
 *   shopee                  — cần SHOPEE_AFFILIATE_APP_ID + SHOPEE_AFFILIATE_SECRET
 */

const PROVIDER = String(process.env.AFFILIATE_PROVIDER || 'mock').toLowerCase();

class AffiliateError extends Error {}

// Mã định danh người dùng gắn vào link. Đây là mấu chốt để biết hoa hồng thuộc về ai.
function subIdFor(userId) {
  const prefix = process.env.AFFILIATE_SUB_ID_PREFIX || 'gzafl';
  return `${prefix}-u${userId}`;
}

/**
 * @param {{ url: string, platform: string, subId: string, code: string, baseUrl: string }} input
 * @returns {Promise<{ affiliateLink: string, provider: string, subId: string|null, isReal: boolean }>}
 */
async function convert(input) {
  switch (PROVIDER) {
    case 'mock':
      return convertMock(input);
    case 'accesstrade':
      return convertAccessTrade(input);
    case 'shopee':
      return convertShopee(input);
    default:
      throw new AffiliateError(`AFFILIATE_PROVIDER không hợp lệ: "${PROVIDER}"`);
  }
}

/* ==========================================
   Nhà cung cấp "mock" — chạy thử không cần tài khoản
   Trả về link nội bộ /r/<mã đơn>. Khi người dùng bấm, server ghi nhận
   lượt click rồi chuyển hướng sang link gốc. KHÔNG tạo ra hoa hồng.
========================================== */
function convertMock({ code, baseUrl, subId }) {
  return Promise.resolve({
    affiliateLink: `${baseUrl}/r/${code}?sub=${encodeURIComponent(subId)}`,
    provider: 'mock',
    subId,
    isReal: false
  });
}

/* ==========================================
   AccessTrade (mạng trung gian, phủ nhiều sàn)
========================================== */
async function convertAccessTrade({ url, subId }) {
  const apiKey = process.env.ACCESSTRADE_API_KEY;
  const campaignId = process.env.ACCESSTRADE_CAMPAIGN_ID;

  if (!apiKey || !campaignId) {
    throw new AffiliateError(
      'Chưa cấu hình AccessTrade. Cần đặt ACCESSTRADE_API_KEY và ACCESSTRADE_CAMPAIGN_ID.'
    );
  }

  // ⚠️ Endpoint và cấu trúc body phải đối chiếu lại tài liệu chính thức khi có
  // tài khoản — xem docs/affiliate-integration.md mục 3.2.
  const res = await fetch('https://api.accesstrade.vn/v1/create_link', {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      campaign_id: Number(campaignId),
      urls: [url],
      sub_ids: [subId]
    })
  });

  if (!res.ok) {
    throw new AffiliateError(`AccessTrade trả về lỗi HTTP ${res.status}.`);
  }

  const data = await res.json();
  const item = data && data.data && Array.isArray(data.data.success_link) ? data.data.success_link[0] : null;
  const affiliateLink = item && (item.aff_link || item.short_link);

  if (!affiliateLink) {
    throw new AffiliateError('AccessTrade không trả về link hoàn tiền.');
  }

  return { affiliateLink, provider: 'accesstrade', subId, isReal: true };
}

/* ==========================================
   Shopee Affiliate Open API (API chính thức của sàn)
========================================== */
async function convertShopee() {
  const appId = process.env.SHOPEE_AFFILIATE_APP_ID;
  const secret = process.env.SHOPEE_AFFILIATE_SECRET;

  if (!appId || !secret) {
    throw new AffiliateError(
      'Chưa cấu hình Shopee Affiliate. Cần đặt SHOPEE_AFFILIATE_APP_ID và SHOPEE_AFFILIATE_SECRET.'
    );
  }

  // Endpoint đã kiểm chứng: https://open-api.affiliate.shopee.vn/graphql
  // (GraphQL, bắt buộc header Authorization có chữ ký).
  //
  // Cố tình dừng ở đây: cách ký request và tên trường của mutation
  // `generateShortLink` phải đối chiếu tài liệu chính thức khi đã có App ID.
  // Đoán sai sẽ tạo ra link không ghi nhận hoa hồng mà vẫn báo "thành công".
  // Xem docs/affiliate-integration.md mục 7.4.
  throw new AffiliateError(
    'Provider "shopee" chưa được cài đặt: cần xác nhận cách ký request từ tài liệu chính thức.'
  );
}

function describe() {
  return {
    provider: PROVIDER,
    isReal: PROVIDER !== 'mock',
    note:
      PROVIDER === 'mock'
        ? 'Chế độ thử nghiệm: link trả về là link nội bộ /r/<mã đơn>, KHÔNG tạo hoa hồng thật.'
        : 'Đang gọi API thật của nhà cung cấp affiliate.'
  };
}

module.exports = { convert, describe, subIdFor, AffiliateError, PROVIDER };
