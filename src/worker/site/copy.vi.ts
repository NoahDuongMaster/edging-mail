import type { LandingCopy } from './copy.types';

/**
 * Vietnamese landing page, served at `/`. The text is the final approved copy from Marketing (copy-final.md v6, spec addenda 2,
 * 4.2 to 4.7), word for word. Only `chrome.skipLink` and `chrome.licenseLink` are not from that copy: they are the small words
 * around the page.
 */
export const copyVi: LandingCopy = {
  lang: 'vi',
  path: '/',
  meta: {
    title: 'Edging Mail: email theo tên miền riêng cho công ty',
    description:
      'Email theo tên miền riêng, chạy trên Cloudflare của công ty. Nội dung thư được mã hóa bằng khóa riêng của từng người, có đăng nhập hai lớp. Mã nguồn mở.'
  },
  og: {
    title: 'Edging Mail: email công ty do công ty tự giữ',
    description:
      'Mỗi nhân viên một hộp thư trên tên miền công ty. Tiêu đề, nội dung và tệp đính kèm được mã hóa bằng khóa riêng của từng người trước khi lưu. Mã nguồn mở.'
  },
  chrome: { skipLink: 'Chuyển đến nội dung chính', githubLink: 'GitHub', licenseLink: 'Giấy phép MIT' },
  cta: { signIn: 'Đăng nhập', deploy: 'Triển khai cho công ty', deployNote: '(hướng dẫn bằng tiếng Anh)' },
  hero: {
    h1: 'Email theo tên miền riêng cho cả công ty',
    subline:
      'Edging Mail chạy trên tài khoản Cloudflare của chính công ty. Mỗi nhân viên có hộp thư riêng, nội dung thư được mã hóa bằng khóa của chính họ.',
    mascotAlt: 'Edgar, chú bồ câu đưa thư, linh vật của Edging Mail'
  },
  benefits: {
    h2: 'Công ty tự giữ email của mình',
    cards: [
      {
        title: 'Địa chỉ email thuộc về công ty',
        text: 'Mỗi địa chỉ nằm trên tên miền công ty, còn thư và tệp đính kèm lưu trong tài khoản Cloudflare của công ty. Khi có người nghỉ việc, quản trị viên khóa hoặc xóa tài khoản của người đó.'
      },
      {
        title: 'Không có máy chủ nào phải trông coi',
        text: 'Edging Mail chạy hoàn toàn trên các dịch vụ của Cloudflare. Công ty không phải dựng máy chủ mail, cũng không có container hay hàng đợi nào cần vận hành.'
      },
      {
        title: 'Mã nguồn mở, nói rõ giới hạn',
        text: 'Mã nguồn công khai theo giấy phép MIT, bộ phận IT đọc được trước khi triển khai. Những việc Edging Mail chưa làm được, như kết nối Outlook hay lọc thư rác, có ghi ở phần câu hỏi bên dưới.'
      }
    ]
  },
  features: {
    h2: 'Có gì trong Edging Mail',
    cards: [
      {
        title: 'Đủ các thư mục quen thuộc',
        text: 'Hộp thư đến, Đã gửi, Thư nháp, Đã tạm ẩn, Có gắn dấu sao, Lưu trữ, Thư rác, Thùng rác, cùng nhãn tự đặt. Thư nháp tự lưu trong lúc soạn.'
      },
      {
        title: 'Soạn, trả lời, tìm lại thư',
        text: 'Trả lời, trả lời tất cả, chuyển tiếp, gửi và nhận tệp đính kèm. Tìm thư theo người gửi hoặc người nhận; tiêu đề chỉ được tìm trong các thư đã tải về trình duyệt, còn nội dung thư được mã hóa nên không tìm được.'
      },
      {
        title: 'Thư mới hiện ngay',
        text: 'Danh sách thư tự cập nhật, không cần tải lại trang. Điện thoại và máy tính đều nhận thông báo khi có thư mới.'
      },
      {
        title: 'Dùng như ứng dụng trên điện thoại',
        text: 'Nhân viên cài Edging Mail từ trình duyệt ra màn hình chính (PWA), không phải vào kho ứng dụng. Trên iPhone và iPad, phải cài theo cách này mới nhận được thông báo.'
      },
      {
        title: 'Thư mã hóa bằng khóa của từng người',
        text: 'Mỗi nhân viên có khóa riêng, mở bằng mật khẩu của chính họ. Tiêu đề, nội dung và tệp đính kèm được mã hóa trước khi lưu.'
      },
      {
        title: 'Quản lý tài khoản nhân viên',
        text: 'Tạo, khóa hoặc xóa tài khoản, thêm địa chỉ phụ (alias), đặt lại đăng nhập hai lớp khi nhân viên mất điện thoại. Mọi thay đổi của quản trị viên trên các tài khoản đều được ghi vào nhật ký.'
      }
    ]
  },
  how: {
    h2: 'Bắt đầu thế nào',
    lead: 'Sau khi bộ phận IT triển khai Edging Mail lên tài khoản Cloudflare của công ty theo hướng dẫn trên GitHub:',
    steps: [
      {
        title: 'Bước 1. Thêm tên miền',
        text: 'Quản trị viên thêm một hoặc nhiều tên miền, ví dụ congty.com và congty.vn. Trang quản trị kiểm tra DNS và hướng dẫn cài đặt từng bước.'
      },
      {
        title: 'Bước 2. Tạo hộp thư cho nhân viên',
        text: 'Mỗi người một địa chỉ, ví dụ nhanvien1@congty.com, kèm mật khẩu tạm cho lần đăng nhập đầu, sau đó nhân viên tự đặt mật khẩu mới.'
      },
      {
        title: 'Bước 3. Nhân viên đăng nhập',
        text: 'Nhân viên đăng nhập bằng địa chỉ và mật khẩu được cấp, trên trình duyệt hoặc ứng dụng đã cài trên điện thoại. Lần đầu đăng nhập, mỗi người nhận một khóa khôi phục để tự cất giữ.'
      }
    ]
  },
  security: {
    h2: 'Ai xem được thư nào',
    groups: [
      {
        title: 'Mã hóa thư',
        items: [
          'Khóa của mỗi người được mở bằng mật khẩu ngay trong trình duyệt của họ. Mật khẩu không bao giờ rời khỏi trình duyệt.',
          'Tiêu đề, nội dung và tệp đính kèm được mã hóa trước khi lưu. Máy chủ hay bất kỳ ai lấy được bản sao dữ liệu cũng không đọc được các bản lưu này nếu không có mật khẩu hoặc khóa khôi phục của chủ hộp thư (xem các ngoại lệ bên dưới).',
          'Mật khẩu yếu có thể bị dò ra từ bản sao dữ liệu. Ứng dụng yêu cầu mật khẩu dài ít nhất 12 ký tự (với quản trị viên là 16) và từ chối mật khẩu phổ biến.',
          'Thư đến lúc người nhận chưa đăng nhập lần nào chỉ được bảo vệ bằng khóa của máy chủ, cho tới lần đăng nhập đầu tiên của họ.',
          'Khi mọi người nhận đều là đồng nghiệp đã đăng nhập ít nhất một lần, thư được mã hóa ngay trong trình duyệt người gửi (ứng dụng hiện huy hiệu). Thư có người nhận bên ngoài, hoặc có người nhận là đồng nghiệp chưa đăng nhập lần nào, là email thông thường và chỉ được mã hóa khi lưu.',
          'Phần không được mã hóa: ai gửi cho ai, ngày giờ, dung lượng thư và tệp đính kèm, số tệp đính kèm, thư nào trả lời thư nào, thư đã đọc, có gắn dấu sao hay đang tạm ẩn, thư mục và nhãn.'
        ]
      },
      {
        title: 'Quản trị viên và mật khẩu',
        items: [
          'Không quản trị viên nào đặt lại được mật khẩu của người khác, và trong Edging Mail không có cách nào để quản trị viên mở thư của người đã đăng nhập và thiết lập khóa mã hóa của mình.',
          'Quản trị viên tạo tài khoản biết mật khẩu tạm của tài khoản đó cho tới khi chủ hộp thư đăng nhập lần đầu, và thư đến trước lúc đó chỉ được bảo vệ bằng khóa của máy chủ. Vì vậy chỉ nên tạo tài khoản khi người đó sẵn sàng đăng nhập.',
          'Quên mật khẩu thì mỗi người tự đặt lại bằng khóa khôi phục của mình (kèm mã từ ứng dụng xác thực nếu có bật đăng nhập hai lớp) và vẫn giữ nguyên thư. Khóa này chỉ hiện một lần mỗi khi được tạo, nên hãy cất nó ở nơi an toàn.',
          'Mất cả mật khẩu lẫn khóa khôi phục thì thư cũ không ai mở được nữa. Quản trị viên chỉ có thể xóa tài khoản đó và tạo một hộp thư mới.',
          'Quản trị viên vẫn có thể khóa hoặc xóa tài khoản, tạo lại một địa chỉ, thêm địa chỉ phụ và đặt lại đăng nhập hai lớp của một người, nên thư gửi tới sau đó có thể về tay người khác. Mọi thay đổi đó đều được ghi vào nhật ký, và người đó được báo khi đăng nhập hai lớp của họ bị đặt lại.'
        ]
      },
      {
        title: 'Đăng nhập và đọc thư',
        items: [
          'Đăng nhập hai lớp bằng ứng dụng xác thực (TOTP), mặc định bắt buộc với mọi người.',
          'Nhập sai mật khẩu nhiều lần liền thì đăng nhập bị khóa một lúc. Khi đăng xuất, đổi mật khẩu hoặc đặt lại mật khẩu bằng khóa khôi phục, các phiên đăng nhập cũ hết hiệu lực.',
          'Mỗi người xem được các lần đăng nhập gần đây của mình. Các sự kiện bảo mật được ghi vào nhật ký của quản trị viên.',
          'Thư HTML mở trong khung cách ly (sandbox). Ảnh từ bên ngoài chỉ tải khi người đọc bấm cho phép.'
        ]
      }
    ],
    closing:
      'Mã hóa bảo vệ thư đang lưu, nhưng không chống được việc phần mềm bị sửa có chủ đích. Ai kiểm soát tài khoản Cloudflare của công ty hoặc mã đang chạy thì có thể thay đổi phần mềm, nên chỉ giao quyền này cho người thật sự tin cậy.'
  },
  faq: {
    h2: 'Câu hỏi thường gặp',
    lead: 'Những điều nên biết trước khi triển khai, kể cả những việc Edging Mail chưa làm được.',
    items: [
      {
        question: 'Dùng Outlook, Apple Mail hay ứng dụng Gmail để đọc thư được không?',
        answer:
          'Chưa được. Edging Mail chưa hỗ trợ IMAP, POP hay SMTP, nên các ứng dụng mail đó chưa kết nối vào được. Hiện nhân viên dùng trên trình duyệt hoặc ứng dụng cài từ trình duyệt.'
      },
      {
        question: 'Có lọc thư rác và virus không?',
        answer:
          'Chưa có. Mọi thư đến đều vào Hộp thư đến; Thư rác là thư mục để người dùng tự chuyển thư vào. Hệ thống không quét virus, nên hãy mở tệp đính kèm cẩn thận như với mọi tệp tải về.'
      },
      {
        question: 'Có đăng nhập hai lớp không?',
        answer:
          'Có, bằng ứng dụng xác thực (TOTP), kèm các mã khôi phục chỉ dùng được một lần. Mặc định mọi người đều phải bật; quản trị viên thì luôn phải bật.'
      },
      {
        question: 'Tên miền cần chuẩn bị gì?',
        answer:
          'Tên miền cần dùng DNS của Cloudflare, với bản ghi MX trỏ về Cloudflare, vì thư đến đi qua Cloudflare Email Routing. Nếu tên miền đang nhận thư ở nhà cung cấp khác, chuyển MX sang Cloudflare đồng nghĩa nhà cung cấp cũ không nhận thư cho tên miền đó nữa.'
      },
      {
        question: 'Có tốn phí không?',
        answer:
          'Phần mềm Edging Mail miễn phí. Chi phí nằm ở gói Cloudflare của công ty: Edging Mail cần gói Workers Paid, vì bước kiểm tra mật khẩu khi đăng nhập cần nhiều thời gian xử lý hơn gói miễn phí cho phép, và vì Cloudflare Email Sending (đang ở giai đoạn beta) cần gói này để gửi thư tới người nhận bất kỳ. Nhận thư qua Cloudflare Email Routing thì miễn phí. Giá từng gói xem trên trang của Cloudflare.'
      },
      {
        question: 'Thư có được mã hóa đầu cuối không?',
        answer:
          'Chỉ khi mọi người nhận đều là đồng nghiệp trên cùng Edging Mail và đã đăng nhập ít nhất một lần. Khi đó, thư được mã hóa ngay trong trình duyệt người gửi bằng khóa của người nhận và không đi như email thông thường. Khóa của người nhận do chính máy chủ này cung cấp, mã của ứng dụng cũng do máy chủ đó gửi tới, nên mức bảo vệ này dựa vào việc máy chủ không bị sửa. Lớp mã hóa này giới hạn ai đọc được thư, nhưng không chứng minh ai là người gửi. Thư gửi ra ngoài hoặc từ ngoài vào là email thông thường: thư đi giữa các máy chủ mail dưới dạng email thường, Edging Mail thấy thư lúc thư đến hoặc đi, rồi mới lưu lại ở dạng mã hóa.'
      },
      {
        question: 'Nhân viên quên mật khẩu thì sao?',
        answer:
          'Người đó tự đặt mật khẩu mới bằng khóa khôi phục hiện tại của mình (kèm mã từ ứng dụng xác thực nếu có bật đăng nhập hai lớp) và giữ nguyên toàn bộ thư; sau đó họ nhận một khóa khôi phục mới. Quản trị viên không đặt lại được mật khẩu của ai. Nếu mất cả mật khẩu lẫn khóa khôi phục, thư cũ không ai mở được nữa; quản trị viên chỉ có thể xóa tài khoản và tạo hộp thư mới.'
      }
    ]
  },
  closing: {
    h2: 'Bắt đầu với tên miền của công ty',
    text: 'Hướng dẫn triển khai và toàn bộ mã nguồn nằm trên GitHub. Ai đã có tài khoản thì đăng nhập tại đây.'
  },
  footer: { text: 'Edging Mail là phần mềm mã nguồn mở theo giấy phép MIT. Linh vật Edgar là chú bồ câu đưa thư.' }
};
