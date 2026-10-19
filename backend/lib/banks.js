'use strict';

/**
 * Danh sach ngan hang / vi dien tu nguoi dung co the chon khi rut tien.
 *
 * `value` la ten luu trong database va in tren bien lai. PHAI giu ngan gon va
 * khong dau de khop voi du lieu cu (vi du 'MBBank', 'Vietcombank').
 * `label` la ten hien tren dropdown cho nguoi dung doc.
 *
 * Them ngan hang moi: chi can them 1 dong vao mang ben duoi.
 * Danh sach nay chi de CHO TIEN khi chon: nguoi dung van co the chon
 * "Ngan hang khac" roi tu go ten ngan hang (xem script.js -> BANK_OTHER_VALUE).
 */

const BANK_GROUPS = [
  {
    label: 'Ngân hàng',
    banks: [
      { value: 'Vietcombank', label: 'Vietcombank' },
      { value: 'Vietinbank', label: 'VietinBank' },
      { value: 'BIDV', label: 'BIDV' },
      { value: 'Agribank', label: 'Agribank' },
      { value: 'MBBank', label: 'Ngân hàng Quân Đội (MBBank)' },
      { value: 'Techcombank', label: 'Techcombank' },
      { value: 'ACB', label: 'ACB' },
      { value: 'VPBank', label: 'VPBank' },
      { value: 'Sacombank', label: 'Sacombank' },
      { value: 'TPBank', label: 'TPBank' },
      { value: 'VIB', label: 'VIB' },
      { value: 'SHB', label: 'SHB' },
      { value: 'HDBank', label: 'HDBank' },
      { value: 'Eximbank', label: 'Eximbank' },
      { value: 'MSB', label: 'MSB' },
      { value: 'SeABank', label: 'SeABank' },
      { value: 'OCB', label: 'OCB' },
      { value: 'LPBank', label: 'LPBank' },
      { value: 'NamABank', label: 'Nam A Bank' },
      { value: 'BacABank', label: 'Bắc Á Bank' },
      { value: 'PVcomBank', label: 'PVcomBank' },
      { value: 'Saigonbank', label: 'Saigonbank' },
      { value: 'VietABank', label: 'Viet A Bank' },
      { value: 'VietBank', label: 'VietBank' },
      { value: 'SCB', label: 'SCB' },
      { value: 'Kienlongbank', label: 'KienlongBank' },
      { value: 'NCB', label: 'NCB' },
      { value: 'BaoVietBank', label: 'BaoVietBank' },
      { value: 'PGBank', label: 'PGBank' },
      { value: 'ABBank', label: 'ABBank' },
      { value: 'Oceanbank', label: 'OceanBank' },
      { value: 'GPBank', label: 'GPBank' },
      { value: 'BVBank', label: 'BVBank' },
      { value: 'CBBank', label: 'CBBank' },
      { value: 'IndovinaBank', label: 'Indovina Bank' },
      { value: 'ShinhanBank', label: 'Shinhan Bank' },
      { value: 'WooriBank', label: 'Woori Bank' },
      { value: 'PublicBank', label: 'Public Bank Việt Nam' },
      { value: 'Cake', label: 'Cake by VPBank (ngân hàng số)' },
      { value: 'Timo', label: 'Timo (ngân hàng số)' },
      { value: 'TNEX', label: 'TNEX (ngân hàng số)' },
      { value: 'Vikki', label: 'Vikki by HDBank (ngân hàng số)' },
      { value: 'Liobank', label: 'LioBank by OCB (ngân hàng số)' }
    ]
  },
  {
    label: 'Ví điện tử',
    banks: [
      { value: 'Momo', label: 'Ví điện tử Momo' },
      { value: 'ZaloPay', label: 'Ví ZaloPay' },
      { value: 'ViettelMoney', label: 'Viettel Money' },
      { value: 'VNPTMoney', label: 'VNPT Money' },
      { value: 'ShopeePay', label: 'ShopeePay' },
      { value: 'Moca', label: 'Ví Moca' },
      { value: 'TrueMoney', label: 'TrueMoney' },
      { value: 'Foxpay', label: 'Foxpay' }
    ]
  }
];

// Ten ngan hang toi da bao nhieu ky tu (truong hop nguoi dung tu go "ngan hang khac")
const BANK_NAME_MAX_LENGTH = 60;

// Kiem tra ten ngan hang do nguoi dung gui len co hop le khong.
// Cho phep ten bat ky (ngan hang moi chua co trong danh sach) mien la ngan va sach.
function isValidBankName(value) {
  const name = String(value || '').trim();
  if (!name) return false;
  if (name.length > BANK_NAME_MAX_LENGTH) return false;
  // Khong cho ky tu xuong dong / dieu khien
  return !/[\u0000-\u001f\u007f]/.test(name);
}

module.exports = { BANK_GROUPS, BANK_NAME_MAX_LENGTH, isValidBankName };
