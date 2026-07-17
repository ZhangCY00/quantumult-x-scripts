/*
 * 拼多多百亿补贴会员打卡 - 临时接口捕获器
 * 仅保存到 Quantumult X 本地 $prefs，不会上传任何数据。
 * 获取到正式接口并完成签到脚本后，请删除本脚本及对应重写规则。
 */

const STORE_KEY = "PDD_CHECKIN_CAPTURE_V1";
const MAX_RECORDS = 6;

main()
  .catch(error => {
    console.log(`[PDD-CAPTURE] 捕获器异常：${safeText(error && (error.message || error))}`);
    $notify("拼多多接口捕获", "❌ 捕获器异常", "请查看 Quantumult X 日志");
  })
  .finally(() => $done({}));

async function main() {
  if (typeof $request !== "undefined") {
    captureRequest();
    return;
  }

  exportRecords();
}

function captureRequest() {
  const method = String($request.method || "GET").toUpperCase();
  if (method !== "POST") return;

  const url = String($request.url || "");
  if (!/(?:pinduoduo|yangkeduo)\.(?:com|net)/i.test(url)) return;

  const body = typeof $request.body === "string" ? $request.body : "";
  const record = {
    capturedAt: new Date().toISOString(),
    method,
    url,
    headers: selectReplayHeaders($request.headers || {}),
    body
  };

  const records = readRecords();
  const signature = `${record.method}|${record.url}|${record.body}`;
  const deduplicated = records.filter(item =>
    `${item.method}|${item.url}|${item.body}` !== signature
  );
  deduplicated.unshift(record);
  deduplicated.splice(MAX_RECORDS);

  const saved = $prefs.setValueForKey(JSON.stringify(deduplicated), STORE_KEY);
  const score = keywordScore(`${url}\n${body}`);

  console.log(`[PDD-CAPTURE] 已${saved ? "保存" : "尝试保存"} POST 请求：${url}`);
  if (score > 0) {
    $notify(
      "拼多多接口捕获",
      "✅ 发现疑似打卡请求",
      `已保存在手机本地（匹配度 ${score}），请马上手动运行“导出拼多多捕获结果”。`
    );
  }
}

function exportRecords() {
  const records = readRecords();
  if (!records.length) {
    $notify(
      "拼多多接口捕获",
      "⚠️ 暂无捕获记录",
      "请先打开拼多多百亿补贴会员页面，手动打卡一次。"
    );
    return;
  }

  const payload = {
    notice: "PRIVATE: may contain account credentials; send only in your private Codex task",
    exportedAt: new Date().toISOString(),
    records
  };

  console.log("\n========== PDD_CAPTURE_BEGIN ==========");
  console.log(JSON.stringify(payload, null, 2));
  console.log("========== PDD_CAPTURE_END ==========\n");

  $notify(
    "拼多多接口捕获",
    `✅ 已导出 ${records.length} 条记录`,
    "请打开 Quantumult X 日志，复制 PDD_CAPTURE_BEGIN 到 PDD_CAPTURE_END 之间的内容，仅发送到当前私密 Codex 任务。"
  );
}

function readRecords() {
  try {
    const value = $prefs.valueForKey(STORE_KEY);
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function selectReplayHeaders(headers) {
  const keep = /^(?:cookie|user-agent|content-type|origin|referer|anti-content|access-token|authorization|x-|pdd-|mallid|verifyauthtoken)/i;
  const selected = {};

  for (const key of Object.keys(headers)) {
    if (keep.test(key)) selected[key] = String(headers[key]);
  }

  return selected;
}

function keywordScore(text) {
  const patterns = [
    /check[\-_]?in/i,
    /sign/i,
    /clock/i,
    /attendance/i,
    /subsidy/i,
    /billion/i,
    /member/i,
    /daily/i,
    /打卡/,
    /签到/,
    /百亿/,
    /会员/
  ];
  return patterns.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0);
}

function safeText(value) {
  return String(value || "未知错误").slice(0, 200);
}
