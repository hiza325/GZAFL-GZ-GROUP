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
 *   accesstrade             — cần ACCESSTRADE_API_KEY và campaign ID của từng sàn
 *                             (ACCESSTRADE_CAMPAIGN_SHOPEE / _TIKTOK / _TIKI,
 *                              hoặc ACCESSTRADE_CAMPAIGN_ID làm mặc định chung)
 *   shopee                  — cần SHOPEE_AFFILIATE_APP_ID + SHOPEE_AFFILIATE_SECRET
 *
 * Khi mới mở một sàn, có thể bật API thật riêng cho sàn đó bằng
 * AFFILIATE_LIVE_PLATFORMS (ví dụ: "TikTok Shop"). Các sàn còn lại vẫn dùng
 * link nội bộ /r/<mã> để app không bị lỗi trong lúc chờ duyệt campaign.
 */

const PROVIDER = String(process.env.AFFILIATE_PROVIDER || 'mock').toLowerCase();

// Danh sách sàn được dùng API thật. Để trống = tất cả các sàn.
const LIVE_PLATFORMS = String(process.env.AFFILIATE_LIVE_PLATFORMS || '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

function isLivePlatform(platform) {
  if (PROVIDER === 'mock') return false;
  if (!LIVE_PLATFORMS.length) return true;
  return LIVE_PLATFORMS.some((name) => name.toLowerCase() === String(platform || '').toLowerCase());
}

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
  // Sàn chưa được duyệt campaign: trả link nội bộ, không gọi API thật.
  if (!isLivePlatform(input.platform)) return convertMock(input);

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

   Tài liệu chính thức (đã đối chiếu):
     https://developers.accesstrade.vn/api-publisher-vietnamese/tao-tracking-link.md
   Lưu ý quan trọng:
   - `campaign_id` là số rất lớn (19 chữ số) -> phải giữ dạng CHUỖI,
     chuyển sang Number sẽ mất chữ số cuối và tạo link sai campaign.
   - Mỗi sàn là một campaign riêng. Cấu hình:
       ACCESSTRADE_CAMPAIGN_SHOPEE
       ACCESSTRADE_CAMPAIGN_TIKTOK
       ACCESSTRADE_CAMPAIGN_TIKI
     hoặc ACCESSTRADE_CAMPAIGN_ID làm mặc định chung.
   - Ta gắn 2 mã vào link:
       sub1 = gzafl-u<id>  : biết hoa hồng thuộc về ai
       sub2 = <mã đơn>     : biết hoa hồng thuộc đơn nào (để đối soát tự động)
     AccessTrade trả lại tất cả sub khi gọi postback (không cần cấu hình thêm).
   - Mọi tham số khác (utm_source...) để trống, tránh ghi đè dữ liệu của mạng.
========================================== */

const CAMPAIGN_ENV_BY_PLATFORM = {
  Shopee: 'ACCESSTRADE_CAMPAIGN_SHOPEE',
  'TikTok Shop': 'ACCESSTRADE_CAMPAIGN_TIKTOK',
  Tiki: 'ACCESSTRADE_CAMPAIGN_TIKI'
};

function campaignIdFor(platform) {
  const specificEnv = CAMPAIGN_ENV_BY_PLATFORM[platform];
  const specific = specificEnv ? String(process.env[specificEnv] || '').trim() : '';
  return specific || String(process.env.ACCESSTRADE_CAMPAIGN_ID || '').trim();
}

async function convertAccessTrade({ url, platform, subId, code }) {
  const apiKey = process.env.ACCESSTRADE_API_KEY;
  const campaignId = campaignIdFor(platform);

  if (!apiKey) {
    throw new AffiliateError(
      'Chưa cấu hình AccessTrade. Cần đặt ACCESSTRADE_API_KEY.'
    );
  }
  if (!campaignId) {
    const suggested = CAMPAIGN_ENV_BY_PLATFORM[platform] || 'ACCESSTRADE_CAMPAIGN_ID';
    throw new AffiliateError(
      `Chưa cấu hình campaign AccessTrade cho ${platform}. Đặt ${suggested} (hoặc ACCESSTRADE_CAMPAIGN_ID).`
    );
  }

  const body = {
    campaign_id: campaignId,
    urls: [url],
    url_enc: true,
    sub1: subId
  };
  if (code) body.sub2 = code;

  const shortDomain = String(process.env.ACCESSTRADE_SHORT_DOMAIN || '').trim();
  if (shortDomain) body.short_domain = shortDomain;

  let res;
  try {
    res = await fetch('https://api.accesstrade.vn/v1/product_link/create', {
      method: 'POST',
      headers: {
        // Tài liệu ghi chữ "token" thường; AccessTrade không phân biệt hoa/thường ở đây
        Authorization: `token ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      // Không để một API bên ngoài treo làm chậm việc tạo đơn của người dùng
      signal: AbortSignal.timeout(10000)
    });
  } catch (err) {
    throw new AffiliateError(`Không gọi được API AccessTrade: ${err.message}`);
  }

  if (res.status === 401 || res.status === 403) {
    throw new AffiliateError('AccessTrade từ chối API token (kiểm tra ACCESSTRADE_API_KEY).');
  }
  if (!res.ok) {
    throw new AffiliateError(`AccessTrade trả về lỗi HTTP ${res.status}.`);
  }

  const data = await res.json();
  const list = data && data.data && Array.isArray(data.data.success_link) ? data.data.success_link : [];
  const item = list[0] || null;
  const affiliateLink = item && (item.aff_link || item.short_link);

  if (!affiliateLink) {
    const failed =
      data && data.data && Array.isArray(data.data.error_link) && data.data.error_link[0]
        ? JSON.stringify(data.data.error_link[0])
        : 'không rõ lý do';
    throw new AffiliateError(`AccessTrade không tạo được link (${failed}).`);
  }

  return { affiliateLink: String(affiliateLink), provider: 'accesstrade', subId, isReal: true };
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
  const hasLive = PROVIDER !== 'mock';
  let note = 'Đang gọi API thật của nhà cung cấp affiliate.';
  if (!hasLive) {
    note = 'Chế độ thử nghiệm: link trả về là link nội bộ /r/<mã đơn>, KHÔNG tạo hoa hồng thật.';
  } else if (LIVE_PLATFORMS.length) {
    note = `Chỉ các sàn sau dùng API thật: ${LIVE_PLATFORMS.join(', ')}. Các sàn còn lại tạm dùng link thử nghiệm.`;
  }

  return {
    provider: PROVIDER,
    isReal: hasLive,
    livePlatforms: LIVE_PLATFORMS,
    note
  };
}

module.exports = {
  convert,
  describe,
  subIdFor,
  isLivePlatform,
  AffiliateError,
  PROVIDER,
  LIVE_PLATFORMS
};
