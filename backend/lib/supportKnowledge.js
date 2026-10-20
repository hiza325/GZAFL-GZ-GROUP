'use strict';

/**
 * Kiến thức nền của TRỢ LÝ HỖ TRỢ (chatbot).
 *
 * Đây là nguồn duy nhất cho cả hai chế độ hoạt động:
 *   1. Có AI_API_KEY  -> nội dung này được nhét vào "system prompt" để AI trả lời
 *                        đúng thực tế của web, không bịa thêm chính sách/con số.
 *   2. Chưa có API key (hoặc AI lỗi) -> trợ lý tự khớp từ khoá trong câu hỏi và
 *                        trả lời thẳng theo TOPICS bên dưới.
 *
 * Vì vậy sửa nội dung ở đây là sửa cho cả hai chế độ. Các con số quan trọng
 * (mức rút tối thiểu, độ dài mã OTP, email/Zalo hỗ trợ) được đọc từ cấu hình thật
 * để trợ lý không trả lời sai khi bạn đổi .env.
 *
 * LƯU Ý khi sửa TOPICS: từ khoá (keywords) viết KHÔNG dấu cũng được, vì khi so khớp
 * cả câu hỏi và từ khoá đều được bỏ dấu. Nên thêm cả cách nói không dấu mà người dùng
 * hay gõ (ví dụ "rut tien", "bao lau").
 */

const { WITHDRAWAL_MIN } = require('./constants');
const { formatMoney } = require('./format');
const { CODE_LENGTH, TTL_SECONDS, RESEND_COOLDOWN_SECONDS } = require('./otp');

const minWithdrawal = formatMoney(WITHDRAWAL_MIN);
const otpTtlMinutes = Math.round(TTL_SECONDS / 60);

/** Thông tin liên hệ hỗ trợ lấy từ backend/.env (rỗng nếu chưa cấu hình). */
function supportContact() {
  const email = String(process.env.SUPPORT_EMAIL || '').trim();
  const zalo = String(process.env.SUPPORT_ZALO || '').trim();

  const parts = [];
  if (zalo) parts.push(`điện thoại/Zalo ${zalo}`);
  if (email) parts.push(`email ${email}`);

  return { email, zalo, line: parts.join(' hoặc ') };
}

/** Câu trả lời mẫu khi không khớp được chủ đề nào. */
function fallbackAnswer() {
  const contact = supportContact();
  const contactLine = contact.line
    ? `Nếu cần gấp, bạn liên hệ trực tiếp qua ${contact.line} nhé.`
    : 'Nếu cần gấp, bạn dùng nút "Liên hệ hỗ trợ" ngay trong khung chat này nhé.';

  return [
    'Mình chưa chắc chắn về câu hỏi này. Bạn thử hỏi lại theo cách khác, hoặc bấm một trong các gợi ý ở dưới nhé.',
    '',
    contactLine
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Nội dung kiến thức
// ---------------------------------------------------------------------------

const TOPICS = [
  {
    id: 'tao-don',
    title: 'Tạo đơn hoàn tiền & lấy link',
    keywords: [
      'tao don', 'link hoan tien', 'lay link', 'dan link', 'chuyen doi link',
      'mua hang', 'cach mua', 'shopee', 'tiktok', 'tiki', 'lazada', 'tao link', 'kiem tra hoa hong'
    ],
    answer: [
      'Cách tạo đơn hoàn tiền:',
      '1. Vào mục "Tạo đơn hàng" (hoặc dán link ngay ở trang chủ rồi bấm "Chuyển đổi link").',
      '2. Dán link sản phẩm Shopee / TikTok Shop / Tiki / Lazada vào ô nhập link — mỗi lần chỉ 1 link.',
      '3. Bấm "Tạo link & kiểm tra hoa hồng" để nhận link hoàn tiền của bạn.',
      '4. Bấm "Mua ngay" (hoặc copy link dán vào trình duyệt) rồi mua hàng trong đúng phiên đó.',
      'Quan trọng: mua đúng sản phẩm trong link, không đổi thiết bị/trình duyệt và không xoá cookie giữa chừng, nếu không đơn sẽ không được ghi nhận.'
    ].join('\n')
  },
  {
    id: 'thoi-gian-hoa-hong',
    title: 'Bao lâu mới nhận được hoa hồng',
    keywords: [
      'bao lau', 'khi nao', 'bao nhieu ngay', 'thoi gian', 'ghi nhan', 'tam giu',
      'hoa hong', 'doi soat', 'cho duyet', 'dang xu ly', 'hoan thanh', 'vao vi', 'admin duyet'
    ],
    answer: [
      'Sau khi bạn mua, đơn nằm ở trạng thái "Đang xử lý".',
      'Hệ thống chờ sàn đối soát (thường vài ngày, có sàn tới khoảng 30 ngày) rồi ghi nhận hoa hồng.',
      'Khi mạng báo đã duyệt, đơn chuyển sang "Chờ admin duyệt".',
      'Quản trị viên kiểm tra và duyệt đơn thì hoa hồng mới được cộng vào ví. Không có thời gian tạm giữ cố định.',
      'Sau khi được duyệt, bạn có thể rút khi số dư đạt mức tối thiểu.',
      'Đơn bị huỷ/hoàn trả sẽ chuyển thành "Đã huỷ" và hoa hồng bị thu hồi.'
    ].join('\n')
  },
  {
    id: 'don-khong-ghi-nhan',
    title: 'Đơn không được ghi nhận hoa hồng',
    keywords: [
      'khong duoc ghi nhan', 'khong thay don', 'khong co hoa hong', 'hoa hong 0',
      'bi huy', 'khong tinh', 'mat don', 'khong hien don'
    ],
    answer: [
      'Đơn thường không được ghi nhận hoa hồng khi:',
      '- Bạn không mua qua link hoàn tiền (mở link Shopee/TikTok/Tiki/Lazada trực tiếp).',
      '- Mua ở thiết bị/trình duyệt khác, hoặc dùng chế độ ẩn danh.',
      '- Xoá cookie hoặc mở link rồi mua sau quá lâu trong một phiên khác.',
      '- Đơn bị huỷ/hoàn trả, hoặc áp thêm mã giảm giá không thuộc sàn.',
      'Bạn thử tạo link mới rồi mua lại trong đúng phiên. Trong "Đơn hàng đã đặt" bạn xem được trạng thái và số lượt bấm của từng link.'
    ].join('\n')
  },
  {
    id: 'hoa-hong-thu-hoi',
    title: 'Hoa hồng bị thu hồi / số dư âm',
    keywords: [
      'thu hoi', 'hoa hong bi thu hoi', 'hoa hong bi huy', 'hoan tra', 'tra hang',
      'so du am', 'bi tru', 'no', 'can hoan lai', 'clawback'
    ],
    answer: [
      'Khi đơn bị huỷ/hoàn trả sau khi đã ghi hoa hồng, hệ thống ghi nhận thu hồi khoản hoa hồng đó.',
      'Nếu bạn chưa rút, khoản thu hồi chỉ làm giảm hoa hồng và số dư khả dụng.',
      'Nếu bạn đã rút trước đó, số dư có thể âm và ví hiện "Cần hoàn lại". Khoản này sẽ tự trừ vào hoa hồng tiếp theo.',
      'Bạn không cần chuyển tiền lại; cứ tiếp tục mua sắm, hệ thống tự cấn trừ.',
      'Nếu thấy sai, hãy gửi mã đơn hàng để được kiểm tra.'
    ].join('\n')
  },
  {
    id: 'rut-tien',
    title: 'Rút tiền',
    keywords: [
      'rut tien', 'rut', 'so du', 'toi thieu', 'bao lau nhan tien', 'chi tra',
      'chuyen khoan', 'lenh rut', 'khi nao nhan tien'
    ],
    answer: [
      `Mức rút tối thiểu là ${minWithdrawal}.`,
      'Số dư khả dụng = hoa hồng đã được admin duyệt - tiền đã rút.',
      'Mỗi lần rút là rút TOÀN BỘ số dư khả dụng, và mỗi tài khoản chỉ được có 1 lệnh rút đang xử lý tại một thời điểm.',
      'Bạn chọn 1 trong 2 cách nhận tiền: (1) nhập ngân hàng/ví + số tài khoản + tên chủ tài khoản, hoặc (2) tải lên ảnh QR nhận tiền.',
      'Sau khi gửi, lệnh ở trạng thái "Đang xử lý"; quản trị viên kiểm tra và chuyển khoản, tiền thường về trong vài giờ đến 1 ngày làm việc.',
      'Nếu hoa hồng bị thu hồi sau khi bạn đã rút, số dư có thể âm và khoản đó tự trừ vào hoa hồng tiếp theo.',
      'Trạng thái lệnh rút: "Đang xử lý" -> "Đã thanh toán" (hoặc "Đã huỷ" nếu thông tin sai).'
    ].join('\n')
  },
  {
    id: 'rut-qr',
    title: 'Rút tiền bằng ảnh QR',
    keywords: ['qr', 'anh qr', 'ma qr', 'vietqr', 'quet ma', 'tai anh'],
    answer: [
      'Trong hộp thoại "Rút tiền", chọn cách nhận tiền là "Ảnh QR" rồi bấm "Tải ảnh QR lên".',
      'Ảnh phải là PNG hoặc JPG, tối đa 2MB. Ảnh QR cần có sẵn số tài khoản và tên người nhận (ảnh chụp trong app ngân hàng thường dùng được).',
      'Chọn cách này thì bạn không cần nhập thêm số tài khoản hay tên chủ tài khoản.',
      'Bạn có thể đổi hoặc xoá ảnh QR đã lưu ở trang "Cá nhân".'
    ].join('\n')
  },
  {
    id: 'lenh-rut-huy',
    title: 'Lệnh rút bị huỷ / nhập sai thông tin',
    keywords: [
      'sai so tai khoan', 'sai thong tin', 'nhap sai', 'rut that bai',
      'lenh rut bi huy', 'bi huy rut', 'khong nhan duoc tien', 'chua nhan duoc tien'
    ],
    answer: [
      'Khi bạn gửi lệnh rút, số dư đó được giữ lại cho lệnh. Nếu lệnh bị "Đã huỷ", số tiền được trả lại vào số dư khả dụng nên bạn có thể gửi lệnh rút mới.',
      'Nếu bạn ghi sai số tài khoản/tên chủ tài khoản: vào trang "Cá nhân" kiểm tra lại "Tài khoản nhận tiền" (hoặc ảnh QR) rồi gửi lại lệnh rút.',
      'Khi nhận tiền, tên chủ tài khoản phải viết không dấu và trùng với tên đăng ký ngân hàng.',
      'Nếu đã quá lâu chưa thấy tiền, hãy dùng nút "Liên hệ hỗ trợ" và gửi kèm mã lệnh rút để được kiểm tra.'
    ].join('\n')
  },
  {
    id: 'tai-khoan-otp',
    title: 'Đăng ký, đăng nhập, mã OTP và mật khẩu',
    keywords: [
      'otp', 'ma xac thuc', 'ma xac nhan', 'khong nhan duoc ma', 'khong nhan duoc mail',
      'dang nhap', 'dang ky', 'mat khau', 'quen mat khau', 'doi mat khau', 'doi email',
      'email xac thuc', 'spam'
    ],
    answer: [
      `Tài khoản dùng email để xác thực: khi đăng ký bạn nhập email và mã xác thực ${CODE_LENGTH} chữ số gửi về email đó (hiệu lực ${otpTtlMinutes} phút).`,
      'Khi đăng nhập, hệ thống có thể gửi thêm một mã xác thực về email để bảo vệ tài khoản.',
      `Không thấy mail: kiểm tra thư rác/Spam, chờ ${RESEND_COOLDOWN_SECONDS} giây rồi bấm "Gửi lại mã", và chắc chắn email nhập đúng chính tả.`,
      'Quên mật khẩu: ở màn hình đăng nhập bấm "Quên mật khẩu" -> nhập tên đăng nhập -> nhận mã OTP -> đặt mật khẩu mới.',
      'Muốn đổi email hoặc mật khẩu: vào trang "Cá nhân" (mục Bảo mật).'
    ].join('\n')
  },
  {
    id: 'moi-ban',
    title: 'Mời bạn bè & điểm thưởng',
    keywords: [
      'moi ban', 'gioi thieu', 'ma gioi thieu', 'diem', 'diem thuong', 'nhan thuong', 'ref'
    ],
    answer: [
      'Mỗi tài khoản có một mã giới thiệu 6 ký tự ở trang "Mời bạn bè"; mã gắn cố định với tài khoản của bạn.',
      'Khi người khác nhập mã của bạn, người NHẬP mã được cộng ngay 100 điểm thưởng.',
      'Bạn không thể nhập mã của chính mình, và mỗi mã chỉ nhập được một lần cho mỗi tài khoản.',
      'Điểm thưởng hiển thị ở trang "Mời bạn bè" và được cộng vào tài khoản ngay khi nhập thành công.'
    ].join('\n')
  },
  {
    id: 'lien-he',
    title: 'Liên hệ hỗ trợ',
    keywords: [
      'lien he', 'ho tro', 'hotline', 'zalo', 'so dien thoai', 'gap nguoi',
      'noi chuyen voi nguoi', 'admin', 'bao loi', 'khieu nai'
    ],
    answer: [
      supportContact().line
        ? `Bạn liên hệ trực tiếp qua ${supportContact().line}.`
        : 'Bạn dùng nút "Liên hệ hỗ trợ" ngay trong khung chat này để lấy thông tin liên hệ.',
      'Khi liên hệ, bạn nên gửi kèm tên đăng nhập và mã đơn (ví dụ GZ346578) để được kiểm tra nhanh hơn.',
      'Bạn cũng có thể bấm nút "Liên hệ hỗ trợ" ở dưới khung chat để xem lại thông tin bất cứ lúc nào.'
    ].join('\n')
  },
  {
    id: 'bao-mat',
    title: 'An toàn & bảo mật tài khoản',
    keywords: [
      'bao mat', 'an toan', 'lua dao', 'bi hack', 'chia se mat khau', 'ma otp cho nguoi khac'
    ],
    answer: [
      'GZ AFL không bao giờ hỏi mật khẩu, mã OTP của bạn và không yêu cầu bạn chuyển tiền để được nhận hoàn tiền.',
      'Chỉ đăng nhập tại đúng địa chỉ website và không chia sẻ mã OTP cho bất kỳ ai (kể cả người tự nhận là nhân viên hỗ trợ).',
      'Nếu nghi ngờ tài khoản bị xâm nhập: đổi mật khẩu trong trang "Cá nhân" rồi liên hệ hỗ trợ ngay.'
    ].join('\n')
  }
];

/** Gợi ý câu hỏi hiện sẵn trong khung chat (giao diện lấy qua GET /api/config). */
const SUGGESTIONS = [
  'Làm sao tạo đơn hoàn tiền?',
  'Khi nào hoa hồng vào ví?',
  'Rút tiền thế nào?',
  'Mức rút tối thiểu là bao nhiêu?',
  'Hoa hồng bị thu hồi thì sao?',
  'Rút tiền bằng ảnh QR thế nào?',
  'Không nhận được mã OTP?',
  'Mời bạn bè nhận thưởng ra sao?'
];

const WELCOME =
  'Xin chào 👋 Mình là trợ lý ảo của GZ AFL. Bạn cần hỗ trợ gì?\n' +
  'Bạn có thể bấm một gợi ý bên dưới hoặc nhập câu hỏi của mình.';

// ---------------------------------------------------------------------------
// Bỏ dấu tiếng Việt để so khớp từ khoá (người dùng gõ có dấu hay không dấu đều khớp)
// ---------------------------------------------------------------------------

function normalize(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // bỏ dấu thanh + dấu phụ
    .replace(/đ/g, 'd')             // 'đ' không tự tách được bằng NFD
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tìm chủ đề khớp nhất với câu hỏi (dùng khi KHÔNG có AI, hoặc khi AI lỗi).
 * Trả về chuỗi trả lời, hoặc null nếu không khớp chủ đề nào.
 */
function faqAnswer(text) {
  const question = normalize(text);
  if (!question) return null;

  let best = null;
  for (const topic of TOPICS) {
    let score = 0;
    for (const keyword of topic.keywords) {
      const k = normalize(keyword);
      if (k && question.includes(k)) score += k.split(' ').length; // từ khoá càng dài càng cụ thể
    }
    if (score > 0 && (!best || score > best.score)) best = { topic, score };
  }

  return best ? best.topic.answer : null;
}

/** Trạng thái link thật/mock hiện tại, để chatbot không trả lời sai sàn nào đã gắn hoa hồng. */
function affiliateStatusText() {
  const affiliate = require('./affiliate').describe();
  if (!affiliate.isReal) {
    return 'Tất cả sàn đang dùng link thử nghiệm nội bộ; hoa hồng do quản trị viên chốt thủ công.';
  }
  if (Array.isArray(affiliate.livePlatforms) && affiliate.livePlatforms.length) {
    return `Các sàn đang dùng link hoàn tiền thật: ${affiliate.livePlatforms.join(', ')}. Các sàn còn lại dùng link thử nghiệm và chưa gắn hoa hồng tự động.`;
  }
  return 'Tất cả các sàn đang dùng link hoàn tiền thật.';
}

/** Toàn bộ kiến thức để đưa vào "system prompt" cho AI. */
function buildSystemPrompt() {
  const contact = supportContact();

  const lines = [
    'Bạn là "Trợ lý GZ AFL" — trợ lý hỗ trợ ảo của website hoàn tiền (affiliate/cashback) GZ AFL, nói tiếng Việt.',
    '',
    'QUY TẮC BẮT BUỘC:',
    '- Trả lời ngắn gọn, thân thiện, xưng "mình" và gọi người dùng là "bạn".',
    '- CHỈ dùng thông tin trong mục KIẾN THỨC bên dưới. Không tự bịa thêm chính sách, con số, thời hạn hay cam kết.',
    '- Không chắc chắn thì nói rõ là chưa có thông tin và mời người dùng liên hệ hỗ trợ, tuyệt đối không đoán bừa.',
    '- Không bao giờ hỏi mật khẩu, mã OTP, số tài khoản ngân hàng hay thông tin cá nhân của người dùng; không hướng dẫn chuyển tiền cho bất kỳ ai.',
    '- Câu hỏi ngoài phạm vi website (chính trị, y tế, pháp luật, lập trình...) thì từ chối nhẹ nhàng và mời quay lại việc hỗ trợ.',
    '- Trả lời đúng trọng tâm và ĐỦ Ý, không cắt câu giữa chừng. Câu đơn giản 2-4 câu; câu cần hướng dẫn thì tối đa khoảng 8 gạch đầu dòng.',
    '- Không viết lời chào dài dòng ở mỗi câu trả lời; vào thẳng nội dung.',
    '',
    contact.line
      ? `LIÊN HỆ HỖ TRỢ: ${contact.line}.`
      : 'LIÊN HỆ HỖ TRỢ: người dùng bấm nút "Liên hệ hỗ trợ" trong khung chat.',
    '',
    'HIỆN TRẠNG LINK HOÀN TIỀN:',
    `- ${affiliateStatusText()}`,
    '- Khi người dùng hỏi sàn nào đang dùng link thật, trả lời đúng theo mục này.',
    '',
    'KIẾN THỨC:'
  ];

  for (const topic of TOPICS) {
    lines.push(`## ${topic.title}`, topic.answer, '');
  }

  return lines.join('\n').trim();
}

module.exports = {
  TOPICS,
  SUGGESTIONS,
  WELCOME,
  supportContact,
  affiliateStatusText,
  faqAnswer,
  fallbackAnswer,
  buildSystemPrompt
};
