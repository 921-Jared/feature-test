// toy-library:社区图书借阅系统(玩具被测系统,Node 标准库零依赖)
// 启动: node server.js   (默认端口 9399,可用 TOY_PORT 覆盖)
// 进程内种子+内存态,重启即重置。
'use strict';
const http = require('http');
const URL = require('url');

const PORT = Number(process.env.TOY_PORT || 9399);

// ---------- 种子数据 ----------
const SHELVES = ['A', 'B', 'C'];
const books = [];
for (let i = 1; i <= 47; i++) {
  books.push({
    bookId: i,
    title: i === 6 ? '三体,地球往事三部曲之一' : '藏书编号' + String(i).padStart(2, '0'),
    author: '作者' + ((i % 9) + 1),
    shelf: i <= 20 ? 'A' : i <= 40 ? 'B' : 'C',
    stock: 1,
    priceFen: 1500 + i * 37,
    createdTime: '2026-01-' + String((i % 28) + 1).padStart(2, '0') + ' 09:15:00',
  });
}
// 6 本不在架(已被社区读者借走,系统外状态)
for (const id of [5, 12, 23, 31, 44, 47]) {
  const b = books.find((x) => x.bookId === id);
  b.stock = 0;
}
const READERS = [{ readerId: 1001, secret: 'pass123', nickname: '测试读者' }];
const tokens = new Set();

// ---------- 借阅单(内存态) ----------
let borrowSeq = 0;
const borrows = []; // {borrowNo,bookId,readerId,status,dueDate,renewCount,fine}
const STATUS = { WAIT_PICKUP: 10, LENT: 20, RETURNED: 30, CANCELED: 40 };

function newBorrow(bookId, status, dueDateDays) {
  borrowSeq += 1;
  const no = 'BR' + String(borrowSeq).padStart(3, '0');
  const due = new Date(Date.now() + dueDateDays * 86400000);
  borrows.push({
    borrowNo: no,
    bookId,
    readerId: 1001,
    status,
    dueDate: fmt(due),
    renewCount: 0,
    fine: null,
  });
  return no;
}
function fmt(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

// ---------- 工具 ----------
function ok(res, data, msg) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ code: 200, msg: msg || '操作成功', data: data === undefined ? null : data }));
}
function fail(res, code, msg) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ code, msg, data: null }));
}
function readBody(req, cb) {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (!raw) return cb({});
    try {
      cb(JSON.parse(raw));
    } catch (e) {
      cb(null); // JSON 非法
    }
  });
}
function csvCell(v) {
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// ---------- 请求处理 ----------
const server = http.createServer((req, res) => {
  const u = URL.parse(req.url, true);
  const q = u.query;
  const path = u.pathname;

  // ---- 馆藏分页列表(读,免鉴权) ----
  if (req.method === 'GET' && path === '/api/books') {
    const pageNumRaw = q.pageNum === undefined ? '1' : String(q.pageNum);
    const pageSizeRaw = q.pageSize === undefined ? '20' : String(q.pageSize);
    if (!/^\d+$/.test(pageNumRaw) || !/^\d+$/.test(pageSizeRaw) || Number(pageNumRaw) < 1 || Number(pageSizeRaw) < 1) {
      return fail(res, 500, '分页参数非法');
    }
    const pageNum = Number(pageNumRaw);
    const pageSize = Number(pageSizeRaw);
    let list = books.slice();
    if (q.shelf) list = list.filter((b) => b.shelf === q.shelf);
    if (q.keyword) list = list.filter((b) => b.title.includes(q.keyword));
    const total = list.length;
    const rows = list.slice((pageNum - 1) * pageSize, (pageNum - 1) * pageSize + pageSize);
    return ok(res, {
      total,
      rows: rows.map((b) => ({ bookId: b.bookId, title: b.title, author: b.author, shelf: b.shelf, available: b.stock > 0, priceFen: b.priceFen })),
    });
  }

  // ---- 馆藏导出 CSV(读,免鉴权;available 缺省=true=仅可借) ----
  if (req.method === 'GET' && path === '/api/books/export') {
    const avail = q.available === undefined ? 'true' : String(q.available);
    const onlyAvailable = avail !== 'false';
    const list = books.filter((b) => (onlyAvailable ? b.stock > 0 : true));
    const header = '书ID,书名,作者,书架,状态,价格(元),入库时间';
    const lines = [header];
    for (const b of list) {
      lines.push(
        [b.bookId, b.title, b.author, b.shelf, b.stock > 0 ? '在架' : '不在架', (b.priceFen / 100).toFixed(2), b.createdTime]
          .map(csvCell)
          .join(',')
      );
    }
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8' });
    return res.end(lines.join('\r\n') + '\r\n');
  }

  // ---- 借阅单详情(读,免鉴权) ----
  const mDetail = path.match(/^\/api\/borrows\/([^/]+)$/);
  if (req.method === 'GET' && mDetail) {
    const bo = borrows.find((x) => x.borrowNo === mDetail[1]);
    if (!bo) return fail(res, 500, '借阅单不存在');
    return ok(res, bo);
  }

  // ---- 登录 ----
  if (req.method === 'POST' && path === '/api/auth/login') {
    return readBody(req, (b) => {
      if (!b) return fail(res, 500, '请求体必须是 JSON');
      const r = READERS.find((x) => x.readerId === b.readerId && x.secret === b.secret);
      if (!r) return fail(res, 500, '读者号或密码错误');
      const token = 'tk-' + Math.random().toString(16).slice(2, 8);
      tokens.add(token);
      return ok(res, { token, readerId: r.readerId, nickname: r.nickname });
    });
  }

  // ---- 以下写接口:需 Bearer token ----
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const authed = token && tokens.has(token);

  const guard = () => {
    if (!authed) {
      fail(res, 401, '未登录或凭证无效');
      return false;
    }
    return true;
  };
  const findBorrow = (no) => borrows.find((x) => x.borrowNo === no);

  // 建借阅单
  if (req.method === 'POST' && path === '/api/borrows') {
    if (!guard()) return;
    return readBody(req, (b) => {
      if (!b) return fail(res, 500, '请求体必须是 JSON');
      const book = books.find((x) => x.bookId === b.bookId);
      if (!book) return fail(res, 500, '图书不存在');
      if (book.stock <= 0) return fail(res, 500, '库存不足');
      book.stock -= 1;
      const no = newBorrow(b.bookId, STATUS.WAIT_PICKUP, 0);
      return ok(res, { borrowNo: no, status: STATUS.WAIT_PICKUP }, '借阅单已创建');
    });
  }

  const mPickup = path.match(/^\/api\/borrows\/([^/]+)\/pickup$/);
  if (req.method === 'POST' && mPickup) {
    if (!guard()) return;
    const bo = findBorrow(mPickup[1]);
    if (!bo) return fail(res, 500, '借阅单不存在');
    if (bo.status !== STATUS.WAIT_PICKUP) return fail(res, 500, '当前状态不允许该操作');
    bo.status = STATUS.LENT;
    bo.dueDate = fmt(new Date(Date.now() + 14 * 86400000));
    return ok(res, { borrowNo: bo.borrowNo, status: bo.status, dueDate: bo.dueDate }, '已取书,进入借出态');
  }

  const mRenew = path.match(/^\/api\/borrows\/([^/]+)\/renew$/);
  if (req.method === 'POST' && mRenew) {
    if (!guard()) return;
    const bo = findBorrow(mRenew[1]);
    if (!bo) return fail(res, 500, '借阅单不存在');
    if (bo.status !== STATUS.LENT) return fail(res, 500, '当前状态不允许该操作');
    if (bo.renewCount >= 2) return fail(res, 500, '续借次数已达上限');
    bo.renewCount += 1;
    bo.dueDate = fmt(new Date(Date.now() + 7 * 86400000));
    return ok(res, { borrowNo: bo.borrowNo, status: bo.status, renewCount: bo.renewCount, dueDate: bo.dueDate }, '续借成功');
  }

  const mReturn = path.match(/^\/api\/borrows\/([^/]+)\/return$/);
  if (req.method === 'POST' && mReturn) {
    if (!guard()) return;
    const bo = findBorrow(mReturn[1]);
    if (!bo) return fail(res, 500, '借阅单不存在');
    if (bo.status !== STATUS.LENT) return fail(res, 500, '当前状态不允许该操作');
    bo.status = STATUS.RETURNED;
    const book = books.find((x) => x.bookId === bo.bookId);
    book.stock += 1;
    const overdueDays = Math.floor((Date.now() - new Date(bo.dueDate).getTime()) / 86400000);
    if (overdueDays > 0) {
      bo.fine = (overdueDays * 0.5).toFixed(2);
      return ok(res, { borrowNo: bo.borrowNo, status: bo.status, fine: bo.fine }, '已归还,逾期罚金 ' + bo.fine + ' 元');
    }
    bo.fine = '0.00';
    return ok(res, { borrowNo: bo.borrowNo, status: bo.status, fine: bo.fine }, '已归还');
  }

  const mCancel = path.match(/^\/api\/borrows\/([^/]+)\/cancel$/);
  if (req.method === 'POST' && mCancel) {
    if (!guard()) return;
    const bo = findBorrow(mCancel[1]);
    if (!bo) return fail(res, 500, '借阅单不存在');
    if (bo.status !== STATUS.WAIT_PICKUP) return fail(res, 500, '当前状态不允许该操作');
    bo.status = STATUS.CANCELED;
    const book = books.find((x) => x.bookId === bo.bookId);
    book.stock += 1;
    return ok(res, { borrowNo: bo.borrowNo, status: bo.status }, '借阅单已取消,库存已释放');
  }

  // ---- 管理种子(模拟 DB 预置中间态;测试专用,不等价于任何业务接口) ----
  if (req.method === 'POST' && path === '/api/_seed/overdue-borrow') {
    return readBody(req, (b) => {
      if (!b) return fail(res, 500, '请求体必须是 JSON');
      const book = books.find((x) => x.bookId === b.bookId);
      if (!book) return fail(res, 500, '图书不存在');
      if (book.stock <= 0) return fail(res, 500, '库存不足,换一本可借的书造逾期单');
      book.stock -= 1;
      const no = newBorrow(b.bookId, STATUS.LENT, -3); // dueDate=3 天前
      return ok(res, { borrowNo: no, status: STATUS.LENT }, '已预置逾期借出单(管理接口,模拟 DB 预置)');
    });
  }

  fail(res, 500, '接口不存在:' + req.method + ' ' + path);
});

server.listen(PORT, () => {
  console.log('toy-library listening on http://127.0.0.1:' + PORT);
});
