/* ============================================================
   GZ AFL — song ngữ Việt / Anh cho trang chủ và khung đăng nhập
   - Lưu lựa chọn vào localStorage
   - Dịch các phần tử có data-i18n / data-i18n-html /
     data-i18n-placeholder / data-i18n-aria-label / data-i18n-title
   ============================================================ */
(function () {
  'use strict';

  const STORAGE_KEY = 'gzafl_lang';
  const SUPPORTED = ['vi', 'en'];
  const FLAGS = { vi: 'assets/flags/vn.svg', en: 'assets/flags/gb.svg' };
  const SHORT_LABELS = { vi: 'VI', en: 'EN' };
  const HTML_LANG = { vi: 'vi', en: 'en' };

  const DICT = {
    vi: {
      'meta.title': 'GZ AFL - Nền tảng Affiliate',
      'meta.description': 'GZ AFL - tạo link hoàn tiền Shopee, TikTok Shop, Tiki và Lazada, theo dõi đơn hàng và nhận hoa hồng minh bạch.',

      'lang.switch': 'Chọn ngôn ngữ',
      'common.close': 'Đóng',
      'theme.toggle': 'Chuyển chế độ sáng/tối',
      'theme.toLight': 'Chuyển sang chế độ sáng',
      'theme.toDark': 'Chuyển sang chế độ tối',

      'nav.home': 'Trang chủ',
      'nav.lookup': 'Tra cứu đơn hàng',
      'nav.wallet': 'Ví của bạn',
      'nav.guide': 'Hướng dẫn',
      'nav.hello': 'Xin chào!',
      'nav.login': 'Đăng nhập',

      'hero.badge': 'Nền tảng Affiliate uy tín tại Việt Nam',
      'hero.title.line1': 'Chuyển đổi link mua sắm',
      'hero.title.line2': 'Nhận hoa hồng',
      'hero.subtitle': 'Link hoàn tiền cho Shopee, Tiki, Lazada, TikTok Shop — công khai, <br class="hidden md:block">minh bạch',
      'hero.paste': 'Dán',
      'hero.input.placeholder': 'Dán link sản phẩm...',
      'hero.convert': 'Chuyển đổi link',
      'hero.note': 'Mỗi lần chuyển đổi 1 link. Đăng nhập để hệ thống lưu đơn và đối soát hoa hồng cho bạn.',
      'hero.status.mock': 'Các sàn đang ở chế độ thử nghiệm: link chỉ mở sản phẩm, chưa gắn hoa hồng tự động.',
      'hero.status.liveAll': 'Tất cả các sàn đang dùng link hoàn tiền thật.',
      'hero.status.live': 'Đang gắn hoa hồng tự động: {list}.',
      'hero.status.experimental': 'Đang thử nghiệm: {list}.',
      'hero.status.liveSome': 'Đang bật link hoàn tiền thật cho một số sàn.',

      'auth.login.title': 'Đăng nhập',
      'auth.login.subtitle.default': 'Vui lòng đăng nhập để theo dõi và nhận hoa hồng.',
      'auth.login.subtitle.otp': 'Nhập tài khoản và mật khẩu. Sau đó bạn cần nhập thêm mã xác thực gửi tới email.',
      'auth.register.title': 'Đăng ký tài khoản',
      'auth.register.subtitle.otp': 'Tạo tài khoản mới. Mã xác thực sẽ được gửi tới email bạn nhập.',
      'auth.register.subtitle.noOtp': 'Tạo tài khoản mới bằng Email hoặc Số điện thoại.',
      'auth.name.label': 'Tên hiển thị',
      'auth.name.placeholder': 'Nguyễn Văn A',
      'auth.username.label': 'Email hoặc Số điện thoại',
      'auth.username.placeholder': 'Ví dụ: email@gmail.com hoặc 0987...',
      'auth.username.hint': 'Dùng để đăng nhập.',
      'auth.email.label.otp': 'Email nhận mã xác thực',
      'auth.email.label.contact': 'Email liên hệ',
      'auth.email.hint.otp': 'Mã xác thực {n} số sẽ được gửi tới email này.',
      'auth.email.hint.contact': 'Dùng để khôi phục mật khẩu sau này.',
      'auth.password.label': 'Mật khẩu',
      'auth.password.placeholder': '••••••••',
      'auth.confirm.label': 'Xác nhận mật khẩu',
      'auth.submit.login': 'Đăng nhập',
      'auth.submit.register': 'Tạo tài khoản',
      'auth.toggle.noAccount': 'Chưa có tài khoản?',
      'auth.toggle.register': 'Đăng ký ngay',
      'auth.toggle.hasAccount': 'Đã có tài khoản?',
      'auth.toggle.login': 'Đăng nhập ngay',
      'auth.forgot.link': 'Quên mật khẩu?',
      'auth.otp.lead': 'Mã xác thực đã được gửi tới ',
      'auth.otp.tail.register': '. Nhập mã để hoàn tất đăng ký.',
      'auth.otp.tail.login': '. Nhập mã để hoàn tất đăng nhập.',
      'auth.otp.dev': 'Chưa cấu hình gửi thư — mã thử nghiệm:',
      'auth.otp.label': 'Mã xác thực',
      'auth.otp.submit.register': 'Xác nhận & tạo tài khoản',
      'auth.otp.submit.login': 'Xác nhận đăng nhập',
      'auth.otp.resend': 'Gửi lại mã',
      'auth.otp.resendCountdown': 'Gửi lại mã ({s}s)',
      'auth.back': 'Quay lại',
      'auth.otp.title.register': 'Xác thực email',
      'auth.otp.title.login': 'Xác thực đăng nhập',
      'auth.otp.subtitle.login.default': 'Nhập mã xác thực để hoàn tất đăng nhập.',
      'auth.otp.subtitle.register': 'Nhập mã xác thực để hoàn tất đăng ký.',

      'auth.forgot.title': 'Quên mật khẩu',
      'auth.forgot.subtitle.default': 'Nhập tài khoản cần khôi phục. Mã xác thực sẽ được gửi tới email bạn đã đăng ký.',
      'auth.forgot.subtitle.sent': 'Mã xác thực sẽ được gửi tới email bạn đã đăng ký.',
      'auth.forgot.subtitle.noEmail': 'Hệ thống chưa gửi được email. Gửi yêu cầu để quản trị viên cấp lại mật khẩu.',
      'auth.forgot.submit': 'Gửi mã xác thực',
      'auth.forgot.adminHelp': 'Không nhận được mã (tài khoản chưa có email, hoặc email sai)? Gửi yêu cầu để quản trị viên cấp lại mật khẩu cho bạn.',
      'auth.forgot.note.label': 'Cách liên hệ lại',
      'auth.forgot.note.placeholder': 'Ví dụ: Zalo 0987 654 321',
      'auth.forgot.adminSubmit': 'Nhờ quản trị viên hỗ trợ',
      'auth.forgot.toggle': 'Không nhận được mã?',
      'auth.forgot.toggleHide': 'Ẩn phần nhờ quản trị viên',
      'auth.forgot.back': 'Quay lại đăng nhập',

      'auth.reset.title': 'Đặt lại mật khẩu',
      'auth.reset.subtitle': 'Nếu tài khoản tồn tại và đã có email, mã xác thực đã được gửi tới email đó. Nhập mã kèm mật khẩu mới để hoàn tất.',
      'auth.reset.subtitle2': 'Nhập mã xác thực đã gửi tới email kèm mật khẩu mới.',
      'auth.reset.dev': 'Chưa cấu hình gửi thư — mã thử nghiệm:',
      'auth.reset.otpLabel': 'Mã xác thực',
      'auth.reset.passwordLabel': 'Mật khẩu mới',
      'auth.reset.passwordPlaceholder': 'Ít nhất 8 ký tự',
      'auth.reset.confirmLabel': 'Xác nhận mật khẩu mới',
      'auth.reset.submit': 'Đặt lại mật khẩu',
      'auth.reset.resend': 'Gửi lại mã',
      'auth.reset.back': 'Quay lại',

      'auth.error.infoExpired': 'Thông tin đăng ký đã hết. Vui lòng nhập lại từ đầu.',
      'auth.error.otpLength': 'Vui lòng nhập mã xác thực gồm {n} chữ số.',
      'auth.success.registered': 'Tạo tài khoản thành công! Vui lòng đăng nhập lại.',
      'auth.success.resend': 'Đã gửi lại mã xác thực. Vui lòng kiểm tra email (kể cả thư rác).',
      'auth.error.loginExpired': 'Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.',
      'auth.error.usernameRequired': 'Vui lòng nhập Email hoặc Số điện thoại.',
      'auth.error.usernameInvalid': 'Định dạng không hợp lệ. Vui lòng nhập đúng Email hoặc Số điện thoại.',
      'auth.error.otpSend': 'Không gửi được mã xác thực. Vui lòng thử lại.',
      'auth.info.resetSent': 'Nếu tài khoản tồn tại, mã xác thực đã được gửi tới email đã đăng ký.',
      'auth.error.reset': 'Không đặt lại được mật khẩu. Vui lòng thử lại.',
      'auth.success.reset': 'Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới.',
      'auth.error.contactRequired': 'Vui lòng nhập Zalo hoặc Số điện thoại để quản trị viên liên hệ lại.',
      'auth.success.requestSent': 'Đã gửi yêu cầu khôi phục mật khẩu.',
      'auth.error.request': 'Không gửi được yêu cầu. Vui lòng thử lại.',
      'auth.error.fillAll': 'Vui lòng điền đầy đủ thông tin.',
      'auth.error.nameRequired': 'Vui lòng nhập tên hiển thị.',
      'auth.error.passwordShort': 'Mật khẩu phải có ít nhất 8 ký tự.',
      'auth.error.passwordMismatch': 'Mật khẩu xác nhận không khớp.',
      'auth.error.emailRequired': 'Vui lòng nhập địa chỉ email hợp lệ để nhận mã xác thực.',
      'auth.error.newPasswordShort': 'Mật khẩu mới phải có ít nhất 8 ký tự.',
      'auth.busy.verifying': 'Đang xác thực...',
      'auth.busy.processing': 'Đang xử lý...',
      'auth.busy.sending': 'Đang gửi...',

      'landing.error.empty': 'Vui lòng dán link sản phẩm trước khi chuyển đổi.',
      'landing.error.invalid': 'Link không hợp lệ. Vui lòng dán link Shopee, TikTok, Tiki hoặc Lazada.',
      'landing.info.loginToConvert': 'Đăng nhập để tạo link hoàn tiền cho sản phẩm này.',
      'landing.info.linkFilled': 'Đã điền sẵn link của bạn. Bấm "Tạo link" để tiếp tục.',

      'guide.modalTitle': 'Hướng dẫn & Điều khoản',
      'guide.loading': 'Đang tải...',
      'guide.loadError': 'Không tải được nội dung hướng dẫn.',
      'guide.title': 'Trợ giúp & Điều khoản',
      'guide.subtitle': 'Hướng dẫn sử dụng, các lưu ý để không mất hoa hồng và thông tin liên hệ hỗ trợ.',
      'guide.section1.title': 'Cách nhận hoàn tiền',
      'guide.step1.title': 'Sao chép link sản phẩm',
      'guide.step1.desc': 'Mở Shopee, TikTok Shop, Tiki hoặc Lazada, tìm sản phẩm muốn mua rồi sao chép đường dẫn của sản phẩm đó.',
      'guide.step2.title': 'Tạo link hoàn tiền',
      'guide.step2.desc': 'Vào mục <span class="font-semibold text-slate-700">Tạo đơn hàng</span>, dán link vừa sao chép và bấm <span class="font-semibold text-slate-700">Tạo link &amp; kiểm tra hoa hồng</span>. Hệ thống sẽ trả về link hoàn tiền riêng của bạn; với sàn đang thử nghiệm, đó là link đơn hàng chưa gắn hoa hồng tự động.',
      'guide.step3.title': 'Mua hàng qua link đó',
      'guide.step3.desc': 'Bấm <span class="font-semibold text-slate-700">Mua ngay</span> (hoặc <span class="font-semibold text-slate-700">Mở sản phẩm</span> với sàn đang thử nghiệm) rồi đặt hàng bình thường. Sau khi đơn được ghi nhận và đối soát, hoa hồng sẽ được cộng vào ví của bạn để rút về ngân hàng.',
      'guide.section2.title': 'Lưu ý để không mất hoa hồng',
      'guide.tip1': 'Xoá các sản phẩm cùng loại đã có trong giỏ hàng trước khi mua qua link hoàn tiền.',
      'guide.tip2': 'Tránh bấm sang link khác (live, video, quảng cáo) trong cùng phiên mua hàng.',
      'guide.tip3': 'Hoàn tất đơn trong cùng một trình duyệt và hạn chế đóng tab giữa chừng.',
      'guide.tip4': 'Đơn có được ghi nhận hay không do sàn thương mại điện tử quyết định. Nền tảng không thể can thiệp vào kết quả đối soát.',
      'guide.section3.title': 'Điều khoản sử dụng',
      'guide.terms1': 'Người dùng phải cung cấp thông tin đăng ký và thông tin nhận tiền chính xác. Nền tảng không chịu trách nhiệm nếu tiền bị chuyển sai do thông tin người dùng cung cấp sai.',
      'guide.terms2': 'Khi rút tiền, bạn chỉ cần chọn <b>1 trong 2</b> cách nhận tiền. Cách 1: chọn ngân hàng/ví điện tử trong danh sách có sẵn (hoặc chọn <b>"Ngân hàng khác"</b> rồi tự ghi tên ngân hàng) và nhập số tài khoản cùng tên chủ tài khoản. Cách 2: tải lên <b>ảnh QR nhận tiền</b> (chỉ nhận ảnh <b>PNG</b> hoặc <b>JPG</b>, tối đa 2MB) — ảnh QR đã có sẵn số tài khoản nên bạn không cần nhập gì thêm, quản trị viên sẽ quét mã này để chuyển tiền cho bạn.',
      'guide.terms3': 'Mọi hành vi gian lận (tạo đơn khống, tự mua qua link của chính mình để trục lợi, dùng nhiều tài khoản) sẽ bị khoá tài khoản và huỷ toàn bộ số dư.',
      'guide.terms4': 'Hoa hồng chỉ được ghi nhận sau khi sàn thương mại điện tử đối soát thành công và có thể bị điều chỉnh nếu đơn bị huỷ, hoàn trả hoặc không hợp lệ.',
      'guide.terms5': 'Thời gian xử lý yêu cầu rút tiền thông thường từ 1 đến 3 ngày làm việc. Số tiền rút tối thiểu là 1.000đ và mỗi tài khoản chỉ được có một yêu cầu rút đang chờ xử lý.',
      'guide.terms6': 'Nền tảng có quyền tạm ngừng hoạt động để bảo trì và sẽ thông báo trước khi có thể.',
      'guide.section4.title': 'Chính sách bảo mật',
      'guide.privacy1': 'Mật khẩu được mã hoá một chiều (bcrypt) trước khi lưu. Nền tảng không đọc được mật khẩu của bạn.',
      'guide.privacy2': 'Thông tin ngân hàng chỉ dùng để chi trả hoa hồng, không chia sẻ cho bên thứ ba ngoài đơn vị thanh toán.',
      'guide.privacy3': 'Phiên đăng nhập được lưu trong cookie chỉ dành cho máy chủ (<span class="font-mono text-xs">httpOnly</span>). Khi bạn đổi mật khẩu, mọi phiên đăng nhập ở thiết bị khác sẽ bị đăng xuất.',
      'guide.privacy4': 'Khi đăng ký, hệ thống gửi một mã xác thực 6 chữ số tới email bạn nhập để xác nhận email là thật. Vì vậy email là thông tin bắt buộc, kể cả khi bạn đăng nhập bằng số điện thoại.',
      'guide.privacy5': 'Khi đăng nhập, sau khi nhập đúng mật khẩu bạn có thể được yêu cầu nhập thêm <b>mã xác thực 6 chữ số</b> gửi tới email — lớp bảo vệ thứ hai nếu chẳng may mật khẩu bị lộ. Mã có hiệu lực 10 phút; nếu bạn vừa đăng xuất rồi đăng nhập lại, mã cũ vẫn dùng được nên không phải chờ thư mới.',
      'guide.privacy6': 'Muốn đổi email trong trang Cá nhân, bạn cũng phải nhập mã xác thực gửi tới <b>địa chỉ mới</b>. Nhờ vậy email nhận mã khôi phục mật khẩu luôn là địa chỉ thật của bạn.',
      'guide.privacy7': 'Quên mật khẩu: bấm "Quên mật khẩu?" ở màn hình đăng nhập, hệ thống gửi mã xác thực tới email đã đăng ký để bạn tự đặt lại mật khẩu. Nếu tài khoản chưa có email hoặc không nhận được thư, hãy dùng phần "nhờ quản trị viên hỗ trợ" ngay bên dưới.',
      'guide.privacy8': 'Link hoàn tiền của bạn có gắn mã định danh người dùng (sub_id) để hệ thống biết hoa hồng thuộc về ai.',
      'guide.section5.title': 'Liên hệ & hỗ trợ',
      'guide.supportHours': 'Thời gian hỗ trợ: 8:00 – 22:00 hằng ngày. Vui lòng gửi kèm mã đơn hàng để được xử lý nhanh hơn.'
    },

    en: {
      'meta.title': 'GZ AFL - Affiliate Platform',
      'meta.description': 'GZ AFL - create cashback links for Shopee, TikTok Shop, Tiki and Lazada, track orders and receive transparent cashback.',

      'lang.switch': 'Choose language',
      'common.close': 'Close',
      'theme.toggle': 'Toggle light/dark mode',
      'theme.toLight': 'Switch to light mode',
      'theme.toDark': 'Switch to dark mode',

      'nav.home': 'Home',
      'nav.lookup': 'Order lookup',
      'nav.wallet': 'Your wallet',
      'nav.guide': 'Guide',
      'nav.hello': 'Hello!',
      'nav.login': 'Sign in',

      'hero.badge': 'A trusted affiliate platform in Vietnam',
      'hero.title.line1': 'Convert shopping links',
      'hero.title.line2': 'Earn cashback',
      'hero.subtitle': 'Cashback links for Shopee, Tiki, Lazada and TikTok Shop — open, <br class="hidden md:block">transparent',
      'hero.paste': 'Paste',
      'hero.input.placeholder': 'Paste a product link...',
      'hero.convert': 'Convert link',
      'hero.note': 'One link per conversion. Sign in so we can save your order and track your cashback.',
      'hero.status.mock': 'Stores are in test mode: links only open products without automatic cashback.',
      'hero.status.liveAll': 'All stores are using real cashback links.',
      'hero.status.live': 'Automatic cashback enabled: {list}.',
      'hero.status.experimental': 'In test mode: {list}.',
      'hero.status.liveSome': 'Real cashback links are enabled for some stores.',

      'auth.login.title': 'Sign in',
      'auth.login.subtitle.default': 'Sign in to track orders and receive cashback.',
      'auth.login.subtitle.otp': 'Enter your account and password. Then enter the verification code sent to your email.',
      'auth.register.title': 'Create an account',
      'auth.register.subtitle.otp': 'Create a new account. A verification code will be sent to the email you enter.',
      'auth.register.subtitle.noOtp': 'Create a new account with your email or phone number.',
      'auth.name.label': 'Display name',
      'auth.name.placeholder': 'John Doe',
      'auth.username.label': 'Email or phone number',
      'auth.username.placeholder': 'e.g. email@gmail.com or 0987...',
      'auth.username.hint': 'Used to sign in.',
      'auth.email.label.otp': 'Email for verification code',
      'auth.email.label.contact': 'Contact email',
      'auth.email.hint.otp': 'A {n}-digit verification code will be sent to this email.',
      'auth.email.hint.contact': 'Used to recover your password later.',
      'auth.password.label': 'Password',
      'auth.password.placeholder': '••••••••',
      'auth.confirm.label': 'Confirm password',
      'auth.submit.login': 'Sign in',
      'auth.submit.register': 'Create account',
      'auth.toggle.noAccount': "Don't have an account?",
      'auth.toggle.register': 'Sign up now',
      'auth.toggle.hasAccount': 'Already have an account?',
      'auth.toggle.login': 'Sign in now',
      'auth.forgot.link': 'Forgot password?',
      'auth.otp.lead': 'A verification code was sent to ',
      'auth.otp.tail.register': '. Enter the code to finish signing up.',
      'auth.otp.tail.login': '. Enter the code to finish signing in.',
      'auth.otp.dev': 'Email delivery is not configured — test code:',
      'auth.otp.label': 'Verification code',
      'auth.otp.submit.register': 'Confirm & create account',
      'auth.otp.submit.login': 'Confirm sign in',
      'auth.otp.resend': 'Resend code',
      'auth.otp.resendCountdown': 'Resend code ({s}s)',
      'auth.back': 'Back',
      'auth.otp.title.register': 'Verify email',
      'auth.otp.title.login': 'Verify sign in',
      'auth.otp.subtitle.login.default': 'Enter the verification code to finish signing in.',
      'auth.otp.subtitle.register': 'Enter the verification code to finish signing up.',

      'auth.forgot.title': 'Forgot password',
      'auth.forgot.subtitle.default': 'Enter the account to recover. A verification code will be sent to your registered email.',
      'auth.forgot.subtitle.sent': 'A verification code will be sent to your registered email.',
      'auth.forgot.subtitle.noEmail': 'Email delivery is unavailable. Send a request so an admin can reset your password.',
      'auth.forgot.submit': 'Send verification code',
      'auth.forgot.adminHelp': "Didn't receive a code (no email on file or wrong email)? Send a request so an admin can reset your password.",
      'auth.forgot.note.label': 'How to reach you',
      'auth.forgot.note.placeholder': 'e.g. Zalo 0987 654 321',
      'auth.forgot.adminSubmit': 'Ask an admin for help',
      'auth.forgot.toggle': "Didn't receive a code?",
      'auth.forgot.toggleHide': 'Hide admin help',
      'auth.forgot.back': 'Back to sign in',

      'auth.reset.title': 'Reset password',
      'auth.reset.subtitle': 'If the account exists and has an email, a verification code was sent. Enter the code and a new password to finish.',
      'auth.reset.subtitle2': 'Enter the code sent to your email and a new password.',
      'auth.reset.dev': 'Email delivery is not configured — test code:',
      'auth.reset.otpLabel': 'Verification code',
      'auth.reset.passwordLabel': 'New password',
      'auth.reset.passwordPlaceholder': 'At least 8 characters',
      'auth.reset.confirmLabel': 'Confirm new password',
      'auth.reset.submit': 'Reset password',
      'auth.reset.resend': 'Resend code',
      'auth.reset.back': 'Back',

      'auth.error.infoExpired': 'Registration information expired. Please start again.',
      'auth.error.otpLength': 'Enter the {n}-digit verification code.',
      'auth.success.registered': 'Account created! Please sign in again.',
      'auth.success.resend': 'Verification code resent. Check your email (including spam).',
      'auth.error.loginExpired': 'Your sign-in session expired. Please sign in again.',
      'auth.error.usernameRequired': 'Enter your email or phone number.',
      'auth.error.usernameInvalid': 'Invalid format. Enter a valid email or phone number.',
      'auth.error.otpSend': 'Could not send the verification code. Please try again.',
      'auth.info.resetSent': 'If the account exists, a verification code was sent to the registered email.',
      'auth.error.reset': 'Could not reset the password. Please try again.',
      'auth.success.reset': 'Password reset. Sign in with your new password.',
      'auth.error.contactRequired': 'Enter a Zalo or phone number so an admin can contact you.',
      'auth.success.requestSent': 'Password recovery request sent.',
      'auth.error.request': 'Could not send the request. Please try again.',
      'auth.error.fillAll': 'Please fill in all required fields.',
      'auth.error.nameRequired': 'Enter your display name.',
      'auth.error.passwordShort': 'Password must be at least 8 characters.',
      'auth.error.passwordMismatch': 'Passwords do not match.',
      'auth.error.emailRequired': 'Enter a valid email address to receive the verification code.',
      'auth.error.newPasswordShort': 'New password must be at least 8 characters.',
      'auth.busy.verifying': 'Verifying...',
      'auth.busy.processing': 'Processing...',
      'auth.busy.sending': 'Sending...',

      'landing.error.empty': 'Paste a product link before converting.',
      'landing.error.invalid': 'Invalid link. Paste a Shopee, TikTok, Tiki or Lazada link.',
      'landing.info.loginToConvert': 'Sign in to create a cashback link for this product.',
      'landing.info.linkFilled': 'Your link is ready. Click "Create link" to continue.',

      'guide.modalTitle': 'Guide & Terms',
      'guide.loading': 'Loading...',
      'guide.loadError': 'Could not load the guide.',
      'guide.title': 'Help & Terms',
      'guide.subtitle': 'How to use the platform, tips to avoid losing cashback, and support contacts.',
      'guide.section1.title': 'How to receive cashback',
      'guide.step1.title': 'Copy the product link',
      'guide.step1.desc': 'Open Shopee, TikTok Shop, Tiki or Lazada, find the product you want, and copy its link.',
      'guide.step2.title': 'Create a cashback link',
      'guide.step2.desc': 'Go to <span class="font-semibold text-slate-700">Create order</span>, paste the copied link and click <span class="font-semibold text-slate-700">Create link &amp; check commission</span>. The system returns your personal cashback link; for stores in test mode, it is an order link without automatic cashback.',
      'guide.step3.title': 'Buy through that link',
      'guide.step3.desc': 'Click <span class="font-semibold text-slate-700">Buy now</span> (or <span class="font-semibold text-slate-700">Open product</span> for stores in test mode) and place your order as usual. After the order is recorded and reconciled, cashback is added to your wallet so you can withdraw it to your bank.',
      'guide.section2.title': 'Tips to avoid losing cashback',
      'guide.tip1': 'Remove similar items already in your cart before buying through the cashback link.',
      'guide.tip2': 'Avoid clicking other links (live, video, ads) during the same shopping session.',
      'guide.tip3': 'Complete the order in the same browser and avoid closing the tab mid-way.',
      'guide.tip4': 'Whether an order is recorded is decided by the marketplace. The platform cannot intervene in reconciliation results.',
      'guide.section3.title': 'Terms of use',
      'guide.terms1': 'Users must provide accurate registration and payout information. The platform is not responsible for transfers sent to the wrong account due to incorrect information provided by the user.',
      'guide.terms2': 'When withdrawing, you only need to choose <b>1 of 2</b> payout methods. Method 1: select a bank/e-wallet from the list (or choose <b>"Other bank"</b> and enter the bank name) and enter the account number and account holder name. Method 2: upload a <b>payment QR image</b> (only <b>PNG</b> or <b>JPG</b>, max 2MB) — the QR already contains the account number, so you do not need to enter anything else; an admin will scan it to transfer money to you.',
      'guide.terms3': 'Any fraud (fake orders, self-purchasing through your own links for profit, using multiple accounts) will result in account suspension and cancellation of the entire balance.',
      'guide.terms4': 'Cashback is only recorded after the marketplace successfully reconciles it and may be adjusted if the order is cancelled, returned, or invalid.',
      'guide.terms5': 'Withdrawal requests are usually processed within 1 to 3 business days. The minimum withdrawal is 1,000 VND and each account may have only one pending withdrawal request.',
      'guide.terms6': 'The platform may temporarily suspend service for maintenance and will give notice in advance when possible.',
      'guide.section4.title': 'Privacy policy',
      'guide.privacy1': 'Passwords are hashed one-way (bcrypt) before storage. The platform cannot read your password.',
      'guide.privacy2': 'Bank information is used only to pay cashback and is not shared with third parties other than the payment provider.',
      'guide.privacy3': 'Sessions are stored in a server-only cookie (<span class="font-mono text-xs">httpOnly</span>). When you change your password, all sessions on other devices are signed out.',
      'guide.privacy4': 'When you register, the system sends a 6-digit verification code to the email you enter to confirm it is real. Email is therefore required, even if you sign in with a phone number.',
      'guide.privacy5': 'When signing in, after entering the correct password you may be asked for a <b>6-digit verification code</b> sent to your email — a second layer of protection if your password is ever exposed. The code is valid for 10 minutes; if you just signed out and sign back in, the old code still works so you do not have to wait for a new email.',
      'guide.privacy6': 'To change your email on the Profile page, you must also enter a verification code sent to the <b>new address</b>. This ensures the email used for password recovery is always your real address.',
      'guide.privacy7': 'Forgot password: click "Forgot password?" on the sign-in screen and the system sends a verification code to your registered email so you can reset it yourself. If the account has no email or you do not receive the email, use the "ask an admin for help" section right below.',
      'guide.privacy8': 'Your cashback link includes a user identifier (sub_id) so the system knows who the cashback belongs to.',
      'guide.section5.title': 'Contact & support',
      'guide.supportHours': 'Support hours: 8:00–22:00 daily. Please include your order code for faster handling.'
    }
  };

  function normalizeLang(lang) {
    return SUPPORTED.indexOf(lang) !== -1 ? lang : 'vi';
  }

  function getLanguage() {
    try {
      return normalizeLang(window.localStorage.getItem(STORAGE_KEY));
    } catch (err) {
      return 'vi';
    }
  }

  let currentLang = getLanguage();

  function t(key, vars) {
    const table = DICT[currentLang] || DICT.vi;
    let value = table[key];
    if (value === undefined) value = DICT.vi[key];
    if (value === undefined) return key;
    if (vars && typeof vars === 'object') {
      Object.keys(vars).forEach(function (name) {
        value = value.split('{' + name + '}').join(String(vars[name]));
      });
    }
    return value;
  }

  function applyTranslations(root) {
    const scope = root || document;
    if (!scope || !scope.querySelectorAll) return;

    scope.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    scope.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    scope.querySelectorAll('[data-i18n-aria-label]').forEach(function (el) {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });

    // Chỉ đổi title/meta/ngôn ngữ thẻ html khi đang ở trang chủ. Các trang app
    // hiện vẫn là tiếng Việt nên không gắn lang="en" sai cho chúng.
    const landing = document.getElementById('landing-root');
    const landingActive = !!landing && !landing.classList.contains('hidden');

    const description = document.querySelector('meta[name="description"]');
    if (description) {
      description.setAttribute('content', landingActive ? t('meta.description') : DICT.vi['meta.description']);
    }
    document.title = landingActive ? t('meta.title') : DICT.vi['meta.title'];
    document.documentElement.lang = landingActive ? (HTML_LANG[currentLang] || 'vi') : 'vi';

    updateLangSwitcher();
  }

  function isLangMenuOpen() {
    const menu = document.getElementById('lang-menu');
    return !!menu && !menu.classList.contains('hidden');
  }

  function updateLangSwitcher() {
    const flag = document.getElementById('lang-flag');
    const label = document.getElementById('lang-label');
    const toggle = document.getElementById('lang-toggle');

    if (flag) {
      flag.src = FLAGS[currentLang];
      flag.alt = currentLang === 'vi' ? 'Tiếng Việt' : 'English';
    }
    if (label) label.textContent = SHORT_LABELS[currentLang];
    if (toggle) {
      toggle.setAttribute('aria-label', t('lang.switch'));
      toggle.setAttribute('aria-expanded', isLangMenuOpen() ? 'true' : 'false');
    }

    document.querySelectorAll('[data-lang-option]').forEach(function (el) {
      const active = el.getAttribute('data-lang') === currentLang;
      el.setAttribute('aria-selected', active ? 'true' : 'false');
      el.classList.toggle('bg-slate-50', active);
      const check = el.querySelector('.lang-check');
      if (check) check.classList.toggle('hidden', !active);
    });
  }

  function toggleLangMenu(force) {
    const menu = document.getElementById('lang-menu');
    const toggle = document.getElementById('lang-toggle');
    if (!menu) return;
    const open = typeof force === 'boolean' ? force : menu.classList.contains('hidden');
    menu.classList.toggle('hidden', !open);
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && typeof window.lucide !== 'undefined') window.lucide.createIcons();
  }

  function closeLangMenu() {
    toggleLangMenu(false);
  }

  function setLanguage(lang, options) {
    const next = normalizeLang(lang);
    currentLang = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch (err) {
      /* trình duyệt chặn localStorage: vẫn đổi ngôn ngữ trong phiên hiện tại */
    }

    applyTranslations(document);
    closeLangMenu();

    if (!options || options.notify !== false) {
      window.dispatchEvent(new CustomEvent('languagechange', { detail: { lang: next } }));
    }
  }

  function initLanguage() {
    applyTranslations(document);
    updateLangSwitcher();
  }

  window.GZ_I18N = {
    t: t,
    applyTranslations: applyTranslations,
    setLanguage: setLanguage,
    getLanguage: function () { return currentLang; },
    updateLangSwitcher: updateLangSwitcher,
    toggleLangMenu: toggleLangMenu,
    closeLangMenu: closeLangMenu
  };
  window.t = t;

  document.addEventListener('click', function (event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('#lang-switcher')) closeLangMenu();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeLangMenu();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLanguage);
  } else {
    initLanguage();
  }
})();
